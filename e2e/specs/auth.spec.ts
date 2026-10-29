import { expect, test } from '@playwright/test';
import { LOCKOUT_EMAIL, OWNER_PASSWORD } from '../support/api.js';
import { loginUi, openAsOwner } from '../support/ui.js';

test.describe('Login owner (TC-AUTH-01/02)', () => {
  test('TC-AUTH-01 login benar masuk dashboard, refresh cookie HttpOnly @cross-browser @mobile', async ({
    page,
    context,
  }) => {
    await loginUi(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const refresh = (await context.cookies()).find((c) => c.name === 'kk_refresh');
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.sameSite).toBe('Strict');
  });

  test('sesi bertahan setelah reload (refresh token)', async ({ page }) => {
    await openAsOwner(page, '/');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('halaman owner tanpa login diarahkan ke /login', async ({ page }) => {
    await page.goto('/transaksi');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /Selamat datang, Pak/ })).toBeVisible();
  });

  test('password salah menampilkan pesan, tetap di login', async ({ page }) => {
    await loginUi(page, 'owner@e2e.test', 'salah-salah-salah');
    await expect(page.getByText('Email atau kata sandi salah.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('validasi form: email tidak valid & sandi pendek', async ({ page }) => {
    await loginUi(page, 'bukan-email', 'pendek');
    await expect(page.getByText('Email tidak valid.')).toBeVisible();
    await expect(page.getByText('Kata sandi minimal 8 karakter.')).toBeVisible();
  });

  test('TC-AUTH-02 5 password salah mengunci akun; password benar saat terkunci ditolak', async ({
    page,
  }) => {
    for (let i = 0; i < 5; i += 1) await loginUi(page, LOCKOUT_EMAIL, `salah-${i}-salah-salah`);
    await loginUi(page, LOCKOUT_EMAIL, OWNER_PASSWORD);
    await expect(
      page.getByText('Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('keluar mengakhiri sesi', async ({ page }) => {
    await openAsOwner(page, '/');
    await page
      .getByRole('button', { name: /keluar/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/transaksi');
    await expect(page).toHaveURL(/\/login/);
  });
});
