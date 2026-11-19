/**
 * Item discount math shared by the API, the cashier app and the dashboard preview (ADR-0023 §2).
 * Pure functions, no `Intl`, no phone time zone: the local time of an outlet is `UTC + utc_offset_minutes`.
 */
import { MoneyError, assertRupiah, type Rupiah } from './index.ts';

export type DiscountType = 'percent' | 'amount';
export type DiscountTargetType = 'product' | 'category';

export const MAX_DISCOUNT_AMOUNT = 100_000_000;

/**
 * A discount rule as synced to a cashier device (`DiscountRule` of the OpenAPI contract), for the targets of one
 * outlet. The server also evaluates historic snapshots of it; there `is_active` may be `false`.
 */
export interface DiscountRule {
  readonly id: string;
  readonly version: number;
  /** Promo name, printed on the receipt. */
  readonly name: string;
  readonly type: DiscountType;
  readonly value: number;
  readonly target_type: DiscountTargetType;
  readonly product_ids: readonly string[];
  readonly category_ids: readonly string[];
  /** `yyyy-mm-dd`, outlet local date, inclusive. */
  readonly starts_on: string;
  /** `yyyy-mm-dd`, inclusive; `null` = no end. */
  readonly ends_on: string | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday; `null` = every day. */
  readonly days_of_week: readonly number[] | null;
  /** `HH:MM`, inclusive; set together with `time_end`. */
  readonly time_start: string | null;
  /** `HH:MM`, exclusive. */
  readonly time_end: string | null;
  /** Local time of the outlet = UTC + this (WIB = 420). */
  readonly utc_offset_minutes: number;
  /** Omitted = `true`. Synced rules are always active. */
  readonly is_active?: boolean;
}

export interface DiscountProduct {
  readonly id: string;
  readonly categoryId: string | null;
  /** Normal catalog price. */
  readonly price: Rupiah;
}

export interface DiscountQuote {
  readonly rule: DiscountRule;
  /** Rupiah off one unit. */
  readonly perUnit: Rupiah;
  /** Price of one unit after the discount, never below 0. */
  readonly finalUnitPrice: Rupiah;
}

/** Rupiah off one unit. `percent` rounds half up to a whole Rupiah, `amount` never exceeds the price. */
export function discountPerUnit(price: Rupiah, type: DiscountType, value: number): Rupiah {
  assertRupiah(price, 'price');
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MoneyError(`discount value must be a positive integer, got ${String(value)}`);
  }
  if (type === 'amount') return Math.min(value, price);
  if (value > 100) throw new MoneyError(`percent discount cannot exceed 100, got ${value}`);
  const scaled = price * value + 50;
  if (!Number.isSafeInteger(scaled))
    throw new MoneyError('discount overflowed the safe integer range');
  return Math.floor(scaled / 100);
}

/** Rupiah off a whole line: per-unit discount × quantity (rounding is per unit so receipts stay consistent). */
export function discountForLine(
  price: Rupiah,
  quantity: number,
  type: DiscountType,
  value: number,
): Rupiah {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new MoneyError(`quantity must be a positive integer, got ${String(quantity)}`);
  }
  const total = discountPerUnit(price, type, value) * quantity;
  if (!Number.isSafeInteger(total))
    throw new MoneyError('discount overflowed the safe integer range');
  return total;
}

export interface LocalMoment {
  /** `yyyy-mm-dd` */
  readonly date: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  readonly isoWeekday: number;
  /** Minutes since local midnight. */
  readonly minutes: number;
}

/** Local date, weekday and time of an instant in a fixed UTC offset. */
export function localMoment(at: Date | number, utcOffsetMinutes: number): LocalMoment {
  const ms = typeof at === 'number' ? at : at.getTime();
  if (!Number.isFinite(ms)) throw new MoneyError('invalid instant');
  const d = new Date(ms + utcOffsetMinutes * 60_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const day = d.getUTCDay();
  return {
    date: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    isoWeekday: day === 0 ? 7 : day,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** `HH:MM` → minutes since midnight; throws on anything else. */
export function parseClock(value: string): number {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!m) throw new MoneyError(`invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Why a rule does not apply at an instant, or `null` when the schedule (not the target) allows it. */
export type DiscountInactiveReason = 'inactive' | 'not_started' | 'ended' | 'weekday' | 'time';

export function scheduleReason(
  rule: DiscountRule,
  at: Date | number,
): DiscountInactiveReason | null {
  if (rule.is_active === false) return 'inactive';
  const t = localMoment(at, rule.utc_offset_minutes);
  if (t.date < rule.starts_on) return 'not_started';
  if (rule.ends_on !== null && t.date > rule.ends_on) return 'ended';
  if (rule.days_of_week !== null && !rule.days_of_week.includes(t.isoWeekday)) return 'weekday';
  if (rule.time_start !== null && rule.time_end !== null) {
    if (t.minutes < parseClock(rule.time_start) || t.minutes >= parseClock(rule.time_end)) {
      return 'time';
    }
  }
  return null;
}

/** The rule is active at the instant: switched on, inside the period, weekday and hour window (end exclusive). */
export function isDiscountActive(rule: DiscountRule, at: Date | number): boolean {
  return scheduleReason(rule, at) === null;
}

/** The rule targets the product directly or through its category. */
export function discountTargets(
  rule: DiscountRule,
  product: Pick<DiscountProduct, 'id' | 'categoryId'>,
): boolean {
  return rule.target_type === 'product'
    ? rule.product_ids.includes(product.id)
    : product.categoryId !== null && rule.category_ids.includes(product.categoryId);
}

/** The rule applies to the product at the instant. */
export function discountApplies(
  rule: DiscountRule,
  product: DiscountProduct,
  at: Date | number,
): boolean {
  return discountTargets(rule, product) && isDiscountActive(rule, at);
}

/**
 * The best discount for a product at an instant. Discounts never stack: the one that takes off the most Rupiah per
 * unit wins, a tie goes to the smallest rule `id`. `null` when nothing applies or the discount would be Rp0.
 */
export function bestDiscount(
  rules: readonly DiscountRule[],
  product: DiscountProduct,
  at: Date | number,
): DiscountQuote | null {
  let best: DiscountQuote | null = null;
  for (const rule of rules) {
    if (!discountApplies(rule, product, at)) continue;
    const perUnit = discountPerUnit(product.price, rule.type, rule.value);
    if (perUnit <= 0) continue;
    if (
      best === null ||
      perUnit > best.perUnit ||
      (perUnit === best.perUnit && rule.id < best.rule.id)
    ) {
      best = { rule, perUnit, finalUnitPrice: product.price - perUnit };
    }
  }
  return best;
}
