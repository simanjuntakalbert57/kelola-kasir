import { expect, test } from '@playwright/test';
import { bearer, call, requestVoid } from '../support/api.js';
import { seed } from '../support/state.js';
import { openAsOwner, rp } from '../support/ui.js';

test.describe('Void: persetujuan owner (TC-STM-04..09, O-08)', () => {
  test('daftar "Menunggu" memuat 2 permintaan lengkap dengan alasan @mobile', async ({ page }) => {
    const { v1, v2 } = seed();
    await openAsOwner(page, '/void');
    await expect(page.getByText('“Salah input pesanan”')).toBeVisible();
    await expect(page.getByText('“Pembeli batal”')).toBeVisible();
    await expect(page.getByText(v1.number)).toBeVisible();
    await expect(page.getByText(v2.number)).toBeVisible();
  });

  test('TC-STM-05 setujui void → voided, keluar dari omzet dashboard', async ({ page }) => {
    const { v1, shop } = seed();
    await openAsOwner(page, '/');
    const before = page.getByRole('region', { name: 'Omzet' });
    await expect(before).toContainText(rp(150_000));

    await page.goto('/void');
    await page.getByRole('button', { name: `Setujui batal ${v1.number}` }).click();
    await page.getByLabel('Catatan (opsional)').fill('Sesuai laporan kasir');
    await page.getByRole('dialog').getByRole('button', { name: 'Ya, setujui batal' }).click();
    await expect(page.getByText(v1.number)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Disetujui' }).click();
    await expect(page.getByText(v1.number)).toBeVisible();
    await expect(page.getByText('Catatan: Sesuai laporan kasir')).toBeVisible();

    const tx = await call<{ status: string }>('GET', `/transactions/${v1.id}`, {
      headers: bearer(shop.owner),
    });
    expect(tx.data.status).toBe('voided');

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Omzet' })).toContainText(rp(126_000)); // 150.000 − 24.000
  });

  test('TC-STM-06 tolak void → transaksi kembali Lunas, omzet tidak berubah', async ({ page }) => {
    const { v2, shop } = seed();
    await openAsOwner(page, '/void');
    await page.getByRole('button', { name: `Tolak batal ${v2.number}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ya, tolak' }).click();
    await page.getByRole('tab', { name: 'Ditolak' }).click();
    await expect(page.getByText(v2.number)).toBeVisible();
    const tx = await call<{ status: string }>('GET', `/transactions/${v2.id}`, {
      headers: bearer(shop.owner),
    });
    expect(tx.data.status).toBe('paid');
  });

  test('TC-STM-09 keputusan ulang: approve dua kali idempoten, approve setelah tolak ditolak (409); omzet tidak double-subtract', async ({
    page,
  }) => {
    const { shop, v1, v2 } = seed();
    const find = async (status: 'approved' | 'rejected', number: string) => {
      const list = await call<{ data: { id: string; transaction_number: string }[] }>(
        'GET',
        `/void-requests?status=${status}`,
        { headers: bearer(shop.owner) },
      );
      return list.data.data.find((r) => r.transaction_number === number);
    };
    const approved = await find('approved', v1.number);
    const rejected = await find('rejected', v2.number);
    expect(approved).toBeDefined();
    expect(rejected).toBeDefined();
    const again = await call<{ status: string }>('POST', `/void-requests/${approved?.id}/approve`, {
      headers: bearer(shop.owner),
      body: {},
    });
    expect(again.data.status).toBe('approved');
    await call('POST', `/void-requests/${rejected?.id}/approve`, {
      headers: bearer(shop.owner),
      body: {},
      expect: [409],
    });
    await openAsOwner(page, '/');
    await expect(page.getByRole('region', { name: 'Omzet' })).toContainText(rp(126_000));
  });

  test('TC-SHF-13 void disetujui pada shift yang sudah ditutup: expected cash shift lama tidak berubah', async ({
    page,
  }) => {
    const { siti, s1Cash, shop, shift1 } = seed();
    const before = await call<{ expected_cash: number; cash_difference: number }>(
      'GET',
      `/shifts/${shift1}/summary`,
      { headers: bearer(shop.owner) },
    );
    expect(before.data.expected_cash).toBe(142_000);

    // Pegawai mengajukan void untuk transaksi di shift yang sudah tertutup; hasil: ditolak atau tercatat.
    const res = await requestVoid(siti, s1Cash, 'Koreksi setelah tutup shift').catch((e) => e);
    if (res instanceof Error) {
      test.info().annotations.push({
        type: 'catatan',
        description: `Pengajuan void pada shift tertutup ditolak API: ${res.message}`,
      });
    } else {
      const list = await call<{ data: { id: string; transaction_number: string }[] }>(
        'GET',
        '/void-requests?status=pending',
        { headers: bearer(shop.owner) },
      );
      const req = list.data.data.find((r) => r.transaction_number === s1Cash.number);
      await call('POST', `/void-requests/${req?.id}/approve`, {
        headers: bearer(shop.owner),
        body: {},
      });
    }
    const after = await call<{ expected_cash: number; cash_difference: number }>(
      'GET',
      `/shifts/${shift1}/summary`,
      { headers: bearer(shop.owner) },
    );
    expect(after.data.expected_cash).toBe(142_000);
    expect(after.data.cash_difference).toBe(-5_000);
    await openAsOwner(page, '/shift');
    await expect(page.getByRole('listitem').filter({ hasText: 'Siti E2E' })).toContainText(
      rp(142_000),
    );
  });

  test('TC-RBAC-04 pegawai tidak bisa menyetujui void', async () => {
    const { shop, budi } = seed();
    const list = await call<{ data: { id: string }[] }>('GET', '/void-requests?status=approved', {
      headers: bearer(shop.owner),
    });
    const id = list.data.data[0]?.id ?? '00000000-0000-7000-8000-000000000000';
    const res = await call('POST', `/void-requests/${id}/approve`, {
      headers: budi.headers,
      body: {},
      expect: [403],
    });
    expect(res.status).toBe(403);
  });
});
