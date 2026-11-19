import { expect, test } from '@playwright/test';
import { openAsOwner, rp } from '../support/ui.js';

/** DEAR-190: menu Diskon (owner buat → badge produk → nonaktifkan → hapus) dan tampilan manajer (lihat saja). */
test.describe.serial('Diskon item (ADR-0023)', () => {
  test('owner membuat diskon, badge + harga coret muncul di Produk', async ({ page }) => {
    await openAsOwner(page, '/diskon/baru');
    await page.getByLabel('Nama promo').fill('Promo E2E');
    await page.getByLabel('Cari produk').fill('Jus Jeruk');
    await page.getByRole('checkbox', { name: 'Jus Jeruk', exact: true }).check();
    await page.getByLabel('Potongan (%)').fill('20');
    await expect(page.getByLabel('Pratinjau harga akhir')).toContainText(rp(9_600));
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page).toHaveURL(/\/diskon$/);
    const row = page.getByRole('listitem').filter({ hasText: 'Promo E2E' });
    await expect(row).toContainText('Aktif');
    await expect(row).toContainText('20%');

    await page.goto('/produk');
    const product = page.getByRole('listitem').filter({ hasText: 'Diskon 20% · Promo E2E' });
    await expect(product).toContainText('Diskon 20% · Promo E2E');
    await expect(product).toContainText(rp(9_600));
  });

  test('manajer hanya bisa melihat', async ({ page }) => {
    await openAsOwner(page, '/diskon', 'manager@e2e.test');
    await expect(page.getByRole('link', { name: /Buat diskon/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Promo E2E/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Tampilan lihat saja');
    await expect(dialog.getByRole('button', { name: 'Nonaktifkan' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Hapus' })).toHaveCount(0);
  });

  test('owner menonaktifkan lalu menghapus diskon', async ({ page }) => {
    await openAsOwner(page, '/diskon');
    await page.getByRole('button', { name: /Promo E2E/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Nonaktifkan' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tutup' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Promo E2E' })).toContainText(
      'Nonaktif',
    );
    await page.getByRole('button', { name: /Promo E2E/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Hapus' }).click();
    await page.getByLabel('Alasan (wajib)').fill('Uji E2E selesai');
    await page.getByRole('button', { name: 'Ya, hapus' }).click();
    await expect(page.getByRole('button', { name: /Promo E2E/ })).toHaveCount(0);
  });
});
