import { expect, test, type Page } from '@playwright/test';
import { bearer, call, cancelQris, requestVoid, sell, type Sale } from '../support/api.js';
import { seed } from '../support/state.js';
import { openAsOwner, pickOption, rp } from '../support/ui.js';

const MANAGER_EMAIL = 'manager@e2e.test';
const omzet = async (page: Page) => {
  const text = await page.getByRole('region', { name: 'Omzet' }).innerText();
  const m = /Rp\s?([\d.]+)/.exec(text);
  return Number((m?.[1] ?? '0').replace(/\./g, ''));
};
const sales: Record<string, Sale> = {};
const sale = (key: string): Sale => {
  const found = sales[key];
  if (!found) throw new Error(`sale ${key} not seeded`);
  return found;
};

test.describe.serial('DEAR-124 hapus transaksi + Riwayat Hapus (owner)', () => {
  test.beforeAll(async () => {
    const { shop, budi, shift2 } = seed();
    sales['paid'] = await sell(shop, budi, shift2, shop.products.alpukat, 2, 'cash', {});
    sales['pending'] = await sell(shop, budi, shift2, shop.products.jeruk, 1, 'qris');
    sales['voidreq'] = await sell(shop, budi, shift2, shop.products.jeruk, 1, 'cash');
    await requestVoid(budi, sale('voidreq'), 'Salah input pesanan');
    sales['shot'] = await sell(shop, budi, shift2, shop.products.jeruk, 2, 'cash', {});
  });

  test.afterAll(async () => {
    // Leave the shared shift closable for later specs (zz-pagination closes it).
    const { budi } = seed();
    await cancelQris(budi, sale('pending'));
  });

  test('TC-DEL-01/02 tombol Hapus + validasi alasan @mobile', async ({ page }) => {
    const s = sale('paid');
    await openAsOwner(page, '/transaksi');
    await page
      .getByRole('button', { name: `Detail ${s.number}` })
      .first()
      .click();
    const del = page.getByRole('button', { name: 'Hapus transaksi' });
    await expect(del).toBeEnabled();
    await del.click();
    const dlg = page.getByRole('dialog', { name: 'Hapus transaksi ini?' });
    await expect(dlg).toContainText(s.number);
    await expect(dlg).toContainText(rp(s.total));
    const confirm = dlg.getByRole('button', { name: 'Hapus transaksi' });
    const reason = dlg.getByLabel('Alasan menghapus');
    for (const bad of ['', '  ab  ']) {
      await reason.fill(bad);
      await reason.blur();
      await expect(confirm).toBeDisabled();
      await expect(dlg.getByText('Alasan minimal 5 karakter.')).toBeVisible();
    }
    await reason.fill('x'.repeat(201));
    await expect(confirm).toBeDisabled();
    await expect(dlg.getByText(/maksimal 200/i)).toBeVisible();
    await page.screenshot({ path: 'test-results/dialog-hapus.png' });
  });

  test('TC-DEL-04 pending / void_requested: tombol nonaktif + keterangan', async ({ page }) => {
    await openAsOwner(page, '/transaksi');
    for (const k of ['pending', 'voidreq']) {
      await page
        .getByRole('button', { name: `Detail ${sale(k).number}` })
        .first()
        .click();
      await expect(page.getByRole('button', { name: 'Hapus transaksi' })).toBeDisabled();
      await expect(page.getByText('Selesaikan pembayaran/void dulu')).toBeVisible();
    }
  });

  test('TC-DEL-03/05/06/07 hapus → laporan turun → Riwayat Hapus → detail → pulihkan @mobile', async ({
    page,
  }) => {
    const s = sale('paid');
    const { shop } = seed();
    await openAsOwner(page, '/');
    const before = await omzet(page);

    await page.goto('/transaksi');
    await page
      .getByRole('button', { name: `Detail ${s.number}` })
      .first()
      .click();
    await page.getByRole('button', { name: 'Hapus transaksi' }).click();
    const dlg = page.getByRole('dialog', { name: 'Hapus transaksi ini?' });
    await dlg.getByLabel('Alasan menghapus').fill('input dobel');
    await dlg.getByRole('button', { name: 'Hapus transaksi' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Detail ${s.number}` })).toHaveCount(0);

    await page.goto('/');
    await expect.poll(() => omzet(page)).toBe(before - s.total);
    await page.goto('/shift');
    await page
      .getByRole('button', { name: /^Detail shift/ })
      .first()
      .click();
    await expect(
      page.getByText(new RegExp(`1 transaksi dihapus \\(${rp(s.total).source}\\)`)),
    ).toBeVisible();

    // Riwayat Hapus
    await page.goto('/transaksi');
    await page.getByRole('link', { name: 'Riwayat Hapus' }).click();
    await expect(page).toHaveURL(/\/transaksi\/dihapus$/);
    await expect(page.getByText(s.number).locator('visible=true').first()).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(s.number) });
    if (await row.isVisible()) {
      for (const h of [
        'Nomor',
        'Tanggal transaksi',
        'Total',
        'Metode',
        'Kasir',
        'Dihapus oleh',
        'Waktu hapus',
        'Alasan',
      ])
        await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
      await expect(row).toContainText('input dobel');
      await expect(row).toContainText('Owner');
    } else {
      await expect(page.getByText('“input dobel”').locator('visible=true').first()).toBeVisible();
    }
    // filter + cari
    await page.getByLabel('Cari').fill(s.number.slice(-4));
    await expect(page.getByText(s.number).locator('visible=true').first()).toBeVisible();
    await page.getByLabel('Cari').fill('ZZZZ-NOPE');
    await expect(page.getByText('Belum ada transaksi yang dihapus.')).toBeVisible();
    await page.getByLabel('Cari').fill('');
    await pickOption(page, 'Filter tanggal berdasarkan', 'Waktu transaksi');
    await expect(page.getByText(s.number).locator('visible=true').first()).toBeVisible();
    await pickOption(page, 'Filter tanggal berdasarkan', 'Waktu hapus');
    await page.screenshot({ path: 'test-results/riwayat.png' });

    // detail
    await page
      .getByRole('button', { name: `Detail ${s.number}` })
      .first()
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: /Dihapus oleh Owner .* “input dobel”/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Linimasa hapus dan pulihkan' })
        .or(page.getByLabel('Linimasa hapus dan pulihkan')),
    ).toContainText('Dihapus');

    // pulihkan: validasi catatan
    await page.getByRole('button', { name: 'Pulihkan' }).click();
    const rd = page.getByRole('dialog', { name: 'Pulihkan transaksi ini?' });
    await rd.getByLabel('Catatan (opsional)').fill('c'.repeat(201));
    await expect(rd.getByText('Catatan maksimal 200 karakter.')).toBeVisible();
    await expect(rd.getByRole('button', { name: 'Pulihkan' })).toBeDisabled();
    await rd.getByLabel('Catatan (opsional)').fill('');
    await rd.getByRole('button', { name: 'Pulihkan' }).click();
    await expect(rd).toHaveCount(0);

    // kembali ke daftar, dashboard, riwayat
    await page.goto('/transaksi/dihapus');
    await expect(page.getByText(s.number)).toHaveCount(0);
    await page.goto('/transaksi');
    await expect(page.getByRole('button', { name: `Detail ${s.number}` }).first()).toBeVisible();
    await page.goto('/');
    await expect.poll(() => omzet(page)).toBe(before);
    const tx = await call<{ status: string; deletions?: unknown[] }>(
      'GET',
      `/transactions/${s.id}`,
      {
        headers: bearer(shop.owner),
      },
    );
    expect(tx.data.status).toBe('paid');
    await page.goto('/transaksi');
    await page
      .getByRole('button', { name: `Detail ${s.number}` })
      .first()
      .click();
    await expect(page.getByText('Dipulihkan').first()).toBeVisible();
  });
});

test('TC-DEL-09 tampilan terang + gelap (tangkapan layar) @mobile', async ({ page }, info) => {
  const s = sale('shot');
  const { shop } = seed();
  await call('DELETE', `/transactions/${s.id}`, {
    headers: bearer(shop.owner),
    body: { reason: 'Transaksi uji coba' },
  });
  await openAsOwner(page, '/transaksi');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('kk-theme', t), theme);
    await page.goto('/transaksi/dihapus');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText(s.number).locator('visible=true').first()).toBeVisible();
    await page.screenshot({ path: `test-results/shot-riwayat-${theme}-${info.project.name}.png` });
    await page
      .getByRole('button', { name: `Detail ${s.number}` })
      .locator('visible=true')
      .first()
      .click();
    await expect(page.getByRole('button', { name: 'Pulihkan' })).toBeVisible();
    await page.screenshot({ path: `test-results/shot-detail-${theme}-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Pulihkan' }).click();
    await page.screenshot({ path: `test-results/shot-pulihkan-${theme}-${info.project.name}.png` });
  }
});

test.describe('DEAR-124 manager tidak punya akses (TC-DEL-08)', () => {
  test('tombol Hapus & tautan Riwayat Hapus tersembunyi; /transaksi/dihapus terkunci @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/transaksi', MANAGER_EMAIL);
    await expect(page.getByRole('link', { name: 'Riwayat Hapus' })).toHaveCount(0);
    await page
      .getByRole('button', { name: /^Detail / })
      .first()
      .click();
    await expect(page.getByLabel('Detail transaksi').or(page.getByRole('dialog'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hapus transaksi' })).toHaveCount(0);
    await page.goto('/transaksi/dihapus');
    await expect(page.getByText('Riwayat Hapus hanya untuk pemilik.')).toBeVisible();
  });
});
