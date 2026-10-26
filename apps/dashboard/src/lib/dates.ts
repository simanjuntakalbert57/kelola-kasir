const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the given instant in WIB (UTC+7, no DST). */
export function wibDate(at: Date = new Date()): string {
  return new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type RangePreset = 'today' | '7d' | 'month' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export const PRESET_LABEL: Record<RangePreset, string> = {
  today: 'Hari ini',
  '7d': '7 hari',
  month: 'Bulan ini',
  custom: 'Kustom',
};

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  const today = wibDate(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') return { from: addDays(today, -6), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

const shortDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Jakarta',
});
const time = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Jakarta',
});

export const formatShortDate = (iso: string) => shortDate.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso)).replace(':', '.');
