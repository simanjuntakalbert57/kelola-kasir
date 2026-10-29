import { expect, test } from '@playwright/test';
import { openAsOwner } from '../support/ui.js';

const theme = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.dataset['theme']);

test.describe('Mode gelap (DEAR-92)', () => {
  test('TC-THEME-01 pilihan Gelap tersimpan setelah reload dan tanpa kedip @mobile', async ({
    page,
  }) => {
    await openAsOwner(page, '/pengaturan');
    await page.getByRole('radio', { name: 'Gelap' }).click();
    expect(await theme(page)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('kk-theme'))).toBe('dark');
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Gelap' })).toBeChecked();
    expect(await theme(page)).toBe('dark');
    // Skrip inline di <head> memasang tema sebelum render pertama.
    await page.goto('/pengaturan', { waitUntil: 'commit' });
    expect(await theme(page)).toBe('dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 19, 13)');
  });

  test('TC-THEME-02 tombol header bergantian terang/gelap; struk tetap putih', async ({ page }) => {
    await openAsOwner(page, '/pengaturan');
    await page.getByRole('radio', { name: 'Terang' }).click();
    await page.getByRole('button', { name: 'Ganti ke mode gelap' }).click();
    expect(await theme(page)).toBe('dark');
    await expect(page.getByRole('figure', { name: 'Pratinjau struk' })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await page.getByRole('button', { name: 'Ganti ke mode terang' }).click();
    expect(await theme(page)).toBe('light');
  });

  test('TC-THEME-03 "Ikuti perangkat" langsung mengikuti setelan OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openAsOwner(page, '/pengaturan');
    await page.getByRole('radio', { name: 'Ikuti perangkat' }).click();
    expect(await theme(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => theme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page)).toBe('light');
  });
});
