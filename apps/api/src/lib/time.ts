/** Asia/Jakarta (WIB) is UTC+7 all year (no DST), so the business-day boundaries are fixed offsets. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Start of the WIB business day `yyyy-mm-dd`, as a UTC instant. */
export function startOfBusinessDay(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - WIB_OFFSET_MS);
}

/** Exclusive end of the WIB business day `yyyy-mm-dd`. */
export function endOfBusinessDay(date: string): Date {
  return new Date(startOfBusinessDay(date).getTime() + 24 * 60 * 60 * 1000);
}

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

/** Business date `yyyy-mm-dd` of an instant in an IANA time zone. */
export function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `yyyy-mm-dd` shifted by whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
