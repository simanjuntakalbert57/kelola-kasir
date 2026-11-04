import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { openAsOwner, rp } from '../support/ui.js';
import {
  bearer,
  buildQris,
  call,
  createCashier,
  openShift,
  sell,
  type Cashier,
  type Product,
  type Shop,
} from '../support/api.js';

/**
 * DEAR-138 multi-branch QA (API level): isolation between branches, JUS4 -> RGN rename keeps the data (same ops scripts as
 * production), recap/profit against manual figures, manager scope. Own outlet JUS4 (owner branch@e2e.test, manager mgr4@e2e.test,
 * created by run.sh) so the other specs are unaffected.
 */
const DB = process.env['DATABASE_URL'] ?? '';
const OPS = new URL('../../ops/vps/', import.meta.url).pathname;
const psqlFile = (file: string, vars: Record<string, string>) =>
  execFileSync(
    'psql',
    [
      DB,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]),
      '-f',
      OPS + file,
    ],
    { encoding: 'utf8' },
  );
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const PASS = process.env['E2E_OWNER_PASSWORD'] ?? 'e2e-owner-password-123';

interface Session {
  access_token: string;
  active_outlet_id: string;
  user: { outlets: { id: string; code: string; role: string }[] };
}
const login = async (email: string) =>
  (await call<Session>('POST', '/auth/login', { body: { email, password: PASS } })).data;
const switchTo = async (token: string, outletId: string) =>
  (
    await call<Session>('POST', '/auth/switch-outlet', {
      headers: bearer(token),
      body: { outlet_id: outletId },
    })
  ).data;

async function setupShop(
  token: string,
  code: string,
): Promise<{ shop: Shop; cashier: Cashier; shift: string }> {
  const h = bearer(token);
  await call('PATCH', '/settings', { headers: h, body: { qris_static_payload: buildQris() } });
  const { data: cat } = await call<{ id: string }>('POST', '/categories', {
    headers: h,
    body: { name: `Jus ${code}` },
  });
  const mk = async (name: string, price: number): Promise<Product> => ({
    id: (
      await call<{ id: string }>('POST', '/products', {
        headers: h,
        body: { category_id: cat.id, name, price },
      })
    ).data.id,
    name,
    price,
  });
  const alpukat = await mk(`Alpukat ${code}`, 15_000);
  const jeruk = await mk(`Jeruk ${code}`, 12_000);
  const created = await call<{ device: { id: string; code: string }; pairing_code: string }>(
    'POST',
    '/devices',
    {
      headers: h,
      body: { name: `HP ${code}` },
    },
  );
  const paired = await call<{ device_token: string }>('POST', '/devices/pair', {
    body: { pairing_code: created.data.pairing_code, app_version: '1.0.0', platform: 'android' },
  });
  const shop: Shop = {
    owner: token,
    deviceToken: paired.data.device_token,
    deviceId: created.data.device.id,
    deviceCode: created.data.device.code,
    outletCode: code,
    categoryId: cat.id,
    products: { alpukat, jeruk },
  };
  const cashier = await createCashier(token, shop.deviceToken, `Kasir ${code}`);
  return { shop, cashier, shift: await openShift(cashier, 100_000) };
}

const addExpense = async (
  token: string,
  amount: number,
  description: string,
  categoryName: string,
  source = 'drawer',
) => {
  const { data: cats } = await call<{ data: { id: string; name: string }[] }>(
    'GET',
    '/expense-categories',
    { headers: bearer(token) },
  );
  const cat = cats.data.find((c) => c.name === categoryName);
  expect(cat, `category ${categoryName}`).toBeTruthy();
  return (
    await call<{ id: string }>('POST', '/expenses', {
      headers: bearer(token),
      body: { category_id: cat!.id, spent_on: today, description, amount, funding_source: source },
    })
  ).data;
};

const state: Record<string, any> = {};

