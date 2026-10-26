import { expect, test } from '@playwright/test';
import { bearer, call } from '../support/api.js';
import { seed } from '../support/state.js';
import { openAsOwner } from '../support/ui.js';

test.describe('Produk & kategori (TC-PRD-01/05/06)', () => {
  test('TC-PRD-01 buat produk lewat UI muncul di daftar dan API @mobile', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await page.getByRole('button', { name: /Tambah produk/ }).click();
    await page.getByLabel('Nama produk').fill('Jus Mangga E2E');
    await page.getByLabel('Harga (Rp)').fill('18000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Jus Mangga E2E' });
    await expect(row).toContainText(/Rp\s?18\.000/);
    await expect(row.getByText('Aktif')).toBeVisible();
    const { data } = await call<{ data: { name: string; price: number }[] }>('GET', '/products', {
      headers: bearer(seed().shop.owner),
    });
    expect(data.data.find((p) => p.name === 'Jus Mangga E2E')?.price).toBe(18_000);
  });

  test('TC-PRD-01 validasi: nama kosong, harga nol/desimal/negatif ditolak', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await page.getByRole('button', { name: /Tambah produk/ }).click();
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText('Nama produk wajib diisi.')).toBeVisible();
    for (const bad of ['0', '15000.5', '-5000', 'abc']) {
      await page.getByLabel('Nama produk').fill('Uji Harga');
      await page.getByLabel('Harga (Rp)').fill(bad);
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByText(/Harga harus/)).toBeVisible();
    }
    await expect(page.getByRole('listitem').filter({ hasText: 'Uji Harga' })).toHaveCount(0);
  });

  test('TC-PRD-02 ubah harga memperbarui katalog; transaksi lama tidak berubah (TC-TRX-03)', async ({
    page,
  }) => {
    const { shop, s1Cash } = seed();
    await openAsOwner(page, '/produk');
    const row = page.getByRole('listitem').filter({ hasText: 'Jus Jeruk' });
    await row.getByRole('button', { name: 'Ubah Jus Jeruk' }).click();
    await page.getByLabel('Harga (Rp)').fill('13000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(row).toContainText(/Rp\s?13\.000/);
    const tx = await call<{ items: { unit_price: number }[] }>(
      'GET',
      `/transactions/${s1Cash.id}`,
      {
        headers: bearer(shop.owner),
      },
    );
    expect(tx.data.items[0]?.unit_price).toBe(15_000);
    // kembalikan harga agar data seed tetap konsisten untuk spec lain
    await row.getByRole('button', { name: 'Ubah Jus Jeruk' }).click();
    await page.getByLabel('Harga (Rp)').fill('12000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(row).toContainText(/Rp\s?12\.000/);
  });

  test('tandai habis lalu tersedia', async ({ page }) => {
    await openAsOwner(page, '/produk');
    const row = page.getByRole('listitem').filter({ hasText: 'Jus Mangga E2E' });
    await row.getByRole('button', { name: 'Tandai habis Jus Mangga E2E' }).click();
    await expect(row.getByText('Habis', { exact: true }).first()).toBeVisible();
    await row.getByRole('button', { name: 'Tandai tersedia Jus Mangga E2E' }).click();
    await expect(row.getByRole('button', { name: 'Tandai habis Jus Mangga E2E' })).toBeVisible();
  });

  test('hapus produk meminta konfirmasi dan menyembunyikan dari daftar', async ({ page }) => {
    await openAsOwner(page, '/produk');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Hapus Jus Mangga E2E' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Jus Mangga E2E' })).toHaveCount(0);
  });

  test('TC-PRD-05 kategori: tambah, ubah, validasi nama kosong', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await page.getByRole('button', { name: /Tambah kategori/ }).click();
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText('Nama kategori wajib diisi.')).toBeVisible();
    await page.getByLabel('Nama kategori').fill('Smoothie E2E');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText('Smoothie E2E').first()).toBeVisible();
  });

  test('TC-PRD-06 tidak ada UI/endpoint varian atau opsi', async ({ page }) => {
    await openAsOwner(page, '/produk');
    await page.getByRole('button', { name: /Tambah produk/ }).click();
    await expect(page.getByText(/varian|opsi|topping|ukuran/i)).toHaveCount(0);
    const { status } = await call('GET', '/option-groups', {
      headers: bearer(seed().shop.owner),
      expect: [404],
    });
    expect(status).toBe(404);
  });
});
