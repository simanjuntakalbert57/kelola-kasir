import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { csvCell, neutralise } from '../transactions/export.js';
import type { ProductSalesRow } from './products.js';

export const PRODUCT_EXPORT_HEADER = [
  'Produk',
  'Kategori',
  'Cup',
  'Total (Rp)',
  '% omzet',
  'Periode',
  'Cabang',
];

type Cell = string | number;

export interface ProductExport {
  rows: Pick<
    ProductSalesRow,
    'product_name' | 'category_name' | 'items_sold' | 'revenue' | 'share_pct'
  >[];
  totals: { items_sold: number; revenue: number };
  dateFrom: string;
  dateTo: string;
  /** Outlet name, or `Semua cabang`. */
  outletLabel: string;
}

/** Header, one row per product and a total row. */
export function productExportRows(e: ProductExport): Cell[][] {
  const period = e.dateFrom === e.dateTo ? e.dateFrom : `${e.dateFrom} s/d ${e.dateTo}`;
  const body = e.rows.map((r) => [
    r.product_name,
    r.category_name ?? '',
    r.items_sold,
    r.revenue,
    r.share_pct,
    period,
    e.outletLabel,
  ]);
  const total: Cell[] = [
    'Total',
    '',
    e.totals.items_sold,
    e.totals.revenue,
    e.totals.revenue > 0 ? 100 : 0,
    period,
    e.outletLabel,
  ];
  return [PRODUCT_EXPORT_HEADER, ...body, total];
}

/** UTF-8 CSV with a BOM, CRLF line ends and the formula guard of the transaction export. */
export function productCsv(e: ProductExport): Readable {
  const text = productExportRows(e)
    .map((row) => `${row.map(csvCell).join(',')}\r\n`)
    .join('');
  return Readable.from([`\uFEFF${text}`]);
}

/** The list is one row per product (tens of rows), so the workbook is built in memory. */
export async function productXlsx(e: ProductExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Penjualan Produk');
  for (const row of productExportRows(e)) {
    sheet.addRow(row.map((c) => (typeof c === 'string' ? neutralise(c) : c)));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
