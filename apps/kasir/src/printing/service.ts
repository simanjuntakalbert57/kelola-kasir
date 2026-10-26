import { encodeReceipt, encodeLines } from './escpos';
import { testPageLines, type ReceiptData } from './layout';

export interface PrinterDevice {
  name: string;
  address: string;
  /** Already paired in Android's Bluetooth settings. */
  bonded: boolean;
}

export type PermissionResult = 'granted' | 'denied' | 'blocked';

/** The Bluetooth Classic (SPP) surface the app needs; the native library sits behind it (TDD §2.6). */
export interface PrinterTransport {
  requestPermissions(): Promise<PermissionResult>;
  isEnabled(): Promise<boolean>;
  listBonded(): Promise<PrinterDevice[]>;
  /** Discovers nearby devices; calls `onFound` for each and resolves when the scan ends. */
  discover(onFound: (device: PrinterDevice) => void): Promise<void>;
  cancelDiscovery(): Promise<void>;
  pair(address: string): Promise<void>;
  connect(address: string): Promise<void>;
  isConnected(address: string): Promise<boolean>;
  disconnect(address: string): Promise<void>;
  write(address: string, data: Uint8Array): Promise<void>;
  onDisconnected(listener: (address: string) => void): () => void;
  openSettings(): void;
}

export type PrintFailure =
  'no_printer' | 'permission' | 'bluetooth_off' | 'not_connected' | 'write_failed';

export type PrintResult = { ok: true } | { ok: false; reason: PrintFailure; message: string };

export const FAILURE_MESSAGES: Record<PrintFailure, string> = {
  no_printer: 'Belum ada printer. Pasang printer dulu di layar Printer.',
  permission: 'Izin Bluetooth belum diberikan. Buka layar Printer lalu izinkan.',
  bluetooth_off: 'Bluetooth HP mati. Nyalakan Bluetooth lalu coba lagi.',
  not_connected: 'Printer tidak tersambung. Hidupkan printer lalu coba lagi.',
  write_failed:
    'Gagal mencetak. Koneksi terputus saat mencetak atau kertas habis; struk mungkin tercetak sebagian.',
};

const fail = (reason: PrintFailure): PrintResult => ({
  ok: false,
  reason,
  message: FAILURE_MESSAGES[reason],
});

export interface PrintServiceOptions {
  /** Bytes per Bluetooth write: the RPP02N buffer is small and a long burst gets cut off. */
  chunkSize?: number;
  chunkDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Connects (once) and writes ESC/POS in small chunks. Never throws: a printer fault must not touch the sale. */
export function createPrintService(transport: PrinterTransport, options: PrintServiceOptions = {}) {
  const chunkSize = options.chunkSize ?? 128;
  const chunkDelayMs = options.chunkDelayMs ?? 40;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** Reuses a live connection, otherwise one reconnect attempt to `address`. */
  async function ensureConnected(address: string | null): Promise<PrintResult> {
    if (!address) return fail('no_printer');
    try {
      if (!(await transport.isEnabled())) return fail('bluetooth_off');
      if (await transport.isConnected(address)) return { ok: true };
      if ((await transport.requestPermissions()) !== 'granted') return fail('permission');
      await transport.connect(address);
      return { ok: true };
    } catch {
      return fail('not_connected');
    }
  }

  async function sendBytes(address: string | null, data: Uint8Array): Promise<PrintResult> {
    const connected = await ensureConnected(address);
    if (!connected.ok || !address) return connected;
    try {
      for (let i = 0; i < data.length; i += chunkSize) {
        await transport.write(address, data.subarray(i, i + chunkSize));
        if (i + chunkSize < data.length) await sleep(chunkDelayMs);
      }
      return { ok: true };
    } catch {
      return fail('write_failed');
    }
  }

  return {
    ensureConnected,
    printReceipt: (address: string | null, receipt: ReceiptData) =>
      sendBytes(address, encodeReceipt(receipt)),
    printTestPage: (address: string | null) => sendBytes(address, encodeLines(testPageLines())),
  };
}

export type PrintService = ReturnType<typeof createPrintService>;