test.describe.serial('DEAR-138 multi-cabang & pengeluaran (API)', () => {
  test('setup: cabang RGN-sebelum-rename (JUS4) + PLM, transaksi di kedua cabang', async () => {
    const s = await login('branch@e2e.test');
    const jus = s.user.outlets[0]!;
    expect(s.user.outlets).toHaveLength(1);
    state['jusId'] = jus.id;
    const a = await setupShop(s.access_token, 'JUS4');
    state['a'] = a;
    // JUS4: 2 x Alpukat (30.000) cash + 1 x Jeruk (12.000) qris confirmed = 42.000
    const t1 = await sell(a.shop, a.cashier, a.shift, a.shop.products.alpukat, 2, 'cash');
    state['preNumbers'] = [t1.number];
    await call(
      'POST',
      `/payments/${(await sell(a.shop, a.cashier, a.shift, a.shop.products.jeruk, 1, 'qris')).paymentId}/confirm`,
      { headers: a.cashier.headers, body: {} },
    );
    await addExpense(s.access_token, 10_000, 'Mangga JUS4', 'Buah');
    await addExpense(s.access_token, 5_000, 'Es batu JUS4', 'Es batu');

    // second branch for the same owner, created with the production ops script
    psqlFile('create-branch-outlet.sql', {
      code: 'PLM4',
      name: 'Toko Palmerah 4',
      owner_email: 'branch@e2e.test',
    });
    const s2 = await login('branch@e2e.test');
    const plm = s2.user.outlets.find((o) => o.code === 'PLM4')!;
    expect(plm.role).toBe('owner');
    state['plmId'] = plm.id;
    const pTok = (await switchTo(s2.access_token, plm.id)).access_token;
    state['pTok'] = pTok;
    // fresh branch is empty
    for (const path of ['/products', '/employees', '/devices', '/transactions?scope=today']) {
      const { data } = await call<{ data: unknown[] }>('GET', path, { headers: bearer(pTok) });
      expect(data.data, `${path} must be empty in the new branch`).toHaveLength(0);
    }
    const b = await setupShop(pTok, 'PLM4');
    state['b'] = b;
    // PLM4: 1 x Alpukat (15.000) cash
    await sell(b.shop, b.cashier, b.shift, b.shop.products.alpukat, 1, 'cash');
    await addExpense(pTok, 7_000, 'Listrik PLM4', 'Listrik', 'owner');
  });

  test('TC-MB-01 isolasi: produk, pegawai, perangkat, transaksi, pengeluaran tidak bocor antar cabang', async () => {
    const s = await login('branch@e2e.test');
    const jTok = (await switchTo(s.access_token, state['jusId'])).access_token;
    const pTok = state['pTok'] as string;
    for (const [tok, mine, other] of [
      [jTok, 'JUS4', 'PLM4'],
      [pTok, 'PLM4', 'JUS4'],
    ] as const) {
      const names = async (path: string) =>
        JSON.stringify((await call('GET', path, { headers: bearer(tok) })).data);
      for (const path of [
        '/products',
        '/employees',
        '/devices',
        '/transactions?scope=today',
        '/expenses',
      ]) {
        const body = await names(path);
        expect(body, `${path} in ${mine}`).toContain(
          mine === 'JUS4' && path === '/transactions?scope=today' ? 'JUS4-' : mine,
        );
        expect(body, `${path} in ${mine} leaks ${other}`).not.toContain(other);
      }
      const { data: cats } = await call<{ data: { id: string }[] }>('GET', '/expense-categories', {
        headers: bearer(tok),
      });
      expect(cats.data.length).toBeGreaterThan(5);
    }
    // category of the other branch cannot be used
    const { data: pCats } = await call<{ data: { id: string; name: string }[] }>(
      'GET',
      '/expense-categories',
      { headers: bearer(pTok) },
    );
    await call('POST', '/expenses', {
      headers: bearer(jTok),
      body: {
        category_id: pCats.data[0]!.id,
        spent_on: today,
        description: 'x',
        amount: 1000,
        funding_source: 'drawer',
      },
      expect: 400,
    });
    // PLM4 cashier phone cannot read JUS4 transactions with its own token (outlet-bound)
    const a = state['a'],
      b = state['b'];
    const { data: tx } = await call<{ data: { number: string }[] }>(
      'GET',
      '/transactions?scope=today',
      { headers: b.cashier.headers },
    );
    expect(tx.data.every((t) => t.number.startsWith('PLM4-'))).toBe(true);
    void a;
  });

  test('TC-MB-02 rekap & laba cocok hitungan manual (per cabang + semua cabang)', async () => {
    const s = await login('branch@e2e.test');
    const month = today.slice(0, 7);
    const jTok = (await switchTo(s.access_token, state['jusId'])).access_token;
    const q = `month_from=${month}&month_to=${month}`;
    const cur = (await call<any>('GET', `/reports/expenses?${q}`, { headers: bearer(jTok) })).data;
    expect(cur.total.total).toMatchObject({
      revenue: 42_000,
      expense_total: 15_000,
      profit: 27_000,
      expense_count: 2,
    });
    expect(cur.total.total.by_group.hpp).toBe(15_000);
    expect(cur.total.total.by_funding_source).toEqual({ drawer: 15_000, owner: 0 });
    const all = (
      await call<any>('GET', `/reports/expenses?${q}&outlet_scope=all`, { headers: bearer(jTok) })
    ).data;
    expect(all.outlets).toHaveLength(2);
    expect(all.total.total).toMatchObject({
      revenue: 57_000,
      expense_total: 22_000,
      profit: 35_000,
    });
    expect(all.total.total.by_group).toMatchObject({ hpp: 15_000, operasional: 7_000 });
    expect(all.total.total.by_funding_source).toEqual({ drawer: 15_000, owner: 7_000 });
    const plm = all.total.per_outlet.find((c: any) => c.outlet_id === state['plmId']);
    expect(plm).toMatchObject({ revenue: 15_000, expense_total: 7_000, profit: 8_000 });
    // recap revenue == dashboard revenue of the branch
    const dash = (
      await call<any>('GET', `/dashboard/summary?date_from=${today}&date_to=${today}`, {
        headers: bearer(jTok),
      })
    ).data;
    expect(dash.revenue).toBe(42_000);
    // edit + soft delete move the recap; restore brings it back
    const { data: list } = await call<{ data: { id: string; description: string }[] }>(
      'GET',
      '/expenses',
      { headers: bearer(jTok) },
    );
    const mangga = list.data.find((e) => e.description === 'Mangga JUS4')!;
    await call('PATCH', `/expenses/${mangga.id}`, {
      headers: bearer(jTok),
      body: { amount: 12_500 },
    });
    expect(
      (await call<any>('GET', `/reports/expenses?${q}`, { headers: bearer(jTok) })).data.total.total
        .expense_total,
    ).toBe(17_500);
    await call('DELETE', `/expenses/${mangga.id}`, {
      headers: bearer(jTok),
      body: { reason: 'salah catat' },
      expect: [200, 204],
    });
    expect(
      (await call<any>('GET', `/reports/expenses?${q}`, { headers: bearer(jTok) })).data.total
        .total,
    ).toMatchObject({ expense_total: 5_000, profit: 37_000 });
    await call('POST', `/expenses/${mangga.id}/restore`, { headers: bearer(jTok), body: {} });
    expect(
      (await call<any>('GET', `/reports/expenses?${q}`, { headers: bearer(jTok) })).data.total.total
        .expense_total,
    ).toBe(17_500);
    // validation: zero / negative / decimal / future date
    const catId = (
      await call<{ data: { id: string }[] }>('GET', '/expense-categories', {
        headers: bearer(jTok),
      })
    ).data.data[0]!.id;
    for (const amount of [0, -5, 10.5]) {
      await call('POST', '/expenses', {
        headers: bearer(jTok),
        body: {
          category_id: catId,
          spent_on: today,
          description: 'bad',
          amount,
          funding_source: 'drawer',
        },
        expect: 400,
      });
    }
    await call('POST', '/expenses', {
      headers: bearer(jTok),
      body: {
        category_id: catId,
        spent_on: '2999-01-01',
        description: 'bad',
        amount: 1000,
        funding_source: 'drawer',
      },
      expect: 400,
    });
    // export CSV: header + the 2 active rows, same total
    const res = await fetch(
      `http://127.0.0.1:3100/v1/expenses/export?format=csv&date_from=${today}&date_to=${today}`,
      { headers: bearer(jTok) },
    );
    expect(res.status).toBe(200);
    const csv = (await res.text()).replace(/^﻿/, '').trim().split('\r\n');
    expect(csv[0]).toContain('Jumlah');
    expect(csv).toHaveLength(3);
    expect(csv.join('\n')).toContain('12500');
    expect(csv.join('\n')).not.toContain('PLM4');
    const xl = await fetch(
      `http://127.0.0.1:3100/v1/expenses/export?format=xlsx&outlet_scope=all`,
      { headers: bearer(jTok) },
    );
    expect(xl.status).toBe(200);
    expect((await xl.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  test('TC-MB-03 manager: hanya cabang miliknya; kasir tidak bisa akses laporan/pengeluaran', async () => {
    const m = await login('mgr4@e2e.test');
    expect(m.user.outlets.map((o) => o.role)).toEqual(['manager']);
    await call('POST', '/auth/switch-outlet', {
      headers: bearer(m.access_token),
      body: { outlet_id: state['plmId'] },
      expect: 403,
    });
    await call('GET', '/expenses?outlet_scope=all', {
      headers: bearer(m.access_token),
      expect: 403,
    });
    await call(
      'GET',
      `/reports/expenses?month_from=${today.slice(0, 7)}&month_to=${today.slice(0, 7)}&outlet_scope=all`,
      { headers: bearer(m.access_token), expect: 403 },
    );
    const { data } = await call<{ data: unknown[] }>('GET', '/expenses', {
      headers: bearer(m.access_token),
    });
    expect(JSON.stringify(data)).not.toContain('PLM4');
    // an expense of a branch the manager is not a member of: no read, no write (by design an owner of both branches may act across them, ADR-0021)
    const oTok = (await switchTo((await login('branch@e2e.test')).access_token, state['plmId']))
      .access_token;
    const pId = (
      await call<{ data: { id: string }[] }>('GET', '/expenses', { headers: bearer(oTok) })
    ).data.data[0]!.id;
    await call('GET', `/expenses/${pId}`, { headers: bearer(m.access_token), expect: [403, 404] });
    await call('PATCH', `/expenses/${pId}`, {
      headers: bearer(m.access_token),
      body: { amount: 1 },
      expect: [403, 404],
    });
    await call('DELETE', `/expenses/${pId}`, {
      headers: bearer(m.access_token),
      body: { reason: 'lintas cabang' },
      expect: [403, 404],
    });
    expect(
      (await call<any>('GET', `/expenses/${pId}`, { headers: bearer(oTok) })).data.amount,
    ).toBe(7_000);
    await call('POST', '/expense-categories', {
      headers: bearer(m.access_token),
      body: { group: 'lainnya', name: 'X' },
      expect: 403,
    });
    // cashier (employee token) must not read expenses, reports or dashboard
    const c = (state['a'] as { cashier: Cashier }).cashier;
    for (const path of [
      '/expenses',
      '/expense-categories',
      '/reports/expenses?month_from=2026-11&month_to=2026-11',
      '/dashboard/summary',
    ]) {
      await call('GET', path, { headers: c.headers, expect: [401, 403] });
    }
  });

  test('TC-MB-04 rename JUS4 -> RGN: data utuh, nomor lama tetap diterima, HP kasir tetap transaksi', async () => {
    const a = state['a'] as { shop: Shop; cashier: Cashier; shift: string };
    const s = await login('branch@e2e.test');
    const jTok = (await switchTo(s.access_token, state['jusId'])).access_token;
    const count = async (path: string) =>
      (await call<{ data: unknown[] }>('GET', path, { headers: bearer(jTok) })).data.data.length;
    const before = {
      tx: await count('/transactions?scope=today'),
      products: await count('/products'),
      employees: await count('/employees'),
      devices: await count('/devices'),
      expenses: await count('/expenses'),
      revenue: (
        await call<any>('GET', `/dashboard/summary?date_from=${today}&date_to=${today}`, {
          headers: bearer(jTok),
        })
      ).data.revenue,
    };
    psqlFile('rename-outlet.sql', {
      old_code: 'JUS4',
      new_code: 'RGN4',
      new_name: 'Jus Ragunan 4',
      operations_started_on: today.slice(0, 8) + '01',
    });
    // idempotent re-run must not fail
    psqlFile('rename-outlet.sql', {
      old_code: 'RGN4',
      new_code: 'RGN4',
      new_name: 'Jus Ragunan 4',
    });
    const s2 = await login('branch@e2e.test');
    expect(s2.user.outlets.map((o) => o.code).sort()).toEqual(['PLM4', 'RGN4']);
    const rTok = (await switchTo(s2.access_token, state['jusId'])).access_token;
    const countR = async (path: string) =>
      (await call<{ data: unknown[] }>('GET', path, { headers: bearer(rTok) })).data.data.length;
    expect({
      tx: await countR('/transactions?scope=today'),
      products: await countR('/products'),
      employees: await countR('/employees'),
      devices: await countR('/devices'),
      expenses: await countR('/expenses'),
      revenue: (
        await call<any>('GET', `/dashboard/summary?date_from=${today}&date_to=${today}`, {
          headers: bearer(rTok),
        })
      ).data.revenue,
    }).toEqual(before);
    // old number JUS4-... still listed, and the paired phone (not re-paired, old code) keeps selling
    const { data: tx } = await call<{ data: { number: string }[] }>(
      'GET',
      '/transactions?scope=today',
      { headers: bearer(rTok) },
    );
    expect(tx.data.some((t) => t.number.startsWith('JUS4-'))).toBe(true);
    const oldCode = await sell(a.shop, a.cashier, a.shift, a.shop.products.jeruk, 1, 'cash');
    expect(oldCode.number.startsWith('JUS4-')).toBe(true);
    // new code accepted too
    const withNew = await sell(
      { ...a.shop, outletCode: 'RGN4' },
      a.cashier,
      a.shift,
      a.shop.products.jeruk,
      1,
      'cash',
    );
    expect(withNew.number.startsWith('RGN4-')).toBe(true);
    // a number with a foreign branch code is rejected
    await sell(
      { ...a.shop, outletCode: 'PLM4' },
      a.cashier,
      a.shift,
      a.shop.products.jeruk,
      1,
      'cash',
    ).then(
      () => {
        throw new Error('PLM4 number accepted on RGN4 device');
      },
      (e: { status?: number }) => expect(e.status).toBeGreaterThanOrEqual(400),
    );
    // old code cannot be reused for a new branch
    expect(() =>
      psqlFile('create-branch-outlet.sql', {
        code: 'JUS4',
        name: 'Dup',
        owner_email: 'branch@e2e.test',
      }),
    ).toThrow();
    // recap counts from the start date and revenue still matches the dashboard (+24.000 of the 2 new sales)
    const month = today.slice(0, 7);
    const rep = (
      await call<any>('GET', `/reports/expenses?month_from=${month}&month_to=${month}`, {
        headers: bearer(rTok),
      })
    ).data;
    expect(rep.total.total.revenue).toBe(before.revenue + 24_000);
  });
});

/**
 * DEAR-160: the staging QA seed (apps/api/src/scripts/seed-qa-multibranch.ts) run against a fresh owner with one branch,
 * then the Beranda "Semua cabang" view. Seed totals today: QAMED 57.000 (tunai 15.000, QRIS 42.000, 4 cup),
 * QAM2 75.000 (tunai 24.000, QRIS 51.000, 6 cup).
 */
test.describe.serial('DEAR-160 Beranda "Semua cabang" dari seed QA', () => {
  const OWNER = 'seedqa@e2e.test';
  const MANAGER = 'seedqa-mgr@e2e.test';
  const run = (script: string, env: Record<string, string>) =>
    execFileSync('pnpm', ['--filter', '@kelola-kasir/api', script], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const seed = () =>
    run('seed:qa-multibranch', {
      QA_OWNER_EMAIL: OWNER,
      QA_MANAGER_EMAIL: MANAGER,
      QA_MANAGER_PASSWORD: PASS,
    });

  test('seed berjalan dan idempoten (jalan kedua tidak menambah apa pun)', async () => {
    run('owner:create', {
      OWNER_EMAIL: OWNER,
      OWNER_PASSWORD: PASS,
      OUTLET_CODE: 'QAMED',
      OUTLET_NAME: 'Toko QAMED',
    });
    expect((await login(OWNER)).user.outlets).toHaveLength(1);
    seed();
    seed();
    const s = await login(OWNER);
    expect(s.user.outlets.map((o) => o.code).sort()).toEqual(['QAM2', 'QAMED']);
    const m = await login(MANAGER);
    expect(m.user.outlets.map((o) => `${o.code}:${o.role}`)).toEqual(['QAM2:manager']);
    const q = `date_from=${today}&date_to=${today}&outlet_scope=all`;
    const sum = (
      await call<any>('GET', `/dashboard/summary?${q}`, { headers: bearer(s.access_token) })
    ).data;
    expect(sum.revenue).toBe(132_000);
    expect(sum.transaction_count).toBe(6);
  });

  test('menolak email manager yang sudah terdaftar sebagai akun asli (tidak mengubah apa pun)', async () => {
    // owner@e2e.test is a real-looking existing account with memberships elsewhere: must never become a manager of QAM2
    expect(() =>
      run('seed:qa-multibranch', {
        QA_OWNER_EMAIL: OWNER,
        QA_MANAGER_EMAIL: 'owner@e2e.test',
        QA_MANAGER_PASSWORD: PASS,
      }),
    ).toThrow(/not a QA test manager/);
    const o = await login('owner@e2e.test');
    expect(o.user.outlets.map((x) => x.code)).not.toContain('QAM2');
    // the seeded test manager is still accepted on a re-run (covered by the idempotent seed above)
  });

  test('Semua cabang: tabel Per cabang sesuai seed, tanpa kalimat rame/sepi, judul berlabel cabang', async ({
    page,
  }) => {
    await openAsOwner(page, '/', OWNER);
    await expect(page.getByRole('heading', { name: 'Per cabang' })).toHaveCount(0);
    // make QAMED the active branch first (after login the active one can be either), then choose "Semua cabang"
    await page.getByRole('button', { name: /Ganti cabang/ }).click();
    await page.getByRole('option', { name: /Toko QAMED/ }).click();
    await expect(page.getByRole('button', { name: /Cabang aktif: Toko QAMED/ })).toBeVisible();
    await page.getByRole('button', { name: /Ganti cabang/ }).click();
    await page.getByRole('option', { name: /Semua cabang/ }).click();

    const table = page.getByRole('table');
    await expect(page.getByRole('heading', { name: 'Per cabang' })).toBeVisible();
    const qamed = table.getByRole('row', { name: /Toko QAMED/ });
    await expect(qamed).toContainText(rp(57_000));
    await expect(qamed).toContainText(rp(15_000));
    await expect(qamed).toContainText(rp(42_000));
    await expect(qamed).toContainText(/42\.000\D*4$/);
    const qam2 = table.getByRole('row', { name: /Cabang Uji QA \(uji\)/ });
    await expect(qam2).toContainText(rp(75_000));
    await expect(qam2).toContainText(rp(24_000));
    await expect(qam2).toContainText(rp(51_000));
    await expect(qam2).toContainText(/51\.000\D*6$/);

    await expect(page.getByText(/Hari ini (rame|lagi sepi|normal)/)).toHaveCount(0);
    // chart keeps following the active branch (the one chosen before "Semua cabang"): QAMED
    await expect(
      page.getByRole('heading', { name: /^Penjualan per jam · Toko QAMED$/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Penjualan per Produk' })).toBeVisible();
  });

  test('manager satu cabang: tidak ada pilihan Semua cabang', async ({ page }) => {
    await openAsOwner(page, '/', MANAGER);
    await expect(page.getByRole('button', { name: /Ganti cabang/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Per cabang' })).toHaveCount(0);
  });
});
