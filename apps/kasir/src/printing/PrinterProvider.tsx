import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { loadSettings } from '../catalog/sync';
import { getMeta, META, setMeta } from '../db/meta';
import { useSales } from '../sales/SalesProvider';
import { bluetoothTransport } from './bluetoothTransport';
import type { ReceiptData } from './layout';
import { loadLocalReceipt } from './localReceipt';
import {
  createPrintService,
  FAILURE_MESSAGES,
  type PrintFailure,
  type PrinterDevice,
  type PrintResult,
} from './service';

export type PrinterStatus = 'none' | 'connecting' | 'connected' | 'disconnected';

export interface SavedPrinter {
  address: string;
  name: string;
}

export interface PrintJob {
  transactionId: string;
  kind: 'auto' | 'reprint';
  state: 'printing' | 'done' | 'failed';
  reason?: PrintFailure;
  message?: string;
  at: number;
}

export interface PrinterValue {
  saved: SavedPrinter | null;
  status: PrinterStatus;
  job: PrintJob | null;
  dismissJob: () => void;
  /** Prints in the background after a sale. Never throws, never blocks the sale. */
  autoPrint: (transactionId: string) => void;
  /** Reprint of a stored transaction, marked `CETAK ULANG`. */
  reprint: (transactionId: string, receipt?: ReceiptData) => Promise<PrintResult>;
  testPrint: () => Promise<PrintResult>;
  connectTo: (device: PrinterDevice) => Promise<PrintResult>;
  reconnect: () => Promise<boolean>;
  forget: () => Promise<void>;
}

const Ctx = createContext<PrinterValue | null>(null);

export function usePrinter(): PrinterValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePrinter must be used inside PrinterProvider');
  return value;
}

