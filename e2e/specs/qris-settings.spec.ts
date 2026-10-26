import { expect, test } from '@playwright/test';
import QRCode from 'qrcode';
import {
  ApiFailure,
  QRIS_OWNER_EMAIL,
  bearer,
  buildQris,
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
const IMAGE_URL = 'https://example.test/qris-toko.png';

/** Outlet JUS3 (owner `qris@e2e.test`) dipakai khusus uji konfigurasi QRIS, terpisah dari data seed utama. Urutan test berurutan. */
test.describe.configure({ mode: 'serial' });
test.describe('QRIS: gambar + "Tanamkan nominal" wajib berkode (TC-QRS-11, TC-SET-01, DEAR-30/31)', () => {
  test('PATCH gambar + embed tanpa kode QRIS ditolak 422 QRIS_PAYLOAD_REQUIRED', async () => {
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    const err = await call('PATCH', '/settings', {
      headers: bearer(owner),
      body: {
        qris_static_image_url: IMAGE_URL,
        qris_static_payload: null,
        qris_embed_amount: true,
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiFailure);
    const failure = err as ApiFailure;
    expect(failure.status).toBe(422);
    expect(failure.body).toContain('QRIS_PAYLOAD_REQUIRED');
    // Penolakan tidak boleh menyimpan sebagian: gambar tidak ikut tersimpan.
    const { data } = await call<{ qris_static_image_url: string | null }>('GET', '/settings', {
      headers: bearer(owner),
    });
    expect(data.qris_static_image_url).not.toBe(IMAGE_URL);
  });

  test('gambar saja (tanpa embed, tanpa kode) juga ditolak; embed saja tanpa kode ditolak', async () => {
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    for (const body of [{ qris_static_image_url: IMAGE_URL }, { qris_embed_amount: true }]) {
      await expect(
        call('PATCH', '/settings', { headers: bearer(owner), body, expect: 422 }),
      ).resolves.toMatchObject({ status: 422 });
    }
  });

  test('unggah gambar QRIS → decode mengisi kode → PATCH gambar + embed berhasil → kasir bisa QRIS', async () => {
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    const payload = buildQris('WARUNG JUS E2E');
    const png = await QRCode.toBuffer(payload, { type: 'png', margin: 4, scale: 6 });
    const { data: decoded } = await call<{
      qris_static_payload: string;
      qris_merchant_name: string;
      is_static: boolean;
    }>('POST', '/settings/qris/decode', {
      headers: bearer(owner),
      body: { image_base64: png.toString('base64') },
    });
    expect(decoded.qris_static_payload).toBe(payload);
    expect(decoded.is_static).toBe(true);
    expect(decoded.qris_merchant_name).toBe('WARUNG JUS E2E');
    await call('PATCH', '/settings', {
      headers: bearer(owner),
      body: {
        qris_static_image_url: IMAGE_URL,
        qris_static_payload: decoded.qris_static_payload,
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
    // Transaksi QRIS pending dibuat dari kode hasil decode, bukan 503 QRIS_PROVIDER_UNAVAILABLE.
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

  test('decode gambar yang bukan QR: 422 INVALID_QRIS_PAYLOAD (dashboard meminta isi manual)', async () => {
    const owner = await ownerToken(QRIS_OWNER_EMAIL, OWNER_PASSWORD);
    const res = await call('POST', '/settings/qris/decode', {
      headers: bearer(owner),
      body: { image_base64: Buffer.from('bukan gambar').toString('base64') },
      expect: 422,
    });
    expect(JSON.stringify(res.data)).toContain('INVALID_QRIS_PAYLOAD');
  });

  test('UI: simpan pengaturan dengan QRIS berkode tidak menghasilkan error mentah', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengaturan', QRIS_OWNER_EMAIL);
    await expect(page.getByLabel('Nama toko')).toBeVisible();
    await page.getByLabel('Alamat').fill('Jl. Uji QRIS 1');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText('Pengaturan tersimpan.')).toBeVisible();
    await expect(page.getByText(/500|Internal|undefined/)).toHaveCount(0);
    await expect(page.getByLabel('Tanamkan nominal ke QRIS')).toBeEnabled(); // QRIS terpasang (gambar + kode)
  });
});
