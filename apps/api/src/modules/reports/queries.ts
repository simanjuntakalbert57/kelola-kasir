import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../../db/client.js';
import { employees, transactionItems, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { endOfBusinessDay, startOfBusinessDay } from '../../lib/time.js';
import { wibDate } from '../transactions/access.js';

/** Statuses that count as revenue: `void_requested` stays in until the owner decides (TDD §3.3). */
export const COUNTED_STATUSES = ['paid', 'void_requested'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_DAYS = 366;
export const MAX_HOURLY_DAYS = 31;

export const rangeQuery = z.object({
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
});

export interface Period {
  from: Date;
  /** Exclusive. */
  to: Date;
  /** Inclusive business dates (WIB). */
  dateFrom: string;
  dateTo: string;
  days: number;
}

/** Inclusive WIB business-date range; missing bounds default to today. */
export function resolvePeriod(
  q: { date_from?: string | undefined; date_to?: string | undefined },
  now: Date,
  maxDays = MAX_REPORT_DAYS,
): Period {
  const today = wibDate(now);
  const dateFrom = q.date_from ?? q.date_to ?? today;
  const dateTo = q.date_to ?? q.date_from ?? today;
  const from = startOfBusinessDay(dateFrom);
  const to = endOfBusinessDay(dateTo);
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days < 1) {
    throw errors.validation([{ path: 'date_to', message: 'date_to is before date_from' }]);
  }
  if (days > maxDays) {
    throw errors.validation([
      { path: 'date_to', message: `The period can span at most ${maxDays} days` },
    ]);
  }
  return { from, to, dateFrom, dateTo, days };
}

const inPeriod = (outletId: string, period: Pick<Period, 'from' | 'to'>) =>
  and(
    eq(transactions.outletId, outletId),
    gte(transactions.clientCreatedAt, period.from),
    lt(transactions.clientCreatedAt, period.to),
  );

const counted = inArray(transactions.status, [...COUNTED_STATUSES]);

export interface SummaryTotals {
  revenue: number;
  transactionCount: number;
  cashRevenue: number;
  qrisRevenue: number;
  cashCount: number;
  qrisCount: number;
  voidedCount: number;
  pendingVoidCount: number;
}

export async function loadSummary(
  db: DbOrTx,
  outletId: string,
  period: Pick<Period, 'from' | 'to'>,
): Promise<SummaryTotals> {
  const rows = await db
    .select({
      status: transactions.status,
      method: transactions.paymentMethod,
      n: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${transactions.total}), 0)::text`,
    })
    .from(transactions)
    .where(
      and(
        inPeriod(outletId, period),
        inArray(transactions.status, ['paid', 'void_requested', 'voided']),
      ),
    )
    .groupBy(transactions.status, transactions.paymentMethod);

  const t: SummaryTotals = {
    revenue: 0,
    transactionCount: 0,
    cashRevenue: 0,
    qrisRevenue: 0,
    cashCount: 0,
    qrisCount: 0,
    voidedCount: 0,
    pendingVoidCount: 0,
  };
  for (const r of rows) {
    if (r.status === 'voided') {
      t.voidedCount += r.n;
      continue;
    }
    const amount = Number(r.amount);
    t.revenue += amount;
    t.transactionCount += r.n;
    if (r.method === 'cash') {
      t.cashRevenue += amount;
      t.cashCount += r.n;
    } else {
      t.qrisRevenue += amount;
      t.qrisCount += r.n;
    }
    if (r.status === 'void_requested') t.pendingVoidCount += r.n;
  }
  return t;
}

// Raw literals (not bind parameters): Postgres must see identical SELECT and GROUP BY expressions.
const WIB = sql.raw("'Asia/Jakarta'");

/** Sales per WIB hour or day. Empty buckets are filled with zeros so charts have no gaps. */
export async function loadSalesSeries(
  db: DbOrTx,
  outletId: string,
  period: Period,
  granularity: 'hour' | 'day',
) {
  const unit = sql.raw(`'${granularity}'`);
  const bucket = sql<Date>`(date_trunc(${unit}, ${transactions.clientCreatedAt} at time zone ${WIB}) at time zone ${WIB})`;
  const rows = await db
    .select({
      bucket,
      revenue: sql<string>`sum(${transactions.total})::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(inPeriod(outletId, period), counted))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const byStart = new Map(rows.map((r) => [new Date(r.bucket).getTime(), r]));

  const step = granularity === 'hour' ? 60 * 60 * 1000 : DAY_MS;
  const data: { bucket_start: string; revenue: number; transaction_count: number }[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += step) {
    const row = byStart.get(t);
    data.push({
      bucket_start: new Date(t).toISOString(),
      revenue: row ? Number(row.revenue) : 0,
      transaction_count: row?.n ?? 0,
    });
  }
  return data;
}

