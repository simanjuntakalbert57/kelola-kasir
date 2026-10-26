import { expect, test } from '@playwright/test';
import { openAsOwner, rp } from '../support/ui.js';

/**
 * Seed (support/global-setup.ts), hari ini WIB:
 *   paid cash 30.000 + 12.000 + 45.000 + (v1 24.000 + v2 12.000 = void_requested, tetap dihitung)
 *   paid QRIS 15.000 + 12.000; QRIS cancelled 15.000 TIDAK dihitung
 *   omzet = 30+12+15 + 45+24+12+12 = 150.000, 7 transaksi (5 cash, 2 QRIS), rata-rata 21.428 (150.000 / 7 = 21.428,57; API membulatkan ke bawah)
 */
test.describe('Dashboard (TC-DSH-01/02, O-02)', () => {
  test('TC-DSH-01 omzet = paid + void_requested, tanpa pending/cancelled/voided @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/');
    const omzet = page.locator('div', { hasText: /^Omzet/ }).first();
    await expect(omzet).toContainText(rp(150_000));
  });

  test('TC-DSH-02 jumlah transaksi, rata-rata, split cash/QRIS konsisten', async ({ page }) => {
    await openAsOwner(page, '/');
    await expect(page.getByText('Transaksi', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('5 cash · 2 QRIS')).toBeVisible();
    await expect(page.getByText(/^7$/).first()).toBeVisible();
    await expect(page.getByText(rp(21_428)).first()).toBeVisible();
  });

  test('produk terlaris tampil dengan qty dan omzet', async ({ page }) => {
    await openAsOwner(page, '/');
    await expect(page.getByRole('heading', { name: 'Terlaris' })).toBeVisible();
    await expect(page.getByText('Jus Alpukat').first()).toBeVisible();
    await expect(page.getByText('Jus Jeruk').first()).toBeVisible();
  });

  test('peringatan shift terbuka dan void menunggu', async ({ page }) => {
    await openAsOwner(page, '/');
    await expect(page.getByText(/Shift terbuka \(Budi E2E\)/)).toBeVisible();
    await expect(page.getByText(/2 permintaan void menunggu persetujuan/)).toBeVisible();
  });
});
