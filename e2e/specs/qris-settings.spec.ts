import { expect, test } from '@playwright/test';
import {
  OWNER_PASSWORD,
  QRIS_OWNER_EMAIL,
  bearer,
  buildQris,
  call,
  createCashier,
  openShift,
  ownerToken,
  sell,
  type Product,
  type Shop,
} from '../support/api.js';
import { openAsOwner } from '../support/ui.js';

/**
 * Outlet JUS3 (owner `qris@e2e.test`) dipakai khusus uji konfigurasi QRIS, terpisah dari data seed utama.
 * Keputusan DEAR-30 (opsi b): kode QRIS wajib; gambar saja atau "Tanamkan nominal" tanpa kode ditolak di dashboard.
 */
test.describe.configure({ mode: 'serial' });

test.describe('QRIS: kode wajib, "Tanamkan nominal" (TC-QRS-11, TC-SET-01, DEAR-30)', () => {
  test('gambar tanpa kode: simpan ditolak dan "Tanamkan nominal" nonaktif', async ({ page }) => {
    // Keadaan lama/di luar UI: gambar + embed tersimpan lewat API, kode QRIS kosong.
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    await call('PATCH', '/settings', {
      headers: bearer(owner),
      body: {
        qris_static_image_url: 'https://example.test/qris-toko.png',
        qris_static_payload: null,
        qris_embed_amount: true,
      },
    });
    await openAsOwner(page, '/pengaturan', QRIS_OWNER_EMAIL);
    await expect(page.getByLabel('Nama toko')).toBeVisible();
    await expect(page.getByLabel('Tanamkan nominal ke QRIS')).toBeDisabled();
    await page.getByLabel('Alamat').fill('Jl. Uji QRIS 1');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText(/Kode QRIS wajib diisi/)).toBeVisible();
    await expect(page.getByText('Pengaturan tersimpan.')).toHaveCount(0);
  });

  test('kode QRIS kosong tanpa gambar/embed tetap boleh disimpan', async ({ page }) => {
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    await call('PATCH', '/settings', {
      headers: bearer(owner),
      body: { qris_static_image_url: null, qris_static_payload: null, qris_embed_amount: false },
    });
    await openAsOwner(page, '/pengaturan', QRIS_OWNER_EMAIL);
    await page.getByLabel('Alamat').fill('Jl. Uji QRIS 2');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText('Pengaturan tersimpan.')).toBeVisible();
    await expect(page.getByText(/Kode QRIS wajib diisi/)).toHaveCount(0);
  });

  test('isi kode QRIS: "Tanamkan nominal" aktif, simpan berhasil, kasir bisa memulai QRIS', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengaturan', QRIS_OWNER_EMAIL);
    const embed = page.getByLabel('Tanamkan nominal ke QRIS');
    await expect(embed).toBeDisabled();
    await page.getByLabel('Kode QRIS', { exact: true }).fill(buildQris('JUS TIGA'));
    await expect(embed).toBeEnabled();
    await embed.check();
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText('Pengaturan tersimpan.')).toBeVisible();

    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    const created = await call<{ device: { code: string }; pairing_code: string }>(
      'POST',
      '/devices',
      { headers: bearer(owner), body: { name: 'Kasir QRIS' } },
    );
    const paired = await call<{ device_token: string }>('POST', '/devices/pair', {
      body: { pairing_code: created.data.pairing_code, app_version: '1.0.0', platform: 'android' },
    });
    const cashier = await createCashier(owner, paired.data.device_token, 'Kasir Q');
    const shiftId = await openShift(cashier, 50_000);
    const { data: cat } = await call<{ id: string }>('POST', '/categories', {
      headers: bearer(owner),
      body: { name: 'Jus' },
    });
    const { data: p } = await call<Product>('POST', '/products', {
      headers: bearer(owner),
      body: { category_id: cat.id, name: 'Jus Tes', price: 10_000 },
    });
    const shop = { deviceCode: created.data.device.code, outletCode: 'JUS3' } as Shop;
    const sale = await sell(
      shop,
      cashier,
      shiftId,
      { id: p.id, name: 'Jus Tes', price: 10_000 },
      1,
      'qris',
    );
    expect(sale.id).toBeTruthy();
  });
});