/** Same product (by id; by name when the product was deleted) summed over counted transactions. */
export async function loadTopProducts(db: DbOrTx, outletId: string, period: Period, limit: number) {
  const key = sql`coalesce(${transactionItems.productId}::text, 'name:' || ${transactionItems.productName})`;
  const quantity = sql<number>`sum(${transactionItems.quantity})::int`;
  const revenue = sql<string>`sum(${transactionItems.lineTotal})::text`;
  const rows = await db
    .select({
      productId: sql<string | null>`max(${transactionItems.productId}::text)`,
      // The newest snapshot name wins when a product was renamed.
      name: sql<string>`(array_agg(${transactionItems.productName} order by ${transactions.clientCreatedAt} desc))[1]`,
      quantity,
      revenue,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(and(inPeriod(outletId, period), counted))
    .groupBy(key)
    .orderBy(sql`${quantity} desc`, sql`${revenue}::bigint desc`, key)
    .limit(limit);
  return rows.map((r) => ({
    product_id: r.productId,
    product_name: r.name,
    quantity: r.quantity,
    revenue: Number(r.revenue),
  }));
}

export type GroupBy = 'product' | 'employee' | 'payment_method' | 'day';

export async function loadSalesReport(
  db: DbOrTx,
  outletId: string,
  period: Period,
  groupBy: GroupBy,
) {
  if (groupBy === 'product') {
    const rows = await db
      .select({
        key: sql<string>`coalesce(${transactionItems.productId}::text, 'name:' || ${transactionItems.productName})`,
        label: sql<string>`(array_agg(${transactionItems.productName} order by ${transactions.clientCreatedAt} desc))[1]`,
        quantity: sql<number>`sum(${transactionItems.quantity})::int`,
        transactionCount: sql<number>`count(distinct ${transactions.id})::int`,
        revenue: sql<string>`sum(${transactionItems.lineTotal})::text`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .where(and(inPeriod(outletId, period), counted))
      .groupBy(sql`1`)
      .orderBy(sql`sum(${transactionItems.lineTotal}) desc`, sql`1`);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      quantity: r.quantity,
      transaction_count: r.transactionCount,
      revenue: Number(r.revenue),
    }));
  }

  const itemQuantity = sql<number>`coalesce(sum((select sum(i.quantity) from transaction_items i where i.transaction_id = "transactions"."id")), 0)::int`;
  const groupExpr =
    groupBy === 'employee'
      ? sql<string>`${transactions.employeeId}::text`
      : groupBy === 'payment_method'
        ? sql<string>`${transactions.paymentMethod}`
        : sql<string>`to_char(${transactions.clientCreatedAt} at time zone ${WIB}, 'YYYY-MM-DD')`;
  const groupOrdinal = sql`1`;
  const rows = await db
    .select({
      key: groupExpr,
      quantity: itemQuantity,
      transactionCount: sql<number>`count(*)::int`,
      revenue: sql<string>`sum(${transactions.total})::text`,
    })
    .from(transactions)
    .where(and(inPeriod(outletId, period), counted))
    .groupBy(groupOrdinal)
    .orderBy(groupBy === 'day' ? groupOrdinal : sql`sum(${transactions.total}) desc`, groupOrdinal);

  let labels = new Map<string, string>();
  if (groupBy === 'employee' && rows.length > 0) {
    const people = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(
        inArray(
          employees.id,
          rows.map((r) => r.key),
        ),
      );
    labels = new Map(people.map((p) => [p.id, p.name]));
  }
  const paymentLabel: Record<string, string> = { cash: 'Tunai', qris: 'QRIS' };
  return rows.map((r) => ({
    key: r.key,
    label:
      groupBy === 'employee'
        ? (labels.get(r.key) ?? r.key)
        : groupBy === 'payment_method'
          ? (paymentLabel[r.key] ?? r.key)
          : r.key,
    quantity: r.quantity,
    transaction_count: r.transactionCount,
    revenue: Number(r.revenue),
  }));
}
