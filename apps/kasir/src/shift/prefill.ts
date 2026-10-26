import type { Shift } from '@kelola-kasir/contracts';
import { formatRupiah, parseRupiah } from '@kelola-kasir/money';
import { getJson, setJson, STORAGE_KEYS, type KeyValueStore } from '../lib/storage';
import { uuidv7 } from '../lib/uuid';

/**
 * Opening cash suggestion = actual cash counted when the previous shift was closed (P-02).
 * The API has no "last closed shift" read for employees yet, so the device remembers the figure from
 * the shift it closed itself; when unknown the field starts empty and the cashier types it.
 */
export async function loadSuggestedOpeningCash(store: KeyValueStore): Promise<number | null> {
  const value = await getJson<number>(store, STORAGE_KEYS.lastClosingCash);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function rememberClosingCash(store: KeyValueStore, actualCash: number): Promise<void> {
  return setJson(store, STORAGE_KEYS.lastClosingCash, actualCash);
}

/** Keypad digits → Rupiah. Empty input is 0. Capped so the figure stays sane on a phone. */
export function digitsToRupiah(digits: string): number {
  return digits === '' ? 0 : parseRupiah(digits);
}

export function appendDigit(digits: string, key: string, maxLength = 9): string {
  if (key === '⌫') return digits.slice(0, -1);
  if (!/^[0-9]+$/.test(key)) return digits;
  const next = (digits + key).replace(/^0+(?=\d)/, '');
  return next.length > maxLength ? digits : next;
}

export function openShiftInput(openingCash: number, now: Date = new Date()) {
  return { id: uuidv7(now.getTime()), opening_cash: openingCash, opened_at: now.toISOString() };
}

export function describeShift(shift: Shift): string {
  return `Dibuka ${shift.opened_by.name} · modal ${formatRupiah(shift.opening_cash)}`;
}