const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export function PrinterProvider({ children }: { children: ReactNode }) {
  const { db } = useSales();
  const { paired, session } = useSession();
  const service = useMemo(() => createPrintService(bluetoothTransport), []);
  const [saved, setSaved] = useState<SavedPrinter | null>(null);
  const [status, setStatus] = useState<PrinterStatus>('none');
  const [job, setJob] = useState<PrintJob | null>(null);
  const savedRef = useRef<SavedPrinter | null>(null);
  const busy = useRef(false);
  const attempt = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const signedIn = !!session;

  const applySaved = useCallback((next: SavedPrinter | null) => {
    savedRef.current = next;
    setSaved(next);
    setStatus(next ? 'disconnected' : 'none');
  }, []);

  useEffect(() => {
    if (!db) return;
    void (async () => {
      const address = await getMeta(db, META.printerAddress);
      if (address) {
        applySaved({ address, name: (await getMeta(db, META.printerName)) ?? address });
      }
    })();
  }, [db, applySaved]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    const target = savedRef.current;
    if (!target || busy.current) return false;
    busy.current = true;
    setStatus('connecting');
    try {
      const res = await service.ensureConnected(target.address);
      if (savedRef.current?.address !== target.address) return false;
      setStatus(res.ok ? 'connected' : 'disconnected');
      if (res.ok) {
        attempt.current = 0;
        if (db) void setMeta(db, META.printerLastConnected, new Date().toISOString());
      }
      return res.ok;
    } finally {
      busy.current = false;
    }
  }, [service, db]);

  // Reconnect when the app opens / returns to the foreground, and keep retrying with backoff
  // while the printer is off ("sambung otomatis" after power cycle or app restart).
  useEffect(() => {
    if (!saved || !signedIn) return;
    void reconnect();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reconnect();
    });
    return () => sub.remove();
  }, [saved, signedIn, reconnect]);

  useEffect(() => {
    return bluetoothTransport.onDisconnected((address) => {
      if (savedRef.current?.address === address) {
        setStatus('disconnected');
        setRetryTick((t) => t + 1);
      }
    });
  }, []);

  useEffect(() => {
    if (status !== 'disconnected' || !saved || !signedIn) return;
    const delay = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)] ?? 60_000;
    const timer = setTimeout(() => {
      attempt.current += 1;
      void reconnect().then((ok) => {
        if (!ok) setRetryTick((t) => t + 1);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [status, saved, signedIn, reconnect, retryTick]);

  const context = useCallback(async () => {
    const settings = db ? await loadSettings(db) : null;
    return {
      settings,
      outletName: paired?.outlet.name ?? 'Kelola Kasir',
      timeZone: paired?.outlet.timezone ?? 'Asia/Jakarta',
    };
  }, [db, paired]);

  /** Runs one print, then mirrors the outcome into the connection status. */
  const run = useCallback(
    async (print: (address: string | null) => Promise<PrintResult>): Promise<PrintResult> => {
      const address = savedRef.current?.address ?? null;
      if (address) setStatus((s) => (s === 'connected' ? s : 'connecting'));
      const res = await print(address);
      // A failed write may mean a dead link: the retry loop re-checks it.
      if (address) setStatus(res.ok ? 'connected' : 'disconnected');
      return res;
    },
    [],
  );

  const printJob = useCallback(
    async (transactionId: string, kind: 'auto' | 'reprint', receipt?: ReceiptData) => {
      setJob({ transactionId, kind, state: 'printing', at: Date.now() });
      let res: PrintResult;
      try {
        const data =
          receipt ??
          (db
            ? await loadLocalReceipt(db, transactionId, await context(), kind === 'reprint')
            : null);
        res = data
          ? await run((address) => service.printReceipt(address, data))
          : { ok: false, reason: 'write_failed', message: 'Transaksi tidak ditemukan.' };
      } catch {
        res = { ok: false, reason: 'write_failed', message: FAILURE_MESSAGES.write_failed };
      }
      setJob(
        res.ok
          ? { transactionId, kind, state: 'done', at: Date.now() }
          : {
              transactionId,
              kind,
              state: 'failed',
              reason: res.reason,
              message: res.message,
              at: Date.now(),
            },
      );
      return res;
    },
    [db, context, run, service],
  );

  const value = useMemo<PrinterValue>(
    () => ({
      saved,
      status,
      job,
      dismissJob: () => setJob(null),
      autoPrint: (transactionId) => void printJob(transactionId, 'auto'),
      reprint: (transactionId, receipt) =>
        printJob(transactionId, 'reprint', receipt ? { ...receipt, reprint: true } : undefined),
      testPrint: () => run((address) => service.printTestPage(address)),
      reconnect,
      connectTo: async (device) => {
        setStatus('connecting');
        try {
          if ((await bluetoothTransport.requestPermissions()) !== 'granted') {
            setStatus(savedRef.current ? 'disconnected' : 'none');
            return { ok: false, reason: 'permission', message: FAILURE_MESSAGES.permission };
          }
          if (!device.bonded) await bluetoothTransport.pair(device.address);
          await bluetoothTransport.connect(device.address);
        } catch {
          setStatus(savedRef.current ? 'disconnected' : 'none');
          return { ok: false, reason: 'not_connected', message: FAILURE_MESSAGES.not_connected };
        }
        if (db) {
          await setMeta(db, META.printerAddress, device.address);
          await setMeta(db, META.printerName, device.name);
          await setMeta(db, META.printerLastConnected, new Date().toISOString());
        }
        savedRef.current = { address: device.address, name: device.name };
        setSaved(savedRef.current);
        setStatus('connected');
        attempt.current = 0;
        return { ok: true };
      },
      forget: async () => {
        const address = savedRef.current?.address;
        savedRef.current = null;
        setSaved(null);
        setStatus('none');
        if (address) await bluetoothTransport.disconnect(address).catch(() => undefined);
        if (db) {
          await setMeta(db, META.printerAddress, '');
          await setMeta(db, META.printerName, '');
        }
      },
    }),
    [saved, status, job, printJob, run, service, reconnect, db],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
