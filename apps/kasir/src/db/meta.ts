import { get, type Db } from './types';

export const META = {
  cursor: 'sync_cursor',
  settings: 'outlet_settings',
  printReceipt: 'print_receipt',
  printerAddress: 'printer_address',
  printerName: 'printer_name',
  printerLastConnected: 'printer_last_connected',
} as const;

export async function getMeta(db: Db, key: string): Promise<string | null> {
  return (
    (await get<{ value: string }>(db, 'SELECT value FROM meta WHERE key = ?', [key]))?.value ?? null
  );
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
