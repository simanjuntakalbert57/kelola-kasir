import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import {
  categories,
  employees,
  outlets,
  products,
  transactionItems,
  transactions,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import type { ScopedOutlet } from '../expenses/scope.js';
import { COUNTED_STATUSES, type Period } from './queries.js';

/** Product names compare case-, outer-space- and repeated-space-insensitively (ADR-0022 §3). */
const normName = (col: SQL | typeof products.name | typeof transactionItems.productName) =>
  sql<string>`regexp_replace(lower(btrim(${col})), '[[:space:]]+', ' ', 'g')`;

const changePct = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
const sharePct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

/** Transactions of the outlets in the period that are revenue (same predicate as `/dashboard/summary`). */
const soldIn = (outletIds: string[], period: Pick<Period, 'from' | 'to'>) =>
  and(
    inArray(transactions.outletId, outletIds),
    isNull(transactions.deletedAt),
    gte(transactions.clientCreatedAt, period.from),
    lt(transactions.clientCreatedAt, period.to),
    inArray(transactions.status, [...COUNTED_STATUSES]),
  );

export interface ProductSalesRow {
  key: string;
  product_id: string | null;
  product_name: string;
  category_name: string | null;
  catalog_price: number;
  items_sold: number;
  revenue: number;
  share_pct: number;
  transaction_count: number;
  has_sales: boolean;
}

/** A row plus the catalog products it stands for (the detail endpoint finds its product through it). */
export interface ProductGroup extends ProductSalesRow {
  memberIds: string[];
  /** In the list (live catalog product or sold in the period); the rest only exist to resolve a detail. */
  listed: boolean;
}

export interface ProductSalesList {
  totals: { items_sold: number; revenue: number; product_count: number };
  groups: ProductGroup[];
}

interface CatalogRow {
  id: string;
  outletId: string;
  outletCode: string;
  name: string;
  norm: string;
  categoryName: string | null;
  price: number;
  live: boolean;
}

/** Default order of the list: cups desc, Rupiah desc, name asc. */
const byDefault = (a: ProductSalesRow, b: ProductSalesRow): number =>
  b.items_sold - a.items_sold ||
  b.revenue - a.revenue ||
  a.product_name.localeCompare(b.product_name);

/**
 * Every product of the scope with its sales in the period: one aggregate over the items and one catalog query,
 * merged here (no N+1). `forceIds` are catalog products that must be loaded even when deleted, inactive or unsold.
 */
export async function loadProductSales(
  db: DbOrTx,
  scope: ScopedOutlet[],
  activeOutletId: string,
  merge: boolean,
  period: Pick<Period, 'from' | 'to'>,
  forceIds: string[] = [],
): Promise<ProductSalesList> {
  const outletIds = scope.map((o) => o.id);
  const sales = await db
    .select({
      productId: transactionItems.productId,
      // A snapshot only identifies items whose product no longer exists.
      snapshot: sql<
        string | null
      >`case when ${transactionItems.productId} is null then ${transactionItems.productName} end`,
      snapshotNorm: sql<
        string | null
      >`case when ${transactionItems.productId} is null then ${normName(transactionItems.productName)} end`,
      quantity: sql<string>`sum(${transactionItems.quantity})::text`,
      revenue: sql<string>`sum(${transactionItems.lineTotal})::text`,
      transactionCount: sql<number>`count(distinct ${transactions.id})::int`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(soldIn(outletIds, period))
    .groupBy(
      transactionItems.productId,
      sql`case when ${transactionItems.productId} is null then ${transactionItems.productName} end`,
      sql`case when ${transactionItems.productId} is null then ${normName(transactionItems.productName)} end`,
    );

  const soldIds = [
    ...new Set([...sales.flatMap((s) => (s.productId ? [s.productId] : [])), ...forceIds]),
  ];
  const live = and(sql`${products.deletedAt} is null`, eq(products.isActive, true));
  const catalog: CatalogRow[] = (
    await db
      .select({
        id: products.id,
        outletId: products.outletId,
        outletCode: outlets.code,
        name: products.name,
        norm: normName(products.name),
        categoryName: categories.name,
        price: products.price,
        live: sql<boolean>`(${products.deletedAt} is null and ${products.isActive})`,
      })
      .from(products)
      .innerJoin(outlets, eq(outlets.id, products.outletId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(
        and(
          inArray(products.outletId, outletIds),
          soldIds.length > 0 ? or(live, inArray(products.id, soldIds)) : live,
        ),
      )
  ).map((c) => ({ ...c, price: Number(c.price) }));

  // Group key: the product id (current) or the normalized name (all, and sold items without a product).
  interface Acc {
    key: string;
    members: CatalogRow[];
    snapshotName: string | null;
    items: number;
    revenue: number;
    transactions: number;
  }
  const accs = new Map<string, Acc>();
  const acc = (key: string): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, members: [], snapshotName: null, items: 0, revenue: 0, transactions: 0 };
      accs.set(key, a);
    }
    return a;
  };
  const keyOfProduct = (c: CatalogRow) => (merge ? `name:${c.norm}` : c.id);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const c of catalog) acc(keyOfProduct(c)).members.push(c);
  for (const s of sales) {
    const member = s.productId ? byId.get(s.productId) : undefined;
    const target = member
      ? acc(keyOfProduct(member))
      : acc(`name:${merge ? (s.snapshotNorm ?? '') : (s.snapshot ?? '')}`);
    if (!member) target.snapshotName ??= s.snapshot;
    target.items += Number(s.quantity);
    target.revenue += Number(s.revenue);
    target.transactions += s.transactionCount;
  }

  // Representative: the active outlet's product, then the smallest outlet code, live before deleted.
  const repOrder = (x: CatalogRow, y: CatalogRow): number =>
    Number(y.outletId === activeOutletId) - Number(x.outletId === activeOutletId) ||
    x.outletCode.localeCompare(y.outletCode) ||
    Number(y.live) - Number(x.live) ||
    x.id.localeCompare(y.id);
  const groups: ProductGroup[] = [...accs.values()].map((a) => {
    const [rep] = [...a.members].sort(repOrder);
    return {
      key: a.key,
      product_id: rep?.id ?? null,
      product_name: rep?.name ?? a.snapshotName ?? '',
      category_name: rep?.categoryName ?? null,
      catalog_price: rep?.price ?? 0,
      items_sold: a.items,
      revenue: a.revenue,
      share_pct: 0,
      transaction_count: a.transactions,
      has_sales: a.items > 0,
      memberIds: a.members.map((m) => m.id),
      listed: a.items > 0 || a.members.some((m) => m.live),
    };
  });

  const listed = groups.filter((g) => g.listed);
  const totals = {
    items_sold: listed.reduce((n, g) => n + g.items_sold, 0),
    revenue: listed.reduce((n, g) => n + g.revenue, 0),
    product_count: listed.length,
  };
  for (const g of groups) g.share_pct = sharePct(g.revenue, totals.revenue);
  return { totals, groups };
}

export type ProductSort = 'items_sold' | 'revenue' | 'share_pct' | 'name';

export function sortProducts<T extends ProductSalesRow>(
  rows: T[],
  sort: ProductSort,
  order: 'asc' | 'desc',
): T[] {
  const dir = order === 'asc' ? 1 : -1;
  const primary = (a: T, b: T): number => {
    if (sort === 'name') return a.product_name.localeCompare(b.product_name);
    if (sort === 'items_sold') return a.items_sold - b.items_sold;
    return a.revenue - b.revenue;
  };
  return [...rows].sort((a, b) => dir * primary(a, b) || byDefault(a, b));
}

export interface ResolvedProduct {
  /** Catalog products whose sales are summed (several only for `all`). */
  memberIds: string[];
  norm: string | null;
  /** Items without a product join the group when their snapshot name matches (`all` only). */
  mergeSnapshots: boolean;
}

/** The product must belong to the scope's outlets, else `404` (also for another outlet's product). */
export async function resolveProduct(
  db: DbOrTx,
  scope: ScopedOutlet[],
  productId: string,
  merge: boolean,
): Promise<ResolvedProduct> {
  const outletIds = scope.map((o) => o.id);
  const [target] = await db
    .select({ norm: normName(products.name) })
    .from(products)
    .where(and(eq(products.id, productId), inArray(products.outletId, outletIds)));
  if (!target) throw errors.notFound('Product not found');
  if (!merge) return { memberIds: [productId], norm: target.norm, mergeSnapshots: false };
  const members = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(inArray(products.outletId, outletIds), sql`${normName(products.name)} = ${target.norm}`),
    )
    .orderBy(asc(products.id));
  return { memberIds: members.map((m) => m.id), norm: target.norm, mergeSnapshots: true };
}

