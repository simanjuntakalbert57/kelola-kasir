import { inArray } from 'drizzle-orm';
import { discountPerUnit, discountTargets, scheduleReason } from '@kelola-kasir/money';
import type { DbOrTx } from '../../db/client.js';
import { discountHistory } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { utcOffsetMinutes } from '../../lib/time.js';
import { DISCOUNT_GRACE_MS, ruleFromSnapshot, type DiscountSnapshot } from './rules.js';

export interface DiscountedItem {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  discount_id?: string | null | undefined;
  discount_version?: number | null | undefined;
  discount_amount: number;
}

/** Why a phone's rule version no longer counts (ADR-0023 §3 "Basi"). */
export type StaleReason =
  | 'inactive'
  | 'deleted'
  | 'not_started'
  | 'ended'
  | 'weekday'
  | 'time'
  | 'not_targeted'
  | 'superseded';

export interface StaleDiscount {
  item_id: string;
  discount_id: string;
  sent_version: number;
  current_version: number;
  reason: StaleReason;
}

export interface AppliedDiscount {
  discountId: string;
  version: number;
  name: string;
}

export interface DiscountCheck {
  /** Discount snapshot per item id (only items with a discount). */
  applied: Map<string, AppliedDiscount>;
  stale: StaleDiscount[];
}

const invalid = (detail: string) =>
  errors.unprocessable('DISCOUNT_INVALID', 'Discount does not match its rule', detail);

/**
 * Checks item discounts against the rule version the phone used (ADR-0023 §3). Throws `DISCOUNT_INVALID` for
 * discounts no honest app could produce; a rule that no longer applies at `at` is `DISCOUNT_STALE` for online
 * payments (`api`) and only reported (`stale`) for the offline outbox (`sync`), whose sales are never dropped.
 */
export async function checkItemDiscounts(
  db: DbOrTx,
  args: {
    outletId: string;
    timezone: string;
    source: 'api' | 'sync';
    /** Instant the sale was made on the phone (`client_created_at`). */
    at: Date;
    items: DiscountedItem[];
    /** Current catalog category of each product id. */
    categoryOf: Map<string, string | null>;
  },
): Promise<DiscountCheck> {
  const result: DiscountCheck = { applied: new Map(), stale: [] };
  const candidates = args.items.filter(
    (i) => i.discount_id || i.discount_version != null || i.discount_amount > 0,
  );
  if (candidates.length === 0) return result;

  for (const item of candidates) {
    if (!item.discount_id) {
      throw invalid(
        item.discount_amount > 0
          ? `"${item.product_name}" has a discount_amount without discount_id`
          : `"${item.product_name}" has a discount_version without discount_id`,
      );
    }
    if (item.discount_version == null) {
      throw invalid(`"${item.product_name}" has a discount_id without discount_version`);
    }
    if (item.discount_amount % item.quantity !== 0) {
      throw invalid(`discount_amount of "${item.product_name}" must be a multiple of its quantity`);
    }
    if (item.discount_amount > item.line_total) {
      throw invalid(`discount_amount of "${item.product_name}" cannot exceed its line_total`);
    }
  }

  const discountIds = [
    ...new Set(candidates.flatMap((i) => (i.discount_id ? [i.discount_id] : []))),
  ];
  const history = await db
    .select({
      discountId: discountHistory.discountId,
      version: discountHistory.version,
      snapshot: discountHistory.snapshot,
      createdAt: discountHistory.createdAt,
    })
    .from(discountHistory)
    .where(inArray(discountHistory.discountId, discountIds));
  const byDiscount = new Map<string, typeof history>();
  for (const h of history)
    byDiscount.set(h.discountId, [...(byDiscount.get(h.discountId) ?? []), h]);
  const offset = utcOffsetMinutes(args.timezone);

  for (const item of candidates) {
    const discountId = item.discount_id as string;
    const sentVersion = item.discount_version as number;
    const versions = byDiscount.get(discountId) ?? [];
    const sent = versions.find((v) => v.version === sentVersion);
    if (!sent) {
      throw invalid(`Unknown discount or version for "${item.product_name}"`);
    }
    const snapshot = sent.snapshot as DiscountSnapshot;
    const rule = ruleFromSnapshot(discountId, sentVersion, snapshot, args.outletId, offset);
    if (!rule) {
      throw invalid(`Discount "${snapshot.name}" does not cover this outlet`);
    }
    const perUnit = discountPerUnit(item.unit_price, rule.type, rule.value);
    if (item.discount_amount !== perUnit * item.quantity) {
      throw invalid(
        `discount_amount of "${item.product_name}" must be ${perUnit * item.quantity} for "${snapshot.name}" v${sentVersion}`,
      );
    }

    const next = versions.find((v) => v.version === sentVersion + 1);
    const reason: StaleReason | null = snapshot.deleted
      ? 'deleted'
      : (scheduleReason(rule, args.at) ??
        (discountTargets(rule, {
          id: item.product_id,
          categoryId: args.categoryOf.get(item.product_id) ?? null,
        })
          ? null
          : 'not_targeted'));
    const superseded =
      next !== undefined && next.createdAt.getTime() + DISCOUNT_GRACE_MS < args.at.getTime();
    const final = reason ?? (superseded ? 'superseded' : null);
    if (final) {
      result.stale.push({
        item_id: item.id,
        discount_id: discountId,
        sent_version: sentVersion,
        current_version: Math.max(...versions.map((v) => v.version)),
        reason: final,
      });
    }
    result.applied.set(item.id, { discountId, version: sentVersion, name: snapshot.name });
  }

  if (result.stale.length > 0 && args.source === 'api') {
    const first = result.stale[0];
    throw errors.unprocessable(
      'DISCOUNT_STALE',
      'Discount rule changed',
      `The promo rule changed (${first?.reason ?? 'stale'}); pull the catalog, recompute the cart and retry`,
    );
  }
  return result;
}
