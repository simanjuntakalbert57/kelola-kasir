import { addDays, wibDate } from './dates';

/** Greeting for the owner's summary page, by WIB hour: pagi 04–10, siang 11–14, sore 15–17, malam 18–03. */
export function greetingWord(wibHour: number): 'pagi' | 'siang' | 'sore' | 'malam' {
  if (wibHour >= 4 && wibHour <= 10) return 'pagi';
  if (wibHour >= 11 && wibHour <= 14) return 'siang';
  if (wibHour >= 15 && wibHour <= 17) return 'sore';
  return 'malam';
}

/** "Selamat siang, Pak Albert", or "Halo!" when the profile has no name. */
export function greeting(name: string | null | undefined, wibHour: number): string {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return 'Halo!';
  return `Selamat ${greetingWord(wibHour)}, Pak ${first}`;
}

export const WIB_HOUR = (at: Date = new Date()): number => (at.getUTCHours() + 7) % 24;

/**
 * Revenue per previous day (oldest first, `days` entries) counting only hourly buckets that start
 * before `wibHour`, so the comparison with today covers the same hours of the day.
 */
export function revenueBeforeHour(
  points: readonly { bucket_start: string; revenue: number }[],
  firstDay: string,
  days: number,
  wibHour: number,
): number[] {
  const sums = new Map<string, number>();
  for (const p of points) {
    const at = new Date(p.bucket_start);
    if (WIB_HOUR(at) >= wibHour) continue;
    const day = wibDate(at);
    sums.set(day, (sums.get(day) ?? 0) + p.revenue);
  }
  return Array.from({ length: days }, (_, n) => sums.get(addDays(firstDay, n)) ?? 0);
}

export type Busyness = 'rame' | 'sepi' | 'normal';

const THRESHOLD = 0.15;

/**
 * Today's revenue so far against the average of the previous seven days over the same hours (one revenue per day, oldest first, see `revenueBeforeHour`).
 * ≥ +15% is rame, ≤ −15% is sepi, otherwise normal. Returns null (sentence hidden) when there is
 * not yet a full week of history: the earliest two of the seven days must have sales.
 */
export function busyness(todayRevenue: number, previousDays: readonly number[]): Busyness | null {
  if (previousDays.length < 7) return null;
  if (!previousDays.slice(0, 2).some((r) => r > 0)) return null;
  const avg = previousDays.reduce((a, b) => a + b, 0) / previousDays.length;
  if (avg <= 0) return null;
  const delta = (todayRevenue - avg) / avg;
  if (delta >= THRESHOLD) return 'rame';
  if (delta <= -THRESHOLD) return 'sepi';
  return 'normal';
}

export const BUSY_SENTENCE: Record<Busyness, string> = {
  rame: 'Hari ini rame, Pak! 🍹',
  sepi: 'Hari ini lagi sepi.',
  normal: 'Hari ini normal.',
};

/** Context for the peak hour; only lunchtime (11–14) gets a remark. */
export function peakHourSentence(hour: number): string {
  const base = `Jam ${hour} paling rame.`;
  return hour >= 11 && hour <= 14 ? `${base} Pas jam makan siang.` : base;
}