const forGroup = (g: ResolvedProduct): SQL | undefined =>
  g.mergeSnapshots
    ? or(
        inArray(transactionItems.productId, g.memberIds),
        and(
          sql`${transactionItems.productId} is null`,
          sql`${normName(transactionItems.productName)} = ${g.norm}`,
        ),
      )
    : inArray(transactionItems.productId, g.memberIds);

interface Sum {
  items_sold: number;
  revenue: number;
}

const sumOf = (rows: { quantity: string | null; revenue: string | null }[]): Sum => ({
  items_sold: rows.reduce((n, r) => n + Number(r.quantity ?? 0), 0),
  revenue: rows.reduce((n, r) => n + Number(r.revenue ?? 0), 0),
});

export async function loadProductDetail(
  db: DbOrTx,
  scope: ScopedOutlet[],
  activeOutletId: string,
  merge: boolean,
  productId: string,
  period: Period,
) {
  const group = await resolveProduct(db, scope, productId, merge);
  const outletIds = scope.map((o) => o.id);
  const previous = {
    from: new Date(period.from.getTime() - (period.to.getTime() - period.from.getTime())),
    to: period.from,
  };
  const items = (outlets_: string[], p: Pick<Period, 'from' | 'to'>) =>
    and(soldIn(outlets_, p), forGroup(group));
  const quantity = sql<string>`sum(${transactionItems.quantity})::text`;
  const revenue = sql<string>`sum(${transactionItems.lineTotal})::text`;

  const [list, before, byMethod, byOutlet, byEmployee] = await Promise.all([
    loadProductSales(db, scope, activeOutletId, merge, period, group.memberIds),
    db
      .select({ quantity, revenue })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .where(items(outletIds, previous)),
    db
      .select({ method: transactions.paymentMethod, quantity, revenue })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .where(items(outletIds, period))
      .groupBy(transactions.paymentMethod),
    merge
      ? db
          .select({ outletId: transactions.outletId, quantity, revenue })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
          .where(items(outletIds, period))
          .groupBy(transactions.outletId)
      : Promise.resolve([]),
    db
      .select({
        employeeId: transactions.employeeId,
        employeeName: employees.name,
        outletName: outlets.name,
        quantity,
        revenue,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .innerJoin(employees, eq(employees.id, transactions.employeeId))
      .innerJoin(outlets, eq(outlets.id, transactions.outletId))
      .where(items(outletIds, period))
      .groupBy(transactions.employeeId, employees.name, outlets.name),
  ]);

  const memberIds = new Set(group.memberIds);
  const row = list.groups.find((g) => g.memberIds.some((id) => memberIds.has(id)));
  if (!row) throw errors.notFound('Product not found');

  const ahead = list.groups.filter((g) => g.listed && g !== row && byDefault(g, row) < 0).length;
  const prev = sumOf(before);
  const methods = new Map(byMethod.map((m) => [m.method, m]));
  const outletRows = new Map(byOutlet.map((o) => [o.outletId, o]));

  return {
    product_id: productId,
    product_name: row.product_name,
    category_name: row.category_name,
    catalog_price: row.catalog_price,
    outlet_scope: merge ? ('all' as const) : ('current' as const),
    date_from: period.dateFrom,
    date_to: period.dateTo,
    items_sold: row.items_sold,
    revenue: row.revenue,
    average_price: row.items_sold > 0 ? Math.floor(row.revenue / row.items_sold) : 0,
    share_pct: row.share_pct,
    transaction_count: row.transaction_count,
    rank: ahead + 1,
    product_count: list.totals.product_count + (row.listed ? 0 : 1),
    compare_previous_period: {
      items_sold_change_pct: changePct(row.items_sold, prev.items_sold),
      revenue_change_pct: changePct(row.revenue, prev.revenue),
    },
    by_payment_method: (['cash', 'qris'] as const).map((method) => {
      const m = methods.get(method);
      const rev = Number(m?.revenue ?? 0);
      return {
        method,
        items_sold: Number(m?.quantity ?? 0),
        revenue: rev,
        share_pct: sharePct(rev, row.revenue),
      };
    }),
    by_outlet: merge
      ? scope.map((o) => ({
          outlet_id: o.id,
          outlet_name: o.name,
          items_sold: Number(outletRows.get(o.id)?.quantity ?? 0),
          revenue: Number(outletRows.get(o.id)?.revenue ?? 0),
        }))
      : [],
    by_employee: byEmployee
      .map((e) => ({
        employee_id: e.employeeId,
        employee_name: e.employeeName,
        outlet_name: e.outletName,
        items_sold: Number(e.quantity),
        revenue: Number(e.revenue),
      }))
      .sort(
        (a, b) =>
          b.items_sold - a.items_sold ||
          b.revenue - a.revenue ||
          a.employee_name.localeCompare(b.employee_name),
      ),
  };
}

// Raw literal (not a bind parameter): Postgres must see identical SELECT and GROUP BY expressions.
const WIB = sql.raw("'Asia/Jakarta'");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cups and Rupiah of one product per WIB hour or day; empty buckets are zero-filled. */
export async function loadProductSeries(
  db: DbOrTx,
  scope: ScopedOutlet[],
  merge: boolean,
  productId: string,
  period: Period,
  granularity: 'hour' | 'day',
) {
  const group = await resolveProduct(db, scope, productId, merge);
  const unit = sql.raw(`'${granularity}'`);
  const bucket = sql<Date>`(date_trunc(${unit}, ${transactions.clientCreatedAt} at time zone ${WIB}) at time zone ${WIB})`;
  const rows = await db
    .select({
      bucket,
      quantity: sql<string>`sum(${transactionItems.quantity})::text`,
      revenue: sql<string>`sum(${transactionItems.lineTotal})::text`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(
      and(
        soldIn(
          scope.map((o) => o.id),
          period,
        ),
        forGroup(group),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const byStart = new Map(rows.map((r) => [new Date(r.bucket).getTime(), r]));
  const step = granularity === 'hour' ? 60 * 60 * 1000 : DAY_MS;
  const data: { bucket_start: string; items_sold: number; revenue: number }[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += step) {
    const row = byStart.get(t);
    data.push({
      bucket_start: new Date(t).toISOString(),
      items_sold: Number(row?.quantity ?? 0),
      revenue: Number(row?.revenue ?? 0),
    });
  }
  return data;
}
