import type { Db } from '../db/types';
import { get } from '../db/types';

/** `YYMMDD` of `date` in the outlet's timezone (the sequence resets per local day). */
export function localDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${pick('year')}${pick('month')}${pick('day')}`;
}

/** Device code → the 3 alphanumeric characters used in the number (e.g. `K01`). */
export function deviceSegment(code: string): string {
  return code
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .padEnd(3, '0')
    .slice(0, 3);
}

export function formatNumber(
  outletCode: string,
  deviceCode: string,
  day: string,
  seq: number,
): string {
  return `${outletCode.toUpperCase()}-${deviceSegment(deviceCode)}-${day}-${String(seq).padStart(4, '0')}`;
}

/**
 * Next client-side transaction number `{OUTLET}-{DEV}-{YYMMDD}-{seq4}` (TDD §2.4). Unique without
 * server coordination because the sequence is per device and per day. Call inside a transaction.
 */
export async function reserveNumber(
  db: Db,
  ctx: { outletCode: string; deviceCode: string; timeZone: string },
  now: Date,
): Promise<string> {
  const day = localDay(now, ctx.timeZone);
  await db.run(
    `INSERT INTO day_counters (day, seq) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET seq = seq + 1`,
    [day],
  );
  const row = await get<{ seq: number }>(db, 'SELECT seq FROM day_counters WHERE day = ?', [day]);
  return formatNumber(ctx.outletCode, ctx.deviceCode, day, row?.seq ?? 1);
}
