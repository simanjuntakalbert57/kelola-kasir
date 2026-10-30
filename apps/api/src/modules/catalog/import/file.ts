import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { ProductImportColumn } from '@kelola-kasir/contracts';
import { AppError, errors, type FieldError } from '../../../errors.js';

/** A spreadsheet cell as read from the file. `formula` = formula without a usable stored value. */
export type RawCell = string | number | boolean | Date | null | { formula: true };

export interface RawRow {
  /** Row number as shown in Excel (1-based, blank rows counted). */
  row: number;
  cells: Partial<Record<ProductImportColumn, RawCell>>;
}

export interface ImportWarning {
  code: 'UNKNOWN_COLUMN' | 'ENCODING_FALLBACK';
  message: string;
}

export interface ParsedImportFile {
  format: 'csv' | 'xlsx';
  rows: RawRow[];
  warnings: ImportWarning[];
}

// Runtime values are duplicated from `@kelola-kasir/contracts` on purpose: the API image cannot load that
// package's TypeScript source at runtime (only types are imported). `file.test.ts` asserts they match.
export const PRODUCT_IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 500 } as const;
export const PRODUCT_IMPORT_COLUMNS: readonly ProductImportColumn[] = [
  'nama',
  'kategori',
  'harga',
  'favorit',
  'aktif',
];

const REQUIRED: readonly ProductImportColumn[] = ['nama', 'kategori', 'harga'];
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100;
const MAX_PHYSICAL_ROWS = 5000;
const DELIMITERS = [';', ',', '\t'] as const;

const unreadable = (detail: string) =>
  errors.unprocessable('IMPORT_FILE_UNREADABLE', 'File tidak bisa dibaca', detail);

export const importErrors = {
  tooLarge: () =>
    new AppError(
      413,
      'IMPORT_FILE_TOO_LARGE',
      'File terlalu besar',
      `Ukuran file maksimal ${PRODUCT_IMPORT_LIMITS.maxBytes / (1024 * 1024)} MB.`,
    ),
  unsupported: () =>
    new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Jenis file tidak didukung',
      'Gunakan file .csv atau .xlsx.',
    ),
  tooManyRows: () =>
    errors.unprocessable(
      'IMPORT_TOO_MANY_ROWS',
      'Baris terlalu banyak',
      `Maksimal ${PRODUCT_IMPORT_LIMITS.maxRows} baris produk per file.`,
    ),
  columns: (fieldErrors: FieldError[]) =>
    new AppError(
      422,
      'IMPORT_COLUMNS_INVALID',
      'Kolom file tidak sesuai',
      'Judul kolom tidak sesuai template.',
      fieldErrors,
    ),
};

/** Header cell → canonical column: trim, lower-case, drop spaces/`_`/`*` and text in brackets. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[\s_*]+/g, '');
}

const isColumn = (name: string): name is ProductImportColumn =>
  (PRODUCT_IMPORT_COLUMNS as readonly string[]).includes(name);

const startsWith = (buf: Buffer, ...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
const isZip = (buf: Buffer) => startsWith(buf, 0x50, 0x4b, 0x03, 0x04);
const isOle = (buf: Buffer) => startsWith(buf, 0xd0, 0xcf, 0x11, 0xe0);

export function detectFormat(fileName: string, buf: Buffer): 'csv' | 'xlsx' {
  const lower = fileName.trim().toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  if (!lower.includes('.')) throw importErrors.unsupported();
  if (['.xls', '.xlsm', '.xlsb'].includes(ext)) {
    throw unreadable('Format Excel lama atau berisi makro tidak didukung. Simpan sebagai .xlsx.');
  }
  if (ext !== '.csv' && ext !== '.xlsx') throw importErrors.unsupported();
  if (buf.length === 0) throw unreadable('File kosong.');
  if (ext === '.csv') {
    if (isZip(buf) || isOle(buf)) throw importErrors.unsupported();
    return 'csv';
  }
  if (isOle(buf))
    throw unreadable('Format Excel lama (.xls) tidak didukung. Simpan sebagai .xlsx.');
  if (!isZip(buf)) throw importErrors.unsupported();
  return 'xlsx';
}

/** Read the ZIP central directory only: refuses zip bombs and macro workbooks before inflating anything. */
export function inspectZip(buf: Buffer): void {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable('File .xlsx rusak.');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || offset === 0xffffffff) {
    throw unreadable('File .xlsx terlalu besar atau tidak dikenali.');
  }
  if (entries > MAX_ZIP_ENTRIES) throw unreadable('File .xlsx berisi terlalu banyak bagian.');
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw unreadable('File .xlsx rusak.');
    }
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.toString('latin1', offset + 46, offset + 46 + nameLen).toLowerCase();
    if (size === 0xffffffff) throw unreadable('File .xlsx terlalu besar atau tidak dikenali.');
    if (name.endsWith('vbaproject.bin')) {
      throw unreadable('File berisi makro dan tidak diterima. Simpan sebagai .xlsx biasa.');
    }
    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw unreadable('Isi file .xlsx terlalu besar.');
    offset += 46 + nameLen + extraLen + commentLen;
  }
}

