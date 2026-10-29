import { expect, type Page } from '@playwright/test';
import { OWNER_EMAIL, OWNER_PASSWORD } from './api.js';

export async function loginUi(page: Page, email = OWNER_EMAIL, password = OWNER_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
}

export async function openAsOwner(page: Page, path: string, email = OWNER_EMAIL) {
  await loginUi(page, email);
  await expect(page.getByRole('heading', { name: /^(Selamat (pagi|siang|sore|malam), Pak |Halo!)/ })).toBeVisible();
  if (path !== '/') await page.goto(path);
}

/** Rupiah as the dashboard formats it (`Rp 12.500`, NBSP-tolerant). */
export const rp = (n: number): RegExp =>
  new RegExp(`Rp\\s?${n.toLocaleString('id-ID').replace(/\./g, '\\.')}`);
