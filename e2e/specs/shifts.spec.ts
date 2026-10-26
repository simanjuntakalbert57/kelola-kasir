import { expect, test } from '@playwright/test';
import { openAsOwner, rp } from '../support/ui.js';

/**
 * Shift 1 (Siti, tutup): modal 100.000 + cash 42.000 = 142.000 seharusnya; aktual 137.000; selisih -5.000
 * (QRIS 15.000 masuk QRIS, bukan laci; QRIS dibatalkan tidak dihitung).
 */
test.describe('Shift & kas (TC-SHF-05/06/07/12, O-07)', () => {
  test('TC-SHF-12 riwayat shift: modal, seharusnya, aktual, selisih merah @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/shift');
    const closed = page.getByRole('listitem').filter({ hasText: 'Siti E2E' });
    await expect(closed).toContainText(rp(100_000));
    await expect(closed).toContainText(rp(142_000));
    await expect(closed).toContainText(rp(137_000));
    await expect(closed).toContainText(/-\s?Rp\s?5\.000|−\s?Rp\s?5\.000|Rp\s?-5\.000/);
    const open = page.getByRole('listitem').filter({ hasText: 'Budi E2E' });
    await expect(open.getByText('Terbuka')).toBeVisible();
  });

  test('TC-SHF-05/07 ringkasan shift: cash, QRIS terpisah, void, selisih', async ({ page }) => {
    await openAsOwner(page, '/shift');
    await page.getByRole('listitem').filter({ hasText: 'Siti E2E' }).getByRole('button').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByText('Penjualan cash').locator('..')).toContainText(rp(42_000));
    await expect(dlg.getByText('Penjualan QRIS (tidak masuk laci)').locator('..')).toContainText(
      rp(15_000),
    );
    await expect(dlg.getByText('Seharusnya di laci').locator('..')).toContainText(rp(142_000));
    await expect(dlg.getByText('Selisih', { exact: true }).locator('..')).toContainText(/5\.000/);
    await expect(dlg.getByText('Void menunggu').locator('..')).toContainText('0 (');
  });

  test('ringkasan shift terbuka menghitung void_requested di cash & void menunggu', async ({
    page,
  }) => {
    await openAsOwner(page, '/shift');
    await page.getByRole('listitem').filter({ hasText: 'Budi E2E' }).getByRole('button').click();
    const dlg = page.getByRole('dialog');
    // 45.000 + 24.000 + 12.000 (void_requested tetap dihitung sampai diputuskan)
    await expect(dlg.getByText('Penjualan cash').locator('..')).toContainText(rp(81_000));
    await expect(dlg.getByText('Void menunggu').locator('..')).toContainText(/2 \(/);
  });

  test('filter "Hanya yang selisih" menyisakan shift dengan selisih', async ({ page }) => {
    await openAsOwner(page, '/shift');
    await page.getByLabel('Hanya yang selisih').check();
    await expect(page.getByRole('listitem').filter({ hasText: 'Siti E2E' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Budi E2E' })).toHaveCount(0);
  });

  test('filter pegawai', async ({ page }) => {
    await openAsOwner(page, '/shift');
    await page.getByLabel('Pegawai').selectOption({ label: 'Budi E2E' });
    await expect(page.getByRole('listitem').filter({ hasText: 'Siti E2E' })).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: 'Budi E2E' })).toBeVisible();
  });

  test('tautan shift → transaksi memfilter transaksi shift itu', async ({ page }) => {
    test.fail(
      true,
      'DEAR-26: tautan tidak membawa filter shift; hapus baris ini saat bug diperbaiki',
    );
    await openAsOwner(page, '/shift');
    await page.getByRole('listitem').filter({ hasText: 'Siti E2E' }).getByRole('button').click();
    await page.getByRole('link', { name: 'Lihat daftar transaksi' }).click();
    await expect(page).toHaveURL(/\/transaksi/);
    // Harapan: hanya 4 transaksi shift Siti, bukan seluruh 8 transaksi hari itu.
    await expect(page.getByText('Menampilkan 4 transaksi')).toBeVisible();
  });
});
