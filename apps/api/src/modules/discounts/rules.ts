import { z } from 'zod';
import type { DiscountRule, DiscountType } from '@kelola-kasir/money';
import { errors } from '../../errors.js';
import { businessDate, uuid } from '../../lib/validate.js';

/** Past this long after a new version replaced it, a phone's older version is "stale" (ADR-0023 §3 = MAX_CLOCK_SKEW). */
export const DISCOUNT_GRACE_MS = 10 * 60 * 1000;

export type DiscountStatus = 'active' | 'scheduled' | 'ended' | 'inactive' | 'deleted';
export type DiscountAction = 'create' | 'update' | 'activate' | 'deactivate' | 'delete';

/** Per-outlet targets of a discount. */
export interface OutletTargets {
  product_ids: string[];
  category_ids: string[];
}

/**
 * Full rule after a change, stored in `discount_history.snapshot` (ADR-0023 §1). Besides the audit trail this is the
 * version store transaction validation reads, so its shape is a contract with already written rows.
 */
export interface DiscountSnapshot {
  name: string;
  target_type: 'product' | 'category';
  type: DiscountType;
  value: number;
  starts_on: string;
  ends_on: string | null;
  days_of_week: number[] | null;
  time_start: string | null;
  time_end: string | null;
  is_active: boolean;
  deleted: boolean;
  /** Outlets the discount covers (not removed), by outlet id. */
  targets: Record<string, OutletTargets>;
}

/** The fields an owner edits; also the keys of `discount_history.changes`. */
export const RULE_FIELDS = [
  'name',
  'target_type',
  'type',
  'value',
  'starts_on',
  'ends_on',
  'days_of_week',
  'time_start',
  'time_end',
  'is_active',
] as const;

const unique = (list: readonly unknown[]) => new Set(list).size === list.length;
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Expected HH:MM');
const idList = z.array(uuid).min(1).max(200).refine(unique, 'Ids must be unique');
const weekdays = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine(unique, 'Days must be unique');

const ruleShape = {
  name: z.string().trim().min(1).max(60),
  target_type: z.enum(['product', 'category']),
  type: z.enum(['percent', 'amount']),
  value: z.number().int().min(1).max(100_000_000),
  starts_on: businessDate,
  ends_on: businessDate.nullable(),
  days_of_week: weekdays.nullable(),
  time_start: hhmm.nullable(),
  time_end: hhmm.nullable(),
};

export const discountInput = z.object({
  name: ruleShape.name,
  target_type: ruleShape.target_type,
  type: ruleShape.type,
  value: ruleShape.value,
  starts_on: ruleShape.starts_on,
  ends_on: ruleShape.ends_on.optional(),
  days_of_week: ruleShape.days_of_week.optional(),
  time_start: ruleShape.time_start.optional(),
  time_end: ruleShape.time_end.optional(),
  is_active: z.boolean().default(true),
  product_ids: idList.optional(),
  category_ids: idList.optional(),
});
export type DiscountInput = z.output<typeof discountInput>;

export const discountUpdate = z.object({
  version: z.number().int().min(1),
  name: ruleShape.name.optional(),
  target_type: ruleShape.target_type.optional(),
  type: ruleShape.type.optional(),
  value: ruleShape.value.optional(),
  starts_on: ruleShape.starts_on.optional(),
  ends_on: ruleShape.ends_on.optional(),
  days_of_week: ruleShape.days_of_week.optional(),
  time_start: ruleShape.time_start.optional(),
  time_end: ruleShape.time_end.optional(),
  is_active: z.boolean().optional(),
  product_ids: idList.optional(),
  category_ids: idList.optional(),
});
export type DiscountUpdate = z.output<typeof discountUpdate>;

export const deleteInput = z.object({ reason: z.string().trim().min(5).max(200) });

export const listQuery = z.object({
  outlet_scope: z.enum(['current', 'all']).default('current'),
  status: z.enum(['active', 'scheduled', 'ended', 'inactive', 'deleted']).optional(),
});

/** The editable fields of a discount as one value (what `validateRule` checks). */
export interface RuleFields {
  name: string;
  target_type: 'product' | 'category';
  type: DiscountType;
  value: number;
  starts_on: string;
  ends_on: string | null;
  days_of_week: number[] | null;
  time_start: string | null;
  time_end: string | null;
  is_active: boolean;
}

/** Rules that span several fields. Throws `VALIDATION_ERROR` (400). */
export function validateRule(r: RuleFields): void {
  const problems: { path: string; message: string }[] = [];
  if (r.type === 'percent' && r.value > 100) {
    problems.push({ path: 'value', message: 'A percent discount is 1-100' });
  }
  if (r.ends_on !== null && r.ends_on < r.starts_on) {
    problems.push({ path: 'ends_on', message: 'ends_on is before starts_on' });
  }
  if ((r.time_start === null) !== (r.time_end === null)) {
    problems.push({ path: 'time_start', message: 'time_start and time_end are set together' });
  } else if (r.time_start !== null && r.time_end !== null && r.time_start >= r.time_end) {
    problems.push({ path: 'time_end', message: 'time_end must be after time_start' });
  }
  if (problems.length > 0) throw errors.validation(problems);
}

/** Today's local date decides the derived status; `deleted` > `inactive` > `scheduled` > `ended` > `active`. */
export function statusOf(
  row: {
    deletedAt: Date | null;
    isActive: boolean;
    startsOn: string;
    endsOn: string | null;
  },
  today: string,
): DiscountStatus {
  if (row.deletedAt) return 'deleted';
  if (!row.isActive) return 'inactive';
  if (today < row.startsOn) return 'scheduled';
  if (row.endsOn !== null && row.endsOn < today) return 'ended';
  return 'active';
}

/** Order of the list: active, scheduled, inactive, ended (deleted last). */
export const STATUS_ORDER: Record<DiscountStatus, number> = {
  active: 0,
  scheduled: 1,
  inactive: 2,
  ended: 3,
  deleted: 4,
};

/** The rule a snapshot stands for in one outlet, or `null` when the snapshot does not cover that outlet. */
export function ruleFromSnapshot(
  discountId: string,
  version: number,
  snapshot: DiscountSnapshot,
  outletId: string,
  utcOffsetMinutes: number,
): DiscountRule | null {
  const targets = snapshot.targets[outletId];
  if (!targets) return null;
  return {
    id: discountId,
    version,
    name: snapshot.name,
    type: snapshot.type,
    value: snapshot.value,
    target_type: snapshot.target_type,
    product_ids: targets.product_ids,
    category_ids: targets.category_ids,
    starts_on: snapshot.starts_on,
    ends_on: snapshot.ends_on,
    days_of_week: snapshot.days_of_week,
    time_start: snapshot.time_start,
    time_end: snapshot.time_end,
    utc_offset_minutes: utcOffsetMinutes,
    is_active: snapshot.is_active && !snapshot.deleted,
  };
}