function decodeCsv(buf: Buffer, warnings: ImportWarning[]): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    warnings.push({
      code: 'ENCODING_FALLBACK',
      message:
        'File tidak disimpan sebagai UTF-8, dibaca sebagai Windows-1252. Periksa huruf bertanda (é, ñ, dll.).',
    });
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const isBlankLine = (line: string) => /^[\s;,"]*$/.test(line);

function parseLine(line: string, delimiter: string): string[] {
  try {
    const rows = parseCsv(line, {
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    }) as string[][];
    return rows[0] ?? [];
  } catch {
    return [];
  }
}

/** The separator whose header line holds the most required columns (ties: `;`, then `,`). */
function detectDelimiter(text: string): string {
  const header = text.split(/\r\n|\n|\r/).find((l) => !isBlankLine(l)) ?? '';
  let best: string = ';';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const names = parseLine(header, d).map(normalizeHeader);
    const score = REQUIRED.filter((c) => names.includes(c)).length;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function readCsv(buf: Buffer, warnings: ImportWarning[]): RawCell[][] {
  const text = decodeCsv(buf, warnings);
  const delimiter = detectDelimiter(text);
  try {
    const records = parseCsv(text, {
      delimiter,
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as string[][];
    if (records.length > MAX_PHYSICAL_ROWS) throw importErrors.tooManyRows();
    return records;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unreadable('Isi file CSV tidak valid (periksa tanda kutip).');
  }
}

function cellValue(value: ExcelJS.CellValue): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if ('error' in value) return { formula: true };
  if ('formula' in value || 'sharedFormula' in value) {
    const result = (value as { result?: ExcelJS.CellValue }).result;
    if (result === undefined || result === null) return { formula: true };
    return cellValue(result);
  }
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value) {
    const text = value.text as unknown;
    if (typeof text === 'string') return text;
    if (text && typeof text === 'object' && 'richText' in text) {
      return (text as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    }
    return null;
  }
  return null;
}

async function readXlsx(buf: Buffer): Promise<RawCell[][]> {
  inspectZip(buf);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw unreadable('File .xlsx rusak atau tidak bisa dibuka.');
  }
  const sheet =
    workbook.worksheets.find((s) => s.name.trim().toLowerCase() === 'produk') ??
    workbook.worksheets.find((s) => s.name.trim().toLowerCase() !== 'petunjuk');
  if (!sheet) throw unreadable('File tidak punya sheet data.');
  const grid: RawCell[][] = [];
  let tooMany = false;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: RawCell[] = [];
    let any = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const v = cellValue(cell.value);
      if (v === null) return;
      cells[col - 1] = v;
      any = true;
    });
    if (!any) return;
    if (rowNumber > MAX_PHYSICAL_ROWS) {
      tooMany = true;
      return;
    }
    grid[rowNumber - 1] = cells;
  });
  if (tooMany) throw importErrors.tooManyRows();
  return grid;
}

const isEmptyCell = (c: RawCell | undefined): boolean =>
  c === null || c === undefined || (typeof c === 'string' && c.trim() === '');

/** Parse a CSV/XLSX buffer into raw rows keyed by canonical column. Row-level rules live in `plan.ts`. */
export async function parseImportFile(fileName: string, buf: Buffer): Promise<ParsedImportFile> {
  const format = detectFormat(fileName, buf);
  const warnings: ImportWarning[] = [];
  const grid = format === 'csv' ? readCsv(buf, warnings) : await readXlsx(buf);

  let headerIndex = -1;
  for (let i = 0; i < grid.length; i += 1) {
    if ((grid[i] ?? []).some((c) => !isEmptyCell(c))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) throw unreadable('File kosong.');

  const columnAt = new Map<number, ProductImportColumn>();
  const seen = new Map<ProductImportColumn, number>();
  const problems: FieldError[] = [];
  const headerCells = grid[headerIndex] ?? [];
  for (let col = 0; col < headerCells.length; col += 1) {
    const raw = headerCells[col];
    if (isEmptyCell(raw)) continue;
    const text = typeof raw === 'string' ? raw : String(raw);
    const name = normalizeHeader(text);
    if (isColumn(name)) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
      if (seen.get(name) === 2) {
        problems.push({
          path: name,
          message: `Kolom "${name}" muncul lebih dari sekali. Hapus salah satunya.`,
        });
      }
      if (!columnAt.has(col) && seen.get(name) === 1) columnAt.set(col, name);
    } else if (name) {
      warnings.push({
        code: 'UNKNOWN_COLUMN',
        message: `Kolom "${text.trim().slice(0, 40)}" tidak dikenal dan diabaikan.`,
      });
    }
  }
  for (const col of REQUIRED) {
    if (!seen.has(col)) {
      problems.push({
        path: col,
        message: `Kolom "${col}" tidak ditemukan. Gunakan template terbaru.`,
      });
    }
  }
  if (problems.length > 0) throw importErrors.columns(problems);

  const rows: RawRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const line = grid[i] ?? [];
    if (line.every((c) => isEmptyCell(c))) continue;
    const cells: RawRow['cells'] = {};
    for (const [col, name] of columnAt) cells[name] = line[col] ?? null;
    rows.push({ row: i + 1, cells });
    if (rows.length > PRODUCT_IMPORT_LIMITS.maxRows) throw importErrors.tooManyRows();
  }
  return { format, rows, warnings };
}
