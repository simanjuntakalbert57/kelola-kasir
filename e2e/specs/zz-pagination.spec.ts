import { expect, test } from '@playwright/test';
import { bearer, call, closeShift, openShift, requestVoid, sell } from '../support/api.js';
import { seed } from '../support/state.js';
import { openAsOwner } from '../support/ui.js';

/**
 * Data lebih dari 1 halaman (limit API = 50). Filter sisi klien hanya melihat halaman yang sudah dimuat:
 * "Hanya yang selisih" (shift) dan daftar void. Spec ini dijalankan terakhir karena menambah banyak data.
 */
test.beforeAll(async () => {
  test.setTimeout(240_000);
  const { siti, budi, shop, shift2 } = seed();
  // A failed test restarts the worker and re-runs this hook: seed only once.
  const existing = await call<{ data: unknown[] }>(
    'GET',
    '/void-requests?status=pending&limit=200',
    {
      headers: bearer(shop.owner),
    },
  );
  if (existing.data.data.length >= 51) return;
  await closeShift(budi, shift2, 50_000 + 45_000 + 12_000 + 12_000); // tutup shift Budi (selisih tidak penting)
  for (let i = 0; i < 52; i += 1) {
    const id = await openShift(siti, 10_000);
    if (i < 51) await closeShift(siti, id, 10_000);
    else {
      for (let n = 0; n < 51; n += 1) {
        const sale = await sell(shop, siti, id, shop.products.jeruk, 1, 'cash');
        await requestVoid(siti, sale, `Alasan pagination ${n}`);
      }
    }
  }
});

test('"Hanya yang selisih" tetap menemukan shift ber-selisih yang ada di halaman ke-2', async ({
  page,
}) => {
  await openAsOwner(page, '/shift');
  await page.getByLabel('Hanya yang selisih').check();
  // Shift ber-selisih (Siti, -5.000) adalah yang tertua → di luar 50 shift pertama.
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: /5\.000/ })
      .first(),
  ).toBeVisible({
    timeout: 5_000,
  });
});

test('daftar void menampilkan semua 51+ permintaan menunggu (bukan hanya 50 pertama)', async ({
  page,
}) => {
  const { shop } = seed();
  const api = await call<{ data: unknown[]; next_cursor: string | null }>(
    'GET',
    '/void-requests?status=pending&limit=200',
    { headers: bearer(shop.owner) },
  );
  expect(api.data.data.length).toBeGreaterThanOrEqual(51);
  await openAsOwner(page, '/void');
  const approve = page.getByRole('button', { name: /^Setujui void/ });
  await expect(approve).toHaveCount(50); // halaman pertama
  await page.getByRole('button', { name: 'Muat lebih banyak' }).click();
  await expect(approve).toHaveCount(api.data.data.length);
});
