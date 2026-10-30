import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { openAsOwner } from '../support/ui.js';

// The import API (DEAR-114) is stubbed at the network layer so this spec can run before it is deployed.
// Run it against staging by removing `stubImportApi` once DEAR-114 is merged.

const SHOTS = process.env['IMPORT_SHOTS_DIR'];

const row = (over: Record<string, unknown>) => ({
  row: 2,
  action: 'create',
  name: 'Jus Jeruk',
  category: 'Jus Buah',
  price: 15000,
  is_favorite: false,
  is_active: true,
  product_id: null,
  category_is_new: false,
  changes: [],
  errors: [],
  ...over,
});

const validPreview = {
  format: 'csv',
  file_sha256: 'a'.repeat(64),
  summary: { total: 3, create: 2, update: 1, unchanged: 0, error: 0 },
  new_categories: ['Kopi'],
  rows: [
    row({}),
    row({ row: 3, name: 'Kopi Susu', category: 'Kopi', price: 18000, category_is_new: true }),
    row({
      row: 4,
      action: 'update',
      name: 'Jus Alpukat',
      price: 16000,
      product_id: '33333333-3333-4333-8333-333333333333',
      changes: [{ field: 'price', before: 15000, after: 16000 }],
    }),
  ],
  warnings: [],
  import_token: 'tok-e2e',
  expires_at: '2099-01-01T00:00:00Z',
};

const errorPreview = {
  ...validPreview,
  summary: { total: 2, create: 1, update: 0, unchanged: 0, error: 1 },
  new_categories: [],
  rows: [
    row({}),
    row({
      row: 3,
      action: 'error',
      name: 'Jus Mangga',
      price: null,
      errors: [
        {
          column: 'harga',
          code: 'INVALID_PRICE',
          message: 'Harga harus angka bulat, contoh 15000 atau Rp15.000',
        },
      ],
    }),
  ],
  import_token: null,
  expires_at: null,
};

async function stubImportApi(page: Page, preview: unknown) {
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/products/import/template*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/csv',
      headers: { 'Content-Disposition': 'attachment; filename="template-impor-produk.csv"' },
      body: 'nama;kategori;harga;favorit;aktif\r\n',
    }),
  );
  await page.route('**/v1/products/import/preview', (route) => json(route, preview));
  await page.route('**/v1/products/import/commit', (route) =>
    json(route, { created: 2, updated: 1, unchanged: 0, categories_created: 1 }),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const csv = (name: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from('nama;kategori\n'),
});

test.describe('Impor produk (DEAR-115)', () => {
  test('unduh template → unggah file valid → simpan → sukses @mobile', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await stubImportApi(page, validPreview);
    await page.getByRole('link', { name: 'Impor produk' }).click();
    await expect(page).toHaveURL(/\/produk\/impor$/);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Template CSV' }).click();
    expect((await download).suggestedFilename()).toBe('template-impor-produk.csv');
    await shot(page, '1-awal');

    await page.getByLabel('File impor produk').setInputFiles(csv('produk.csv'));
    await expect(page.getByText(/File siap disimpan\. 2 produk baru, 1 diperbarui/)).toBeVisible();
    await expect(page.getByText('Rp15.000 → Rp16.000').first()).toBeVisible();
    await shot(page, '2-pratinjau-siap');

    await page.getByRole('button', { name: 'Simpan 3 produk' }).click();
    await expect(page.getByRole('heading', { name: '3 produk berhasil disimpan' })).toBeVisible();
    await shot(page, '3-sukses');
    await page.getByRole('link', { name: 'Lihat daftar produk' }).click();
    await expect(page).toHaveURL(/\/produk$/);
  });

  test('file ber-error: pesan baris tampil dan Simpan nonaktif @mobile', async ({ page }) => {
    await openAsOwner(page, '/produk/impor');
    await stubImportApi(page, errorPreview);
    await page.getByLabel('File impor produk').setInputFiles(csv('bermasalah.csv'));
    await expect(
      page.getByText('Harga harus angka bulat, contoh 15000 atau Rp15.000'),
    ).toBeVisible();
    await expect(page.getByText(/1 baris perlu diperbaiki/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Simpan/ })).toBeDisabled();
    await shot(page, '4-pratinjau-error');
  });
});
