import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openAsOwner } from '../support/ui.js';

const SHOTS = process.env['IMPORT_SHOTS_DIR'];
const SCHEME = process.env['IMPORT_COLOR_SCHEME'] === 'dark' ? 'dark' : 'light';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const HEADER = 'nama;kategori;harga;favorit;aktif';
// Names carry a run suffix so a Playwright retry does not hit rows that already exist.
const run = Date.now().toString(36);

const csv = (name: string, rows: string[]) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(`${HEADER}\r\n${rows.join('\r\n')}\r\n`),
});

test.describe('Impor produk (DEAR-115)', () => {
  test.beforeEach(({ page }) => page.emulateMedia({ colorScheme: SCHEME }));

  test('unduh template → unggah file valid → simpan → sukses @mobile', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await page.getByRole('link', { name: 'Impor produk' }).click();
    await expect(page).toHaveURL(/\/produk\/impor$/);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Template CSV' }).click();
    expect((await download).suggestedFilename()).toBe('template-impor-produk.csv');
    await shot(page, '1-awal');

    await page.getByLabel('File impor produk').setInputFiles(
      csv('produk.csv', [
        `Jus Jeruk ${run};Jus Buah ${run};15000;;`,
        `Kopi Susu ${run};Jus Buah ${run};18000;ya;`,
      ]),
    );
    await expect(page.getByText(/File siap disimpan\. 2 produk baru/)).toBeVisible();
    await shot(page, '2-pratinjau-siap');

    await page.getByRole('button', { name: 'Simpan 2 produk' }).click();
    await expect(page.getByRole('heading', { name: '2 produk berhasil disimpan' })).toBeVisible();
    await shot(page, '3-sukses');
    await page.getByRole('link', { name: 'Lihat daftar produk' }).click();
    await expect(page).toHaveURL(/\/produk$/);
    await expect(page.getByText(`Jus Jeruk ${run}`)).toBeVisible();
  });

  test('file ber-error: pesan baris tampil dan Simpan nonaktif @mobile', async ({ page }) => {
    await openAsOwner(page, '/produk/impor');
    await page.getByLabel('File impor produk').setInputFiles(
      csv('bermasalah.csv', [
        `Jus Mangga ${run};Jus Buah ${run};15000;;`,
        `Jus Nanas ${run};Jus Buah ${run};abc;;`,
      ]),
    );
    await expect(page.getByText(/Harga harus angka bulat/)).toBeVisible();
    await expect(page.getByText(/1 baris perlu diperbaiki/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Simpan/ })).toBeDisabled();
    await shot(page, '4-pratinjau-error');
  });
});
