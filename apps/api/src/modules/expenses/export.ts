import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { EXPENSE_GROUP_LABELS } from '@kelola-kasir/contracts';
import type { Database } from '../../db/client.js';
import { expenseCategories, expenses, outlets, users } from '../../db/schema.js';
import { csvCell, neutralise, wibTimestamp } from '../transactions/export.js';
import type { ExpenseReport } from './report.js';
import type { ExpenseService, ListQuery } from './service.js';

export const EXPENSE_HEADER = [
  'Tanggal',
  'Cabang',
  'Kelompok',
  'Kategori',
  'Keterangan',
  'Jumlah',
  'Sumber dana',
  'Ada nota',
  'Dicatat oleh',
  'Dicatat pada (WIB)',
];
export const RECAP_HEADER = [
  'Bulan',
  'Cabang',
  'Omzet',
  'Bahan jus (HPP)',
  'Operasional',
  'Tetap',
  'Lainnya',
  'Total pengeluaran',
  'Laba sederhana',
];

type Cell = string | number | null;
const FUNDING_LABEL = { drawer: 'Kas laci cabang', owner: 'Uang owner' } as const;

export type ExportQuery = Omit<ListQuery, 'cursor' | 'limit' | 'status' | 'outlet_scope'>;

/** Expense rows (oldest first) of the outlets, without those before each outlet's operations start. */
export async function loadExportRows(
  db: Database,
  service: ExpenseService,
  outletIds: string[],
  q: ExportQuery,
  includePre: boolean,
): Promise<Cell[][]> {
  const rows = await db
    .select({
      e: expenses,
      outletCode: outlets.code,
      outletName: outlets.name,
      group: expenseCategories.categoryGroup,
      category: expenseCategories.name,
      creator: users.name,
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
    .innerJoin(users, eq(users.id, expenses.createdBy))
    .where(
      and(
        ...service.filters(outletIds, q),
        isNull(expenses.deletedAt),
        includePre ? undefined : service.fromOperationsStart(),
      ),
    )
    .orderBy(asc(expenses.spentOn), asc(outlets.code), asc(expenses.createdAt), desc(expenses.id));
  return rows.map((r) => [
    r.e.spentOn,
    r.outletName,
    EXPENSE_GROUP_LABELS[r.group as keyof typeof EXPENSE_GROUP_LABELS],
    r.category,
    r.e.description,
    r.e.amount,
    FUNDING_LABEL[r.e.fundingSource as keyof typeof FUNDING_LABEL],
    r.e.receiptImageKey ? 'Ya' : 'Tidak',
    r.creator,
    wibTimestamp(r.e.createdAt),
  ]);
}

/** UTF-8 CSV with a BOM and CRLF line ends, same dialect and injection guard as the transaction export. */
export function expensesCsv(rows: Cell[][]): string {
  return `\uFEFF${[EXPENSE_HEADER, ...rows].map((r) => `${r.map(csvCell).join(',')}\r\n`).join('')}`;
}

/** Rows of the `Rekap` sheet: per month and outlet, then a total row when several outlets are combined. */
export function recapRows(report: ExpenseReport): Cell[][] {
  const row = (label: string, branch: string, c: ExpenseReport['total']['total']): Cell[] => [
    label,
    branch,
    c.revenue,
    c.by_group.hpp,
    c.by_group.operasional,
    c.by_group.tetap,
    c.by_group.lainnya,
    c.expense_total,
    c.profit,
  ];
  const nameOf = new Map(report.outlets.map((o) => [o.id, o.name]));
  const out: Cell[][] = [];
  for (const m of report.months) {
    for (const o of m.per_outlet) out.push(row(m.month, nameOf.get(o.outlet_id) ?? '', o));
    if (report.outlets.length > 1) out.push(row(m.month, 'Semua cabang', m.total));
  }
  const period = `${report.month_from} s.d. ${report.month_to}`;
  for (const o of report.total.per_outlet) {
    out.push(row(period, nameOf.get(o.outlet_id) ?? '', o));
  }
  if (report.outlets.length > 1) out.push(row(period, 'Semua cabang', report.total.total));
  return out;
}

export async function expensesXlsx(rows: Cell[][], recap: Cell[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const list = workbook.addWorksheet('Pengeluaran');
  list.addRow(EXPENSE_HEADER);
  for (const r of rows) list.addRow(r.map((c) => (typeof c === 'string' ? neutralise(c) : c)));
  const sheet = workbook.addWorksheet('Rekap');
  sheet.addRow(RECAP_HEADER);
  for (const r of recap) sheet.addRow(r.map((c) => (typeof c === 'string' ? neutralise(c) : c)));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
