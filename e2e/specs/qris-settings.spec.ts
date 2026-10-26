import { expect, test } from '@playwright/test';
import {
  QRIS_OWNER_EMAIL,
  bearer,
  call,
  createCashier,
  openShift,
  ownerToken,
  type Product,
  type Shop,
} from '../support/api.js';
import { sell } from '../support/api.js';
import { openAsOwner } from '../support/ui.js';
import { OWNER_PASSWORD } from '../support/api.js';

/** Outlet JUS3 (owner `qris@e2e.test`) dipakai khusus uji konfigurasi QRIS, terpisah dari data seed utama. */
test.describe('QRIS: hanya gambar diisi + "Tanamkan nominal" (TC-QRS-11, TC-SET-01)', () => {
  test('hanya gambar QRIS (tanpa kode): kasir tetap bisa memulai pembayaran QRIS', async () => {
    test.fail(
      true,
      'DEAR-30: gambar-saja dianggap QRIS terkonfigurasi di dashboard, tapi API menolak semua penjualan QRIS',
    );
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    await call('PATCH', '/settings', {
      headers: bearer(owner),
      body: {
        qris_static_image_url: 'https://example.test/qris-toko.png',
        qris_static_payload: null,
        qris_embed_amount: true,
      },
    });
    const created = await call<{ device: { id: string; code: string }; pairing_code: string }>(
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
    // Diharapkan: transaksi QRIS pending dengan gambar QR dari pengaturan, bukan 503 QRIS_PROVIDER_UNAVAILABLE.
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

  test('UI: gambar-saja tanpa kode ditolak dengan pesan jelas, bukan error mentah (DEAR-30)', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengaturan', QRIS_OWNER_EMAIL);
    await expect(page.getByLabel('Nama toko')).toBeVisible();
    await page.getByLabel('Alamat').fill('Jl. Uji QRIS 1');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(
      page.getByText('Kode QRIS wajib diisi agar kasir bisa menerima pembayaran QRIS.'),
    ).toBeVisible();
    await expect(page.getByText('Pengaturan tersimpan.')).toHaveCount(0);
    await expect(page.getByText(/500|Internal|undefined/)).toHaveCount(0);
    await expect(page.getByLabel('Tanamkan nominal ke QRIS')).toBeDisabled(); // tanpa kode, nominal tidak bisa ditanam
  });
});
