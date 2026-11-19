import { useQuery } from '@tanstack/react-query';
import type { Discount, DiscountStatus } from '@kelola-kasir/contracts';
import {
  bestDiscount,
  formatRupiah,
  type DiscountQuote,
  type DiscountRule,
} from '@kelola-kasir/money';
import { useAuth } from '../auth/AuthProvider';
import { ApiError, api, qs } from './api';

export const DISCOUNT_STATUS: Record<
  DiscountStatus,
  { label: string; tone: 'ok' | 'off' | 'warn' | 'info' }
> = {
  active: { label: 'Aktif', tone: 'ok' },
  scheduled: { label: 'Terjadwal', tone: 'info' },
  ended: { label: 'Selesai', tone: 'warn' },
  inactive: { label: 'Nonaktif', tone: 'off' },
  deleted: { label: 'Dihapus', tone: 'off' },
};

export const WEEKDAYS = [
  { n: 1, short: 'Sen', long: 'Senin' },
  { n: 2, short: 'Sel', long: 'Selasa' },
  { n: 3, short: 'Rab', long: 'Rabu' },
  { n: 4, short: 'Kam', long: 'Kamis' },
  { n: 5, short: 'Jum', long: 'Jumat' },
  { n: 6, short: 'Sab', long: 'Sabtu' },
  { n: 7, short: 'Min', long: 'Minggu' },
] as const;

export const DISCOUNT_KEY = ['discounts'] as const;
/** WIB, the only zone the dashboard shows (ADR-0023 §2). */
export const WIB_OFFSET_MINUTES = 420;

const dayMonth = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `yyyy-mm-dd` → "5 Des 2026". */
export function formatDay(date: string): string {
  return dayMonth.format(new Date(`${date}T00:00:00Z`));
}

/** "20%" or "Rp2.000". */
export function formatDiscountValue(d: { type: 'percent' | 'amount'; value: number }): string {
  return d.type === 'percent' ? `${d.value}%` : formatRupiah(d.value);
}

/** "5 Des 2026 – 31 Des 2026", or "Mulai 5 Des 2026" when open-ended. */
export function formatPeriod(d: { starts_on: string; ends_on?: string | null }): string {
  return d.ends_on
    ? `${formatDay(d.starts_on)} – ${formatDay(d.ends_on)}`
    : `Mulai ${formatDay(d.starts_on)}`;
}

/** "Setiap hari", "Sen, Sel, Rab · 14.00–17.00". */
export function formatSchedule(d: {
  days_of_week?: number[] | null;
  time_start?: string | null;
  time_end?: string | null;
}): string {
  const days =
    !d.days_of_week || d.days_of_week.length === 0 || d.days_of_week.length === 7
      ? 'Setiap hari'
      : WEEKDAYS.filter((w) => d.days_of_week?.includes(w.n))
          .map((w) => w.short)
          .join(', ');
  const hours =
    d.time_start && d.time_end
      ? `${d.time_start.replace(':', '.')}–${d.time_end.replace(':', '.')}`
      : 'Sepanjang hari';
  return `${days} · ${hours}`;
}

/** Targets of a discount as one line: product or category names across the visible outlets. */
export function targetNames(d: Discount): string[] {
  const names = new Set<string>();
  for (const o of d.outlets) {
    for (const p of o.products) names.add(p.name);
    for (const c of o.categories) names.add(c.name);
  }
  return [...names];
}

export function discountErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DISCOUNT_VERSION_CONFLICT':
        return 'Diskon ini sudah diubah orang lain. Data dimuat ulang, cek lagi lalu simpan.';
      case 'DISCOUNT_DELETED':
        return 'Diskon ini sudah dihapus dan tidak bisa diubah.';
      case 'DISCOUNT_TARGET_INVALID':
        return 'Ada produk atau kategori yang sudah tidak ada. Pilih ulang targetnya.';
      case 'FORBIDDEN':
        return 'Hanya pemilik yang bisa mengubah diskon.';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'Terjadi kesalahan. Coba lagi.';
}

/** The discount as a rule of the active outlet, ready for the shared formula. */
export function toRule(d: Discount, outletId: string): DiscountRule | null {
  const entry = d.outlets.find((o) => o.outlet.id === outletId);
  if (!entry) return null;
  return {
    id: d.id,
    version: d.version,
    name: d.name,
    type: d.type,
    value: d.value,
    target_type: d.target_type,
    product_ids: entry.products.map((p) => p.id),
    category_ids: entry.categories.map((c) => c.id),
    starts_on: d.starts_on,
    ends_on: d.ends_on ?? null,
    days_of_week: d.days_of_week ?? null,
    time_start: d.time_start ?? null,
    time_end: d.time_end ?? null,
    utc_offset_minutes: WIB_OFFSET_MINUTES,
    is_active: d.is_active,
  };
}

/** Active discounts of the active branch (Produk page badges). Fails soft: no badges when it cannot load. */
export function useActiveRules(): readonly DiscountRule[] {
  const { activeOutlet } = useAuth();
  const outletId = activeOutlet?.id ?? '';
  const { data } = useQuery({
    queryKey: [...DISCOUNT_KEY, 'rules', outletId],
    queryFn: () => api<{ data: Discount[] }>(`/discounts${qs({ status: 'active' })}`),
    enabled: outletId !== '',
    retry: false,
    staleTime: 60_000,
  });
  if (!data) return [];
  return data.data.flatMap((d) => {
    const rule = toRule(d, outletId);
    return rule ? [rule] : [];
  });
}

export function quoteFor(
  rules: readonly DiscountRule[],
  product: { id: string; category_id: string; price: number },
  at: Date = new Date(),
): DiscountQuote | null {
  return bestDiscount(
    rules,
    { id: product.id, categoryId: product.category_id, price: product.price },
    at,
  );
}
