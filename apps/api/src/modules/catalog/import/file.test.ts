import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../errors.js';
import { inspectZip, normalizeHeader, parseImportFile, type RawRow } from './file.js';
import { buildCsvTemplate, buildXlsxTemplate } from './template.js';

const csv = (text: string | Buffer) =>
  typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
const BOM = String.fromCodePoint(0xfeff);
const HEADER = 'nama;kategori;harga;favorit;aktif';

async function fails(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the promise to reject');
}

const names = (rows: RawRow[]) => rows.map((r) => r.cells.nama);

/** Minimal ZIP: a local header signature, a central directory with the given entries and an EOCD. */
function fakeZip(entries: { name: string; size: number }[]): Buffer {
  const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const cds = entries.map(({ name, size }) => {
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.write(name, 46, 'latin1');
    return cd;
  });
  const cd = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cd, eocd]);
}

describe('normalizeHeader', () => {
  it.each([
    ['Nama', 'nama'],
    ['  NAMA PRODUK ', 'namaproduk'],
    ['Harga (Rp)', 'harga'],
    ['harga*', 'harga'],
    ['Kate_gori', 'kategori'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe('CSV parsing', () => {
  it.each([
    ['semicolon', ';'],
    ['comma', ','],
    ['tab', '\t'],
  ])('detects the %s separator', async (_label, d) => {
    const text = ['nama', 'kategori', 'harga', 'favorit', 'aktif']
      .join(d)
      .concat('\r\n', ['Jus Jeruk', 'Jus', '15000', 'ya', 'ya'].join(d), '\r\n');
    const parsed = await parseImportFile('x.csv', csv(text));
    expect(parsed.format).toBe('csv');
    expect(parsed.rows).toEqual([
      {
        row: 2,
        cells: { nama: 'Jus Jeruk', kategori: 'Jus', harga: '15000', favorit: 'ya', aktif: 'ya' },
      },
    ]);
  });

  it('prefers ";" when a comma is only a thousands separator inside quotes', async () => {
    const parsed = await parseImportFile('x.csv', csv(`${HEADER}\nEs Teh;Minuman;"15,000";;\n`));
    expect(parsed.rows[0]?.cells.harga).toBe('15,000');
  });

  it('strips a UTF-8 BOM', async () => {
    const parsed = await parseImportFile('x.csv', csv(`${BOM}${HEADER}\nA;B;1;;\n`));
    expect(names(parsed.rows)).toEqual(['A']);
    expect(parsed.warnings).toEqual([]);
  });

  it('falls back to Windows-1252 with a warning', async () => {
    const body = Buffer.concat([
      Buffer.from(`${HEADER}\nCaf`, 'latin1'),
      Buffer.from([0xe9]),
      Buffer.from(';Kopi;20000;;\n', 'latin1'),
    ]);
    const parsed = await parseImportFile('x.csv', body);
    expect(names(parsed.rows)).toEqual(['Café']);
    expect(parsed.warnings.map((w) => w.code)).toEqual(['ENCODING_FALLBACK']);
  });

  it('supports RFC 4180 quoting', async () => {
    const parsed = await parseImportFile(
      'x.csv',
      csv(`${HEADER}\n"Nasi; Goreng ""Spesial""";Makanan;25000;;\n`),
    );
    expect(parsed.rows[0]?.cells.nama).toBe('Nasi; Goreng "Spesial"');
  });

  it('accepts shuffled, upper-case and spaced headers and warns about unknown columns', async () => {
    const parsed = await parseImportFile(
      'x.csv',
      csv('Aktif;HARGA (Rp);Catatan;Kategori;Nama Produk;nama\nya;1000;x;K;Satu;Dua\n'),
    ).catch((e: unknown) => e);
    // "Nama Produk" is not "nama": only the exact column counts, "Nama Produk" is unknown.
    expect(parsed).not.toBeInstanceOf(Error);
    const ok = parsed as Awaited<ReturnType<typeof parseImportFile>>;
    expect(ok.rows[0]?.cells).toEqual({ aktif: 'ya', harga: '1000', kategori: 'K', nama: 'Dua' });
    expect(ok.warnings.map((w) => w.code)).toEqual(['UNKNOWN_COLUMN', 'UNKNOWN_COLUMN']);
  });

  it('reports missing required columns with the column name as path', async () => {
    const err = await fails(parseImportFile('x.csv', csv('nama;harga\nA;1\n')));
    expect(err.status).toBe(422);
    expect(err.code).toBe('IMPORT_COLUMNS_INVALID');
    expect(err.errors?.map((e) => e.path)).toEqual(['kategori']);
  });

  it('reports duplicated columns', async () => {
    const err = await fails(parseImportFile('x.csv', csv('nama;kategori;harga;Harga\nA;B;1;2\n')));
    expect(err.code).toBe('IMPORT_COLUMNS_INVALID');
    expect(err.errors?.map((e) => e.path)).toEqual(['harga']);
  });

  it('skips blank lines but keeps spreadsheet row numbers', async () => {
    const parsed = await parseImportFile('x.csv', csv(`\n${HEADER}\nA;K;1;;\n\n;;;;\nB;K;2;;\n\n`));
    expect(parsed.rows.map((r) => [r.row, r.cells.nama])).toEqual([
      [3, 'A'],
      [6, 'B'],
    ]);
  });

  it('accepts 500 data rows and rejects 501', async () => {
    const make = (n: number) =>
      csv(`${HEADER}\n${Array.from({ length: n }, (_, i) => `P${i};K;1;;`).join('\n')}\n`);
    expect((await parseImportFile('x.csv', make(500))).rows).toHaveLength(500);
    const err = await fails(parseImportFile('x.csv', make(501)));
    expect(err.status).toBe(422);
    expect(err.code).toBe('IMPORT_TOO_MANY_ROWS');
  });

  it('rejects an empty or header-less file', async () => {
    expect((await fails(parseImportFile('x.csv', Buffer.alloc(0)))).code).toBe(
      'IMPORT_FILE_UNREADABLE',
    );
    expect((await fails(parseImportFile('x.csv', csv('\n\n;;\n')))).code).toBe(
      'IMPORT_FILE_UNREADABLE',
    );
  });

  it('accepts a header-only file as zero rows', async () => {
    expect((await parseImportFile('x.csv', csv(`${HEADER}\n`))).rows).toEqual([]);
  });
});

describe('format detection', () => {
  it('uses extension and magic bytes, not the part content type', async () => {
    expect((await fails(parseImportFile('x.txt', csv(HEADER)))).status).toBe(415);
    expect((await fails(parseImportFile('noext', csv(HEADER)))).status).toBe(415);
    expect((await fails(parseImportFile('x.csv', fakeZip([])))).status).toBe(415);
    expect((await fails(parseImportFile('x.xlsx', csv(HEADER)))).status).toBe(415);
  });

  it.each(['x.xls', 'x.xlsm', 'x.xlsb'])('rejects %s as unreadable', async (name) => {
    const err = await fails(parseImportFile(name, fakeZip([])));
    expect(err.status).toBe(422);
    expect(err.code).toBe('IMPORT_FILE_UNREADABLE');
  });

  it('rejects an OLE (.xls) file renamed to .xlsx', async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect((await fails(parseImportFile('x.xlsx', ole))).code).toBe('IMPORT_FILE_UNREADABLE');
  });

  it('rejects macro workbooks and zip bombs from the central directory', async () => {
    const macro = fakeZip([{ name: 'xl/vbaProject.bin', size: 10 }]);
    expect((await fails(parseImportFile('x.xlsx', macro))).code).toBe('IMPORT_FILE_UNREADABLE');
    const bomb = fakeZip([{ name: 'xl/worksheets/sheet1.xml', size: 20 * 1024 * 1024 + 1 }]);
    expect((await fails(parseImportFile('x.xlsx', bomb))).code).toBe('IMPORT_FILE_UNREADABLE');
    const many = fakeZip(Array.from({ length: 101 }, (_, i) => ({ name: `f${i}`, size: 1 })));
    expect(() => inspectZip(many)).toThrow(AppError);
    expect(() => inspectZip(fakeZip([{ name: 'xl/workbook.xml', size: 1000 }]))).not.toThrow();
  });

  it('rejects a corrupt .xlsx', async () => {
    const err = await fails(
      parseImportFile(
        'x.xlsx',
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), csv('garbage')]),
      ),
    );
    expect(err.code).toBe('IMPORT_FILE_UNREADABLE');
  });
});

async function workbook(build: (produk: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet('Produk'), wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('XLSX parsing', () => {
  it('reads the Produk sheet, not Petunjuk', async () => {
    const buf = await workbook((_s, wb) => {
      const help = wb.addWorksheet('Petunjuk');
      help.addRow(['nama', 'kategori', 'harga']);
      help.addRow(['SALAH', 'x', 1]);
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    wb.getWorksheet('Produk')?.addRow(['nama', 'kategori', 'harga']);
    wb.getWorksheet('Produk')?.addRow(['Benar', 'K', 5000]);
    const out = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parseImportFile('x.xlsx', out);
    expect(parsed.rows).toEqual([{ row: 2, cells: { nama: 'Benar', kategori: 'K', harga: 5000 } }]);
  });

  it('falls back to the first sheet that is not Petunjuk', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Petunjuk').addRow(['bukan data']);
    const data = wb.addWorksheet('Sheet1');
    data.addRow(['nama', 'kategori', 'harga']);
    data.addRow(['A', 'K', 1]);
    const parsed = await parseImportFile('x.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(names(parsed.rows)).toEqual(['A']);
  });

  it('uses stored formula results and flags formulas without one', async () => {
    const buf = await workbook((s) => {
      s.addRow(['nama', 'kategori', 'harga', 'favorit']);
      const r = s.addRow(['A', 'K', null, null]);
      r.getCell(3).value = { formula: '1000+500', result: 1500 };
      r.getCell(4).value = { formula: 'B1' } as ExcelJS.CellFormulaValue;
      const e = s.addRow(['B', 'K', null, null]);
      e.getCell(3).value = {
        formula: 'A9',
        result: { error: '#REF!' },
      } as ExcelJS.CellFormulaValue;
    });
    const parsed = await parseImportFile('x.xlsx', buf);
    expect(parsed.rows[0]?.cells.harga).toBe(1500);
    expect(parsed.rows[0]?.cells.favorit).toEqual({ formula: true });
    expect(parsed.rows[1]?.cells.harga).toEqual({ formula: true });
  });

  it('reads rich text, hyperlinks, booleans and dates', async () => {
    const buf = await workbook((s) => {
      s.addRow(['nama', 'kategori', 'harga', 'favorit', 'aktif']);
      const r = s.addRow([null, null, 1, true, new Date(Date.UTC(2026, 0, 1))]);
      r.getCell(1).value = {
        richText: [{ text: 'Jus ' }, { text: 'Mangga', font: { bold: true } }],
      };
      r.getCell(2).value = { text: 'Jus Buah', hyperlink: 'https://example.com' };
    });
    const cells = (await parseImportFile('x.xlsx', buf)).rows[0]?.cells;
    expect(cells?.nama).toBe('Jus Mangga');
    expect(cells?.kategori).toBe('Jus Buah');
    expect(cells?.favorit).toBe(true);
    expect(cells?.aktif).toBeInstanceOf(Date);
  });

  it('skips blank rows and rejects more than 500 data rows', async () => {
    const buf = await workbook((s) => {
      s.addRow(['nama', 'kategori', 'harga']);
      s.addRow(['A', 'K', 1]);
      s.addRow([]);
      s.addRow(['B', 'K', 2]);
    });
    expect((await parseImportFile('x.xlsx', buf)).rows.map((r) => r.row)).toEqual([2, 4]);
    const big = await workbook((s) => {
      s.addRow(['nama', 'kategori', 'harga']);
      for (let i = 0; i < 501; i += 1) s.addRow([`P${i}`, 'K', 1]);
    });
    expect((await fails(parseImportFile('x.xlsx', big))).code).toBe('IMPORT_TOO_MANY_ROWS');
  });
});

describe('templates', () => {
  it('round-trips the CSV template through the parser', async () => {
    const buf = buildCsvTemplate();
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(buf.toString('utf8')).toContain('nama;kategori;harga;favorit;aktif\r\n');
    const parsed = await parseImportFile('template-impor-produk.csv', buf);
    expect(parsed.warnings).toEqual([]);
    expect(names(parsed.rows)).toEqual(['Jus Jeruk', 'Jus Alpukat']);
  });

  it('round-trips the XLSX template through the parser', async () => {
    const parsed = await parseImportFile('template-impor-produk.xlsx', await buildXlsxTemplate());
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        cells: {
          nama: 'Jus Jeruk',
          kategori: 'Jus Buah',
          harga: 15000,
          favorit: 'ya',
          aktif: 'ya',
        },
      },
      {
        row: 3,
        cells: {
          nama: 'Jus Alpukat',
          kategori: 'Jus Buah',
          harga: 18000,
          favorit: 'tidak',
          aktif: 'ya',
        },
      },
    ]);
  });

  it('has a frozen header, the Petunjuk sheet and ya/tidak validation', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildXlsxTemplate()) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Produk', 'Petunjuk']);
    const produk = wb.getWorksheet('Produk');
    expect(produk?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(produk?.getCell('C2').numFmt).toBe('#,##0');
    expect(produk?.getCell('D10').dataValidation?.formulae).toEqual(['"ya,tidak"']);
    expect(wb.getWorksheet('Petunjuk')?.getCell('A1').value).toBe('Cara mengisi template produk');
  });
});
