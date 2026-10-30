import ExcelJS from 'exceljs';

const HEADER = ['nama', 'kategori', 'harga', 'favorit', 'aktif'] as const;
const EXAMPLES: [string, string, number, string, string][] = [
  ['Jus Jeruk', 'Jus Buah', 15000, 'ya', 'ya'],
  ['Jus Alpukat', 'Jus Buah', 18000, 'tidak', 'ya'],
];
const LAST_ROW = 501;

/** Copy of the Petunjuk sheet from docs/design/impor-produk (DEAR-113). */
const INSTRUCTIONS: string[] = [
  'Cara mengisi template produk',
  'Isi sheet "Produk". Satu baris = satu produk. Jangan ubah, hapus, atau pindah baris judul (baris 1).',
  'Dua baris contoh (Jus Jeruk, Jus Alpukat) boleh dihapus atau diganti dengan produk Anda.',
  '',
  'Kolom',
  'nama (wajib): nama produk, contoh: Jus Mangga.',
  'kategori (wajib): contoh: Jus Buah. Kalau kategori belum ada, otomatis dibuat.',
  'harga (wajib): angka Rupiah tanpa koma di belakang. Contoh: 15000. Boleh juga 15.000 atau Rp15.000.',
  'favorit (boleh kosong): ya atau tidak. Kalau kosong dianggap tidak. Produk favorit tampil di urutan atas kasir.',
  'aktif (boleh kosong): ya atau tidak. "ya" = muncul di kasir. "tidak" = disembunyikan. Kalau kosong dianggap ya.',
  '',
  'Aturan',
  'Maksimal 500 baris dan ukuran file 2 MB.',
  'Kalau nama produk sudah ada di toko ini (huruf besar/kecil dianggap sama), produk itu DIPERBARUI, bukan dobel.',
  'Produk tidak pernah dihapus lewat impor.',
  'Foto produk tidak lewat file. Tambahkan foto nanti dari halaman Produk.',
  'Kalau ada baris yang salah, tidak ada produk yang disimpan. Perbaiki baris itu lalu unggah lagi.',
  'File boleh disimpan sebagai .xlsx atau .csv.',
];

const BOM = String.fromCodePoint(0xfeff);
export const TEMPLATE_BASENAME = 'template-impor-produk';

export async function buildXlsxTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Produk', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: HEADER[0], key: 'nama', width: 32 },
    { header: HEADER[1], key: 'kategori', width: 22 },
    { header: HEADER[2], key: 'harga', width: 14, style: { numFmt: '#,##0' } },
    { header: HEADER[3], key: 'favorit', width: 12 },
    { header: HEADER[4], key: 'aktif', width: 12 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
  EXAMPLES.forEach((row) => sheet.addRow(row));
  for (let r = 2; r <= LAST_ROW; r += 1) {
    sheet.getCell(`C${r}`).numFmt = '#,##0';
    for (const col of ['D', 'E']) {
      sheet.getCell(`${col}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"ya,tidak"'],
      };
    }
  }
  const help = wb.addWorksheet('Petunjuk');
  help.getColumn(1).width = 110;
  INSTRUCTIONS.forEach((line, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = line || null;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (line === 'Cara mengisi template produk') cell.font = { bold: true, size: 14 };
    if (line === 'Kolom' || line === 'Aturan') cell.font = { bold: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** UTF-8 + BOM, `;` separator and CRLF so Indonesian-locale Excel opens it in columns. */
export function buildCsvTemplate(): Buffer {
  const lines = [HEADER.join(';'), ...EXAMPLES.map((r) => r.join(';'))];
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}
