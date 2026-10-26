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
import { NetworkError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { createCatalogRepository, type CatalogRepository } from '../catalog/repository';
import { pullCatalog } from '../catalog/sync';
import { openDatabase } from '../db/expoDb';
import { getMeta, META, setMeta } from '../db/meta';
import type { Db } from '../db/types';
import { pendingCount, pushOutbox, PUSH_INTERVAL_MS } from '../sync/outbox';
import { emptyCart, type Cart } from './cart';
import type { CashSale, SaleContext } from './checkout';
import type { QrisSession } from './qris';

/** Catalog refresh: the owner's product edits reach the cashier within a minute (design DEAR-5). */
export const PULL_INTERVAL_MS = 60_000;

export interface CompletedSale {
  number: string;
  total: number;
  method: 'cash' | 'qris';
  cashTendered?: number;
  change?: number;
}

export interface SalesValue {
  db: Db | null;
  catalog: CatalogRepository | null;
  /** Bumped after every catalog pull so the grid reloads. */
  catalogVersion: number;
  cart: Cart;
  setCart: (update: (cart: Cart) => Cart) => void;
  /** Last network outcome: false after a network failure, true after any success. */
  online: boolean;
  pending: number;
  printReceipt: boolean;
  setPrintReceipt: (on: boolean) => void;
  saleContext: SaleContext | null;
  lastSale: CompletedSale | null;
  completeSale: (sale: CompletedSale) => void;
  qris: QrisSession | null;
  setQris: (session: QrisSession | null) => void;
  newOrder: () => void;
  refreshPending: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<SalesValue | null>(null);

export function useSales(): SalesValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSales must be used inside SalesProvider');
  return value;
}

export function toCompleted(sale: CashSale): CompletedSale {
  return {
    number: sale.number,
    total: sale.total,
    method: 'cash',
    cashTendered: sale.cashTendered,
    change: sale.change,
  };
}

export function SalesProvider({ children }: { children: ReactNode }) {
  const { api, paired, session, shift, resetDevice } = useSession();
  const [db, setDb] = useState<Db | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [cart, setCartState] = useState<Cart>(emptyCart);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [printReceipt, setPrintReceiptState] = useState(true);
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null);
  const [qris, setQris] = useState<QrisSession | null>(null);
  const busy = useRef({ pull: false, push: false });

  useEffect(() => {
    void openDatabase().then(async (opened) => {
      setDb(opened);
      setPrintReceiptState((await getMeta(opened, META.printReceipt)) !== '0');
      setPending(await pendingCount(opened));
    });
  }, []);

  const catalog = useMemo(() => (db ? createCatalogRepository(db) : null), [db]);
  const paired_ = !!paired;

  const refreshPending = useCallback(async () => {
    if (db) setPending(await pendingCount(db));
  }, [db]);

  const pull = useCallback(async () => {
    if (!db || !catalog || !paired_ || busy.current.pull) return;
    busy.current.pull = true;
    try {
      const res = await pullCatalog(api, db, catalog);
      setOnline(true);
      if (res.deviceRevoked) await resetDevice();
      else if (res.changed) setCatalogVersion((v) => v + 1);
    } catch (error) {
      if (error instanceof NetworkError) setOnline(false);
    } finally {
      busy.current.pull = false;
    }
  }, [api, db, catalog, paired_, resetDevice]);

  const push = useCallback(async () => {
    if (!db || !paired_ || busy.current.push) return;
    busy.current.push = true;
    try {
      let result = await pushOutbox(api, db);
      while (result.remaining > 0 && result.sent > 0) result = await pushOutbox(api, db);
      setOnline(true);
    } catch (error) {
      if (error instanceof NetworkError) setOnline(false);
    } finally {
      busy.current.push = false;
      setPending(await pendingCount(db));
    }
  }, [api, db, paired_]);

  const signedIn = !!session;
  useEffect(() => {
    if (!db || !paired_ || !signedIn) return;
    void pull();
    void push();
    const a = setInterval(() => void pull(), PULL_INTERVAL_MS);
    const b = setInterval(() => void push(), PUSH_INTERVAL_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [db, paired_, signedIn, pull, push]);

  const saleContext = useMemo<SaleContext | null>(
    () =>
      paired && session && shift
        ? {
            outletCode: paired.outlet.code,
            deviceCode: paired.device.code,
            timeZone: paired.outlet.timezone,
            shiftId: shift.id,
            employee: { id: session.employeeId, name: session.employeeName },
          }
        : null,
    [paired, session, shift],
  );

  const value = useMemo<SalesValue>(
    () => ({
      db,
      catalog,
      catalogVersion,
      cart,
      setCart: (update) => setCartState(update),
      online,
      pending,
      printReceipt,
      setPrintReceipt: (on) => {
        setPrintReceiptState(on);
        if (db) void setMeta(db, META.printReceipt, on ? '1' : '0');
      },
      saleContext,
      lastSale,
      completeSale: (sale) => {
        setLastSale(sale);
        setCartState(emptyCart);
        setQris(null);
        void refreshPending();
        void push();
      },
      qris,
      setQris,
      newOrder: () => {
        setLastSale(null);
        setCartState(emptyCart);
      },
      refreshPending,
      syncNow: async () => {
        await push();
        await pull();
      },
    }),
    [
      db,
      catalog,
      catalogVersion,
      cart,
      online,
      pending,
      printReceipt,
      saleContext,
      lastSale,
      qris,
      refreshPending,
      push,
      pull,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
