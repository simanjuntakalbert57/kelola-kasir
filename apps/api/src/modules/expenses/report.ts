import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../../db/client.js';
import { expenseCategories, expenses, outlets, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { addDays, endOfBusinessDay, startOfBusinessDay } from '../../lib/time.js';
import { revenuePredicate } from '../reports/queries.js';
import { GROUPS } from './service.js';
import type { ScopedOutlet } from './scope.js';

export const MAX_REPORT_MONTHS = 12;

const month = z
  .string()
  .regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM between 2020-01 and 2099-12');
export const reportQuery = z.object({
  outlet_scope: z.enum(['current', 'all']).default('current'),
  month_from: month.optional(),
  month_to: month.optional(),
  include_pre_operations: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

type Group = (typeof GROUPS)[number];
type Funding = 'drawer' | 'owner';

interface CategoryTotal {
  category_id: string | null;
  group: Group;
  name: string;
  amount: number;
  count: number;
}

export interface Cell {
  revenue: number;
  transaction_count: number;
  expense_total: number;
  expense_count: number;
  profit: number;
  by_group: Record<Group, number>;
  by_funding_source: Record<Funding, number>;
  by_category: CategoryTotal[];
}

const emptyCell = (): Cell => ({
  revenue: 0,
  transaction_count: 0,
  expense_total: 0,
  expense_count: 0,
  profit: 0,
  by_group: { hpp: 0, operasional: 0, tetap: 0, lainnya: 0 },
  by_funding_source: { drawer: 0, owner: 0 },
  by_category: [],
});

const nextMonth = (m: string): string => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const lastDayOf = (m: string): string => addDays(`${nextMonth(m)}-01`, -1);

/** Sum cells. `combine` merges categories of different outlets by group + name and drops their ids. */
function sumCells(cells: Cell[], combine: boolean): Cell {
  const out = emptyCell();
  const cats = new Map<string, CategoryTotal>();
  for (const c of cells) {
    out.revenue += c.revenue;
    out.transaction_count += c.transaction_count;
    out.expense_total += c.expense_total;
    out.expense_count += c.expense_count;
    for (const g of GROUPS) out.by_group[g] += c.by_group[g];
    out.by_funding_source.drawer += c.by_funding_source.drawer;
    out.by_funding_source.owner += c.by_funding_source.owner;
    for (const cat of c.by_category) {
      const key = combine
        ? `${cat.group}|${cat.name.toLowerCase()}`
        : (cat.category_id ?? cat.name);
      const have = cats.get(key);
      if (have) {
        have.amount += cat.amount;
        have.count += cat.count;
      } else {
        cats.set(key, { ...cat, category_id: combine ? null : cat.category_id });
      }
    }
  }
  out.profit = out.revenue - out.expense_total;
  out.by_category = [...cats.values()].sort(
    (a, b) =>
      GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) ||
      b.amount - a.amount ||
      a.name.localeCompare(b.name),
  );
  return out;
}

/** Per outlet, drop data before its `operations_started_on` unless `includePre` (DEAR-140). */
const revenueFromStart = (includePre: boolean) =>
  includePre
    ? undefined
    : sql`(${outlets.operationsStartedOn} is null or (${transactions.clientCreatedAt} at time zone ${outlets.timezone})::date >= ${outlets.operationsStartedOn})`;
const expensesFromStart = (includePre: boolean) =>
  includePre
    ? undefined
    : sql`(${outlets.operationsStartedOn} is null or ${expenses.spentOn} >= ${outlets.operationsStartedOn})`;

// Raw literal (not a bind parameter): Postgres must see identical SELECT and GROUP BY expressions.
const MONTH_FORMAT = sql.raw("'YYYY-MM'");

export function resolveMonths(
  q: { month_from?: string | undefined; month_to?: string | undefined },
  currentMonth: string,
  maxMonths: number | null = MAX_REPORT_MONTHS,
): string[] {
  const from = q.month_from ?? q.month_to ?? currentMonth;
  const to = q.month_to ?? q.month_from ?? currentMonth;
  if (to < from) {
    throw errors.validation([{ path: 'month_to', message: 'month_to is before month_from' }]);
  }
  const months: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) months.push(m);
  if (maxMonths !== null && months.length > maxMonths) {
    throw errors.validation([
      { path: 'month_to', message: `The period can span at most ${maxMonths} months` },
    ]);
  }
  return months;
}

/**
 * Monthly expense recap with revenue and simple profit (ADR-0021 §3): one aggregation over `expenses` and one over
 * `transactions` for every outlet and month, merged here. Revenue uses `revenuePredicate`, the rule of the dashboard
 * summary.
 */
export async function loadExpenseReport(
  db: DbOrTx,
  scope: ScopedOutlet[],
  months: string[],
  scopeName: 'current' | 'all',
  includePre: boolean,
) {
  const monthFrom = months[0] as string;
  const monthTo = months[months.length - 1] as string;
  const firstDay = `${monthFrom}-01`;
  const lastDay = lastDayOf(monthTo);
  const ids = scope.map((o) => o.id);

  const txMonth = sql<string>`to_char(${transactions.clientCreatedAt} at time zone ${outlets.timezone}, ${MONTH_FORMAT})`;
  const expMonth = sql<string>`to_char(${expenses.spentOn}, ${MONTH_FORMAT})`;

  const [revenueRows, expenseRows] = await Promise.all([
    db
      .select({
        outletId: transactions.outletId,
        month: txMonth,
        revenue: sql<string>`coalesce(sum(${transactions.total}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .innerJoin(outlets, eq(outlets.id, transactions.outletId))
      .where(
        and(
          inArray(transactions.outletId, ids),
          revenuePredicate(),
          // Coarse range first (index), exact local months next.
          gte(transactions.clientCreatedAt, startOfBusinessDay(addDays(firstDay, -1))),
          lt(transactions.clientCreatedAt, endOfBusinessDay(addDays(lastDay, 1))),
          sql`${txMonth} between ${monthFrom} and ${monthTo}`,
          revenueFromStart(includePre),
        ),
      )
      .groupBy(transactions.outletId, sql`2`),
    db
      .select({
        outletId: expenses.outletId,
        month: expMonth,
        categoryId: expenseCategories.id,
        group: expenseCategories.categoryGroup,
        name: expenseCategories.name,
        funding: expenses.fundingSource,
        amount: sql<string>`sum(${expenses.amount})::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .innerJoin(outlets, eq(outlets.id, expenses.outletId))
      .innerJoin(
        expenseCategories,
        and(
          eq(expenseCategories.id, expenses.categoryId),
          eq(expenseCategories.outletId, expenses.outletId),
        ),
      )
      .where(
        and(
          inArray(expenses.outletId, ids),
          isNull(expenses.deletedAt),
          sql`${expenses.spentOn} between ${firstDay}::date and ${lastDay}::date`,
          expensesFromStart(includePre),
        ),
      )
      .groupBy(expenses.outletId, sql`2`, expenseCategories.id, expenses.fundingSource),
  ]);

  // outletId -> month -> cell
  const cells = new Map<string, Map<string, Cell>>();
  for (const o of scope) cells.set(o.id, new Map(months.map((m) => [m, emptyCell()])));
  const cellOf = (outletId: string, m: string): Cell | undefined => cells.get(outletId)?.get(m);

  for (const r of revenueRows) {
    const cell = cellOf(r.outletId, r.month);
    if (!cell) continue;
    cell.revenue += Number(r.revenue);
    cell.transaction_count += r.n;
  }
  for (const r of expenseRows) {
    const cell = cellOf(r.outletId, r.month);
    if (!cell) continue;
    const amount = Number(r.amount);
    const group = r.group as Group;
    cell.expense_total += amount;
    cell.expense_count += r.n;
    cell.by_group[group] += amount;
    cell.by_funding_source[r.funding as Funding] += amount;
    const existing = cell.by_category.find((c) => c.category_id === r.categoryId);
    if (existing) {
      existing.amount += amount;
      existing.count += r.n;
    } else {
      cell.by_category.push({
        category_id: r.categoryId,
        group,
        name: r.name,
        amount,
        count: r.n,
      });
    }
  }
  // Normalise profit and category order of the raw per-outlet monthly cells.
  const monthCells = (outletId: string, m: string): Cell =>
    sumCells([cellOf(outletId, m) ?? emptyCell()], false);

  const countedFrom = (o: ScopedOutlet, firstDayOfCell: string): string | null =>
    !includePre && o.operationsStartedOn && o.operationsStartedOn > firstDayOfCell
      ? o.operationsStartedOn
      : null;

  const perOutlet = (get: (o: ScopedOutlet) => Cell, firstDayOfCell: string) =>
    scope.map((o) => ({
      outlet_id: o.id,
      counted_from: countedFrom(o, firstDayOfCell),
      ...get(o),
    }));

  return {
    month_from: monthFrom,
    month_to: monthTo,
    outlet_scope: scopeName,
    include_pre_operations: includePre,
    outlets: scope.map((o) => ({
      id: o.id,
      code: o.code,
      name: o.name,
      timezone: o.timezone,
      operations_started_on: o.operationsStartedOn,
    })),
    months: months.map((m) => {
      const per = perOutlet((o) => monthCells(o.id, m), `${m}-01`);
      return { month: m, per_outlet: per, total: sumCells(per, true) };
    }),
    total: (() => {
      const per = perOutlet(
        (o) =>
          sumCells(
            months.map((m) => monthCells(o.id, m)),
            false,
          ),
        firstDay,
      );
      return { per_outlet: per, total: sumCells(per, true) };
    })(),
  };
}

export type ExpenseReport = Awaited<ReturnType<typeof loadExpenseReport>>;
