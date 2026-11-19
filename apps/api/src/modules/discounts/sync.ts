import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { DiscountRule } from '@kelola-kasir/money';
import type { DbOrTx } from '../../db/client.js';
import { discountOutlets, discounts, discountTargets } from '../../db/schema.js';
import { dateInZone, utcOffsetMinutes } from '../../lib/time.js';

export type DiscountChange =
  | { seq: number; kind: 'discount'; rule: DiscountRule }
  | { seq: number; kind: 'discount_deleted'; id: string };

/**
 * Discount changes of an outlet after `cursor` for `/sync/pull` (ADR-0023 §4). A discount that is deleted,
 * deactivated or no longer covers the outlet becomes a tombstone; a full snapshot (`full`) only holds active
 * discounts that have not ended. The rule carries the targets of this outlet only.
 */
export async function loadDiscountChanges(
  db: DbOrTx,
  input: {
    outletId: string;
    timezone: string;
    after: number;
    full: boolean;
    take: number;
    now: Date;
  },
): Promise<DiscountChange[]> {
  const today = dateInZone(input.now, input.timezone);
  const rows = await db
    .select({ link: discountOutlets, discount: discounts })
    .from(discountOutlets)
    .innerJoin(discounts, eq(discounts.id, discountOutlets.discountId))
    .where(
      and(
        eq(discountOutlets.outletId, input.outletId),
        gt(discountOutlets.updatedSeq, input.after),
        input.full
          ? and(
              isNull(discountOutlets.removedAt),
              isNull(discounts.deletedAt),
              eq(discounts.isActive, true),
              or(
                isNull(discounts.endsOn),
                gt(discounts.endsOn, today),
                eq(discounts.endsOn, today),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(discountOutlets.updatedSeq))
    .limit(input.take);
  if (rows.length === 0) return [];

  const live = rows.filter(
    (r) => !r.link.removedAt && !r.discount.deletedAt && r.discount.isActive,
  );
  const targetRows =
    live.length > 0
      ? await db
          .select()
          .from(discountTargets)
          .where(
            and(
              eq(discountTargets.outletId, input.outletId),
              inArray(
                discountTargets.discountId,
                live.map((r) => r.discount.id),
              ),
            ),
          )
      : [];
  const offset = utcOffsetMinutes(input.timezone);

  return rows.map(({ link, discount }): DiscountChange => {
    const seq = link.updatedSeq;
    if (link.removedAt || discount.deletedAt || !discount.isActive) {
      return { seq, kind: 'discount_deleted', id: discount.id };
    }
    const mine = targetRows.filter((t) => t.discountId === discount.id);
    return {
      seq,
      kind: 'discount',
      rule: {
        id: discount.id,
        version: discount.version,
        name: discount.name,
        type: discount.type as DiscountRule['type'],
        value: discount.value,
        target_type: discount.targetType as DiscountRule['target_type'],
        product_ids: mine.flatMap((t) => (t.productId ? [t.productId] : [])).sort(),
        category_ids: mine.flatMap((t) => (t.categoryId ? [t.categoryId] : [])).sort(),
        starts_on: discount.startsOn,
        ends_on: discount.endsOn,
        days_of_week: discount.daysOfWeek,
        time_start: discount.timeStart,
        time_end: discount.timeEnd,
        utc_offset_minutes: offset,
      },
    };
  });
}
