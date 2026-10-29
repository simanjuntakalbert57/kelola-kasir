import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seed } from '../support/state.js';
import { openAsOwner, rp } from '../support/ui.js';

/** Seed hari ini: 9 transaksi (lihat global-setup). */
test.describe('Daftar transaksi & ekspor (TC-LST-01/02/03)', () => {
  test('TC-LST-01 daftar menampilkan semua status; badge sesuai @mobile', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    await expect(page.getByText('Menampilkan 8 transaksi')).toBeVisible();
    const list = page
      .getByRole('list')
      .filter({ has: page.getByRole('button', { name: /^Detail / }) });
    await expect(list.getByText('Lunas', { exact: true })).toHaveCount(5);
    await expect(list.getByText('Nunggu persetujuan batal', { exact: true })).toHaveCount(2);
    await expect(list.getByText('Batal', { exact: true })).toHaveCount(1);
  });

  test('TC-LST-01 filter metode, status, pegawai bisa dikombinasikan', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    await page.getByLabel('Metode').selectOption('qris');
    await expect(page.getByText(/^Menampilkan \d+ transaksi$/)).toHaveText(
      'Menampilkan 3 transaksi',
    );
    await page.getByLabel('Status').selectOption('cancelled');
    await expect(page.getByText('Menampilkan 1 transaksi')).toBeVisible();
    await page.getByLabel('Status').selectOption('');
    await page.getByLabel('Metode').selectOption('cash');
    await page.getByLabel('Pegawai').selectOption({ label: 'Budi E2E' });
    await expect(page.getByText('Menampilkan 3 transaksi')).toBeVisible();
    await page.getByLabel('Status').selectOption('void_requested');
    await expect(page.getByText('Menampilkan 2 transaksi')).toBeVisible();
  });

  test('filter tanpa hasil menampilkan empty state dan reset filter', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    await page.getByLabel('Status').selectOption('voided');
    await expect(page.getByText('Belum ada transaksi di rentang ini.')).toBeVisible();
    await page.getByRole('button', { name: 'Reset filter' }).click();
    await expect(page.getByText('Menampilkan 8 transaksi')).toBeVisible();
  });

  test('pencarian nama pembeli; >60 karakter tidak membuat error 400', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    await page.getByLabel('Cari').fill('Pak Haji');
    await expect(page.getByText('Menampilkan 1 transaksi')).toBeVisible();
    await page.getByLabel('Cari').fill('x'.repeat(80));
    // Diharapkan: daftar kosong atau input dibatasi; bukan pesan error mentah.
    await expect(page.getByText(/Belum ada transaksi di rentang ini\.|Menampilkan/)).toBeVisible();
    await expect(page.getByText(/400|validation|Bad Request/i)).toHaveCount(0);
  });

  test('TC-LST-03 detail: item snapshot, total, tunai & kembalian', async ({ page }) => {
    const { s1Cash } = seed();
    await openAsOwner(page, '/transaksi');
    await page.getByRole('button', { name: `Detail ${s1Cash.number}` }).click();
    // Desktop: side panel; mobile: dialog.
    const dlg = page
      .getByRole('complementary', { name: 'Detail transaksi' })
      .or(page.getByRole('dialog'));
    await expect(dlg).toContainText('2× Jus Alpukat');
    await expect(dlg).toContainText(rp(30_000));
    await expect(dlg).toContainText(/Tunai Rp\s?50\.000 · kembalian Rp\s?20\.000/);
  });

  test('TC-LST-02 ekspor CSV: baris & total sama dengan layar, uang integer @cross-browser', async ({
    page,
  }) => {
    await openAsOwner(page, '/transaksi');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /CSV/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const path = await download.path();
    const csv = readFileSync(path, 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length - 1).toBe(8);
    expect(csv).not.toMatch(/\d+[.,]\d{2}\b(?!\d)/); // tanpa desimal pada kolom uang
    expect(csv).toContain('Pak Haji');
  });

  test('TC-LST-02 ekspor Excel terunduh sebagai .xlsx', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Excel/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 2).toString()).toBe('PK'); // zip container
  });
});
