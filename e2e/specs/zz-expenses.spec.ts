import { expect, test, type Page } from '@playwright/test';
import { openAsOwner, rp } from '../support/ui.js';

const MANAGER_EMAIL = 'manager@e2e.test';
const DESCRIPTION = 'Mangga e2e 10 kg';

/** Needs the multi-branch API (DEAR-136) and `run.sh` creating the second branch PLM for owner@e2e.test (DEAR-137). */
async function hasBranchPicker(page: Page) {
  return (await page.getByRole('button', { name: /Ganti cabang/ }).count()) > 0;
}

test.describe.serial('DEAR-137 cabang + pengeluaran (owner)', () => {
  test('TC-EXP-01 ganti cabang membersihkan data dan "Semua cabang" hanya di Pengeluaran @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengeluaran');
    await expect(page.getByRole('heading', { name: 'Pengeluaran' })).toBeVisible();
    test.skip(!(await hasBranchPicker(page)), 'seed has a single branch');
    await page.getByRole('button', { name: /Ganti cabang/ }).click();
    await expect(page.getByRole('option', { name: /Semua cabang/ })).toBeVisible();
    await page.getByRole('option', { name: /Palmerah/ }).click();
    await expect(page.getByRole('button', { name: /Cabang aktif: Palmerah/ })).toBeVisible();
    await page.goto('/transaksi');
    await page.getByRole('button', { name: /Ganti cabang/ }).click();
    await expect(page.getByRole('option', { name: /Semua cabang/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Ragunan/ }).click();
  });

  test('TC-EXP-02 tambah, ubah, hapus dan pulihkan pengeluaran @mobile', async ({ page }) => {
    await openAsOwner(page, '/pengeluaran');
    await page
      .getByRole('button', { name: /Tambah pengeluaran|Catat pengeluaran pertama/ })
      .first()
      .click();
    const form = page.getByRole('dialog', { name: 'Catat pengeluaran' });
    await form.getByLabel('Jumlah (Rp)').fill('125000');
    await form.getByRole('radio', { name: 'Buah' }).check({ force: true });
    await form.getByLabel('Keterangan (opsional)').fill(DESCRIPTION);
    await form.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.getByText(/Tersimpan: Buah/)).toBeVisible();
    await expect(page.getByText(DESCRIPTION)).toBeVisible();

    await page
      .getByRole('button', { name: /Detail Buah/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Ubah' }).click();
    const edit = page.getByRole('dialog', { name: 'Ubah pengeluaran' });
    await edit.getByLabel('Jumlah (Rp)').fill('150000');
    await edit.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(page.getByRole('button', { name: /Detail Buah.*150\.000/ }).first()).toBeVisible();

    await page
      .getByRole('button', { name: /Detail Buah.*150\.000/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Riwayat' })).toBeVisible();
    await page.getByRole('button', { name: 'Hapus' }).click();
    const del = page.getByRole('dialog', { name: 'Hapus pengeluaran ini?' });
    await del.getByLabel('Alasan menghapus').fill('Salah input e2e');
    await del.getByRole('button', { name: 'Hapus' }).click();
    await expect(page.getByText(DESCRIPTION)).toHaveCount(0);

    await page.getByLabel(/Riwayat Hapus/).check();
    await page
      .getByRole('button', { name: /Detail Buah/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Pulihkan' }).click();
    await page.getByLabel(/Riwayat Hapus/).uncheck();
    await expect(page.getByText(DESCRIPTION)).toBeVisible();
  });

  test('TC-EXP-03 Rekap menampilkan laba sederhana dan ekspor Excel', async ({ page }) => {
    await openAsOwner(page, '/pengeluaran/rekap');
    await expect(page.getByText(/Laba sederhana|Rugi sederhana/)).toBeVisible();
    await expect(page.getByText(/Lunas \+ menunggu persetujuan batal/).first()).toBeVisible();
    // Pre-operations toggle makes Rekap equal Ringkasan for the same month.
    await page.getByLabel('Termasuk masa uji coba').check();
    await expect(page.getByText(rp(150000)).first()).toBeVisible();

    await page.goto('/pengeluaran');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Ekspor Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('TC-EXP-04 tanggal mulai operasional: owner mengisi, Rekap parsial', async ({ page }) => {
    await openAsOwner(page, '/pengaturan');
    const field = page.getByLabel('Tanggal mulai operasional');
    await expect(field).toBeEnabled();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    await field.fill(today);
    await page.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await page.getByRole('button', { name: 'Ubah tanggal' }).click();
    await expect(page.getByText('Tersimpan')).toBeVisible();
    await page.goto('/pengeluaran/rekap');
    await expect(page.getByText(/Dihitung mulai/)).toBeVisible();
    // Restore, so later specs see the whole seeded history.
    await page.goto('/pengaturan');
    await page.getByLabel('Tanggal mulai operasional').fill('');
    await page.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await page.getByRole('button', { name: 'Ubah tanggal' }).click();
    await expect(page.getByText('Tersimpan')).toBeVisible();
  });
});

test.describe('DEAR-137 manager', () => {
  test('TC-EXP-05 manager: cabang terkunci, tanpa Hapus dan Kelola kategori, tanggal mulai read-only', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengeluaran', MANAGER_EMAIL);
    await expect(
      page.getByRole('group', { name: /Cabang Anda: .*Tidak bisa diganti/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Ganti cabang/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Kelola kategori' })).toHaveCount(0);
    await page
      .getByRole('button', { name: /Detail/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: 'Ubah' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hapus' })).toHaveCount(0);
    await page.goto('/pengaturan');
    await expect(page.getByLabel('Tanggal mulai operasional')).toBeDisabled();
  });
});
