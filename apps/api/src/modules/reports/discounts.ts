import { Readable } from 'node:stream';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { DbOrTx } from '../../db/client.js';
import { discounts, transactionItems, transactions } from '../../db/schema.js';
import { csvCell, neutralise } from '../transactions/export.js';
import { COUNTED_STATUSES, netLine, type Period } from './queries.js';

export interface DiscountSalesRow {
  discount_id: string;
  name: string;
  type: 'percent' | 'amount';
  value: number;
  transaction_count: number;
  items_sold: number;
  gross_revenue: number;
  discount_total: number;
  revenue: number;
}

export interface DiscountSalesReport {
  totals: { discount_total: number; sales_gross: number; sales_discount_total: number };
  data: DiscountSalesRow[];
}

/**
 * Sales per discount (ADR-0023 §5): one row per promo used by a counted item in the period, deleted promos included
 * (current name). Counting rule of `/dashboard/summary`: paid or void_requested, not deleted, WIB period.
 */
export async function loadDiscountSales(
  db: DbOrTx,
  outletIds: string[],
  period: Pick<Period, 'from' | 'to'>,
): Promise<DiscountSalesReport> {
  const sold = and(
    inArray(transactions.outletId, outletIds),
    isNull(transactions.deletedAt),
    gte(transactions.clientCreatedAt, period.from),
    lt(transactions.clientCreatedAt, period.to),
    inArray(transactions.status, [...COUNTED_STATUSES]),
  );
  const [rows, [sales]] = await Promise.all([
    db
      .select({
        id: discounts.id,
        name: discounts.name,
        type: discounts.type,
        value: discounts.value,
        transactionCount: sql<number>`count(distinct ${transactions.id})::int`,
        items: sql<string>`sum(${transactionItems.quantity})::text`,
        gross: sql<string>`sum(${transactionItems.lineTotal})::text`,
        discount: sql<string>`sum(${transactionItems.discountAmount})::text`,
        net: sql<string>`sum(${netLine})::text`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .innerJoin(discounts, eq(discounts.id, transactionItems.discountId))
      .where(sold)
      .groupBy(discounts.id, discounts.name, discounts.type, discounts.value),
    db
      .select({
        gross: sql<string>`coalesce(sum(${transactions.subtotal}), 0)::text`,
        discount: sql<string>`coalesce(sum(${transactions.discountAmount}), 0)::text`,
      })
      .from(transactions)
      .where(sold),
  ]);
  const data = rows
    .map((r): DiscountSalesRow => ({
      discount_id: r.id,
      name: r.name,
      type: r.type as 'percent' | 'amount',
      value: r.value,
      transaction_count: r.transactionCount,
      items_sold: Number(r.items),
      gross_revenue: Number(r.gross),
      discount_total: Number(r.discount),
      revenue: Number(r.net),
    }))
    .sort(
      (a, b) =>
        b.discount_total - a.discount_total ||
        a.name.localeCompare(b.name) ||
        a.discount_id.localeCompare(b.discount_id),
    );
  return {
    totals: {
      discount_total: data.reduce((n, r) => n + r.discount_total, 0),
      sales_gross: Number(sales?.gross ?? 0),
      sales_discount_total: Number(sales?.discount ?? 0),
    },
    data,
  };
}

export const DISCOUNT_EXPORT_HEADER = [
  'Promo',
  'Jenis',
  'Nilai',
  'Transaksi',
  'Cup',
  'Kotor (Rp)',
  'Diskon (Rp)',
  'Bersih (Rp)',
  'Periode',
  'Cabang',
];

type Cell = string | number;

export interface DiscountExport {
  report: DiscountSalesReport;
  dateFrom: string;
  dateTo: string;
  /** Outlet name, or `Semua cabang`. */
  outletLabel: string;
}

/** Header, one row per promo and a total row. */
export function discountExportRows(e: DiscountExport): Cell[][] {
  const period = e.dateFrom === e.dateTo ? e.dateFrom : `${e.dateFrom} s/d ${e.dateTo}`;
  const { data } = e.report;
  const body = data.map((r) => [
    r.name,
    r.type === 'percent' ? 'Persen (%)' : 'Potongan (Rp)',
    r.value,
    r.transaction_count,
    r.items_sold,
    r.gross_revenue,
    r.discount_total,
    r.revenue,
    period,
    e.outletLabel,
  ]);
  const sum = (pick: (r: DiscountSalesRow) => number) => data.reduce((n, r) => n + pick(r), 0);
  const total: Cell[] = [
    'Total',
    '',
    '',
    '',
    sum((r) => r.items_sold),
    sum((r) => r.gross_revenue),
    sum((r) => r.discount_total),
    sum((r) => r.revenue),
    period,
    e.outletLabel,
  ];
  return [DISCOUNT_EXPORT_HEADER, ...body, total];
}

/** UTF-8 CSV with a BOM, CRLF line ends and the formula guard of the transaction export. */
export function discountCsv(e: DiscountExport): Readable {
  const text = discountExportRows(e)
    .map((row) => `${row.map(csvCell).join(',')}\r\n`)
    .join('');
  return Readable.from([`\uFEFF${text}`]);
}

/** One row per promo (tens of rows), so the workbook is built in memory. */
export async function discountXlsx(e: DiscountExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Diskon');
  for (const row of discountExportRows(e)) {
    sheet.addRow(row.map((c) => (typeof c === 'string' ? neutralise(c) : c)));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
