import { PassThrough, Readable } from 'node:stream';
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { Database } from '../../db/client.js';
import { transactionItems, transactions } from '../../db/schema.js';
import { loadEmployees } from '../shifts/summary.js';

export const EXPORT_BATCH = 500;

export interface ExportFilter {
  outletId: string;
  from?: Date | undefined;
  /** Exclusive. */
  to?: Date | undefined;
  employeeId?: string | undefined;
  paymentMethod?: 'cash' | 'qris' | undefined;
  status?: 'pending' | 'paid' | 'void_requested' | 'voided' | 'cancelled' | undefined;
  /** One row per item instead of per transaction. */
  detail: boolean;
  /** Rows fetched per query (tests lower it to cross batch boundaries). */
  batchSize?: number | undefined;
}

type Cell = string | number | null;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  paid: 'Lunas',
  void_requested: 'Menunggu void',
  voided: 'Void',
  cancelled: 'Dibatalkan',
};
const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS' };

export const SUMMARY_HEADER = [
  'Nomor',
  'Waktu (WIB)',
  'Kasir',
  'Status',
  'Metode',
  'Pelanggan',
  'Jumlah item',
  'Subtotal',
  'Diskon',
  'Pajak',
  'Total',
];
export const DETAIL_HEADER = [
  'Nomor',
  'Waktu (WIB)',
  'Kasir',
  'Status',
  'Metode',
  'Pelanggan',
  'Produk',
  'Qty',
  'Harga satuan',
  'Total baris',
  'Catatan',
];

/** `yyyy-mm-dd hh:mm:ss` in WIB (UTC+7, no DST). */
export const wibTimestamp = (at: Date): string =>
  new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Rows in batches (keyset on time + id), so memory stays flat however large the export is. Only
 * rows of one batch are in memory at a time.
 */
async function* exportRows(db: Database, f: ExportFilter): AsyncGenerator<Cell[]> {
  const size = f.batchSize ?? EXPORT_BATCH;
  let cursor: { t: Date; id: string } | undefined;
  for (;;) {
    const conditions: SQL[] = [eq(transactions.outletId, f.outletId)];
    conditions.push(isNull(transactions.deletedAt));
    if (f.from) conditions.push(gte(transactions.clientCreatedAt, f.from));
    if (f.to) conditions.push(lt(transactions.clientCreatedAt, f.to));
    if (f.employeeId) conditions.push(eq(transactions.employeeId, f.employeeId));
    if (f.paymentMethod) conditions.push(eq(transactions.paymentMethod, f.paymentMethod));
    if (f.status) conditions.push(eq(transactions.status, f.status));
    if (cursor) {
      const after = or(
        gt(transactions.clientCreatedAt, cursor.t),
        and(eq(transactions.clientCreatedAt, cursor.t), gt(transactions.id, cursor.id)),
      );
      if (after) conditions.push(after);
    }
    const batch = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(asc(transactions.clientCreatedAt), asc(transactions.id))
      .limit(size);
    if (batch.length === 0) return;

    const ids = batch.map((r) => r.id);
    const [people, items] = await Promise.all([
      loadEmployees(db, [...new Set(batch.map((r) => r.employeeId))]),
      db
        .select()
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, ids))
        .orderBy(asc(transactionItems.id)),
    ]);
    for (const row of batch) {
      const lines = items.filter((i) => i.transactionId === row.id);
      const head = [
        row.number,
        wibTimestamp(row.clientCreatedAt),
        people.get(row.employeeId)?.name ?? '',
        STATUS_LABEL[row.status] ?? row.status,
        METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod,
        row.customerLabel,
      ];
      if (f.detail) {
        for (const i of lines) {
          yield [...head, i.productName, i.quantity, i.unitPrice, i.lineTotal, i.note];
        }
      } else {
        yield [
          ...head,
          lines.reduce((n, i) => n + i.quantity, 0),
          row.subtotal,
          row.discountAmount,
          row.taxAmount,
          row.total,
        ];
      }
    }
    const last = batch[batch.length - 1];
    if (!last || batch.length < size) return;
    cursor = { t: last.clientCreatedAt, id: last.id };
  }
}

/**
 * Text cells that a spreadsheet would evaluate as a formula get a leading `'` (CSV/Excel injection):
 * customer labels and product names are typed by cashiers.
 */
export const neutralise = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const text = neutralise(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 CSV with a BOM (Excel then opens Indonesian text correctly), CRLF line ends. */
export function csvStream(db: Database, f: ExportFilter): Readable {
  const header = f.detail ? DETAIL_HEADER : SUMMARY_HEADER;
  async function* lines(): AsyncGenerator<string> {
    yield `\uFEFF${header.map(csvCell).join(',')}\r\n`;
    for await (const row of exportRows(db, f)) yield `${row.map(csvCell).join(',')}\r\n`;
  }
  return Readable.from(lines());
}

/** XLSX written with ExcelJS's streaming writer: rows are flushed as they are committed. */
export function xlsxStream(db: Database, f: ExportFilter): Readable {
  const out = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: false });
  const sheet = workbook.addWorksheet('Transaksi');
  sheet.addRow(f.detail ? DETAIL_HEADER : SUMMARY_HEADER).commit();
  void (async () => {
    try {
      for await (const row of exportRows(db, f)) {
        const cells = row.map((c) => (typeof c === 'string' ? neutralise(c) : c));
        // Backpressure: wait for the socket instead of buffering the whole sheet.
        sheet.addRow(cells).commit();
        if (out.writableNeedDrain) await new Promise((r) => out.once('drain', r));
      }
      sheet.commit();
      await workbook.commit();
    } catch (err) {
      out.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return out;
}
