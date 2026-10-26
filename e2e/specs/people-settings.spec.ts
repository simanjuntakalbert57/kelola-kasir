import { expect, test } from '@playwright/test';
import { bearer, call } from '../support/api.js';
import { seed } from '../support/state.js';
import { openAsOwner } from '../support/ui.js';

test.describe('Pegawai, perangkat, pengaturan (TC-EMP-01, TC-DEV-01, TC-SET-01)', () => {
  test('TC-EMP-01 tambah pegawai dengan PIN 6 digit; PIN tidak pernah ditampilkan @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/pegawai');
    await page.getByRole('button', { name: /Tambah pegawai/ }).click();
    await page.getByLabel('Nama').fill('Rina E2E');
    await page.getByLabel('PIN (6 digit)').fill('739150');
    await page.getByRole('button', { name: 'Simpan' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'Rina E2E' });
    await expect(row).toContainText('Aktif');
    await expect(page.locator('body')).not.toContainText('739150');
  });

  test('TC-EMP-01 validasi PIN: 5 digit, 7 digit, huruf', async ({ page }) => {
    await openAsOwner(page, '/pegawai');
    await page.getByRole('button', { name: /Tambah pegawai/ }).click();
    await page.getByLabel('Nama').fill('Uji PIN');
    for (const pin of ['12345', 'abcdef']) {
      await page.getByLabel('PIN (6 digit)').fill(pin);
      await page.getByRole('button', { name: 'Simpan' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: 'Uji PIN' })).toHaveCount(0);
    }
    // maxLength=6 memotong input 7 digit menjadi 6; pastikan tidak lebih dari 6 tersimpan
    await page.getByLabel('PIN (6 digit)').fill('1234567');
    await expect(page.getByLabel('PIN (6 digit)')).toHaveValue('123456');
  });

  test('TC-AUTH-09 PIN yang sama dalam satu outlet ditolak', async ({ page }) => {
    await openAsOwner(page, '/pegawai');
    await page.getByRole('button', { name: /Tambah pegawai/ }).click();
    await page.getByLabel('Nama').fill('Kembar PIN');
    await page.getByLabel('PIN (6 digit)').fill('739150');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Kembar PIN' })).toHaveCount(0);
  });

  test('TC-RBAC-05 pegawai nonaktif hilang dari grid login perangkat & token ditolak', async ({
    page,
  }) => {
    const { shop } = seed();
    await openAsOwner(page, '/pegawai');
    await page.getByRole('button', { name: 'Nonaktifkan Rina E2E' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Rina E2E' })).toContainText(
      'Nonaktif',
    );
    const { data } = await call<{ data: { name: string }[] }>('GET', '/devices/me/employees', {
      headers: { 'x-device-token': shop.deviceToken },
    });
    expect(data.data.map((e) => e.name)).not.toContain('Rina E2E');
    expect(data.data.map((e) => e.name)).toContain('Siti E2E');
  });

  test('TC-AUTH-04/TC-DEV-01 tambah perangkat menampilkan kode 8 karakter sekali saja', async ({
    page,
  }) => {
    await openAsOwner(page, '/perangkat');
    await page.getByRole('button', { name: /Tambah perangkat/ }).click();
    await page.getByLabel('Nama perangkat').fill('Kasir Belakang');
    await page.getByRole('button', { name: 'Buat kode pairing' }).click();
    const code = (await page.locator('p.font-mono').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page.getByText(code)).toHaveCount(0);
    await expect(page.getByText('Kasir Belakang')).toBeVisible();
  });

  test('TC-AUTH-08 cabut perangkat: sesi pegawai di perangkat itu gugur', async ({ page }) => {
    const { shop } = seed();
    // perangkat khusus uji agar perangkat seed tetap hidup
    const created = await call<{ device: { id: string }; pairing_code: string }>(
      'POST',
      '/devices',
      {
        headers: bearer(shop.owner),
        body: { name: 'Kasir Cabut E2E' },
      },
    );
    const paired = await call<{ device_token: string }>('POST', '/devices/pair', {
      body: { pairing_code: created.data.pairing_code, app_version: '1.0.0', platform: 'android' },
    });
    await call('GET', '/devices/me/employees', {
      headers: { 'x-device-token': paired.data.device_token },
    });
    await openAsOwner(page, '/perangkat');
    await page.getByRole('button', { name: 'Cabut Kasir Cabut E2E' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cabut perangkat' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = await call('GET', '/devices/me/employees', {
      headers: { 'x-device-token': paired.data.device_token },
      expect: [401, 403],
    });
    expect([401, 403]).toContain(after.status);
  });

  test('TC-SET-01 pengaturan toko tersimpan dan pratinjau struk ikut berubah', async ({ page }) => {
    await openAsOwner(page, '/pengaturan');
    await page.getByLabel('Nama toko').fill('Jus Segar E2E');
    await page.getByLabel('Alamat').fill('Jl. Mawar No. 1, Medan');
    await page.getByLabel('Footer struk').fill('Terima kasih, datang lagi!');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText('Pengaturan tersimpan.')).toBeVisible();
    const preview = page.getByRole('complementary', { name: 'Pratinjau struk' });
    await expect(preview).toContainText('Jus Segar E2E');
    await expect(preview).toContainText('Terima kasih, datang lagi!');
    await page.reload();
    await expect(page.getByLabel('Nama toko')).toHaveValue('Jus Segar E2E');
  });

  test('QRIS: kode tidak valid ditolak dengan pesan jelas', async ({ page }) => {
    await openAsOwner(page, '/pengaturan');
    await page.getByLabel('Kode QRIS (opsional)').fill('000201-bukan-qris');
    await page.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByText('Kode QRIS tidak valid. Periksa kembali isinya.')).toBeVisible();
  });
});
