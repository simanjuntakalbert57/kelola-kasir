import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  categories,
  payments,
  products,
  transactionItems,
  transactions,
} from '../src/db/schema.js';
import { addMembership, createMember, loginAs, userId } from './branch-helpers.js';
import { bearer, createShop, createTestEnv, get, type Shop, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

const wib = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00+07:00`);
const DAY = 'date_from=2026-03-10&date_to=2026-03-10';

interface Row {
  key: string;
  product_id: string | null;
  product_name: string;
  category_name: string | null;
  items_sold: number;
  revenue: number;
  share_pct: number;
  transaction_count: number;
  has_sales: boolean;
}
interface Report {
  outlet_scope: string;
  date_from: string;
  date_to: string;
  totals: { items_sold: number; revenue: number; product_count: number };
  data: Row[];
}

async function addProduct(
  shop: Shop,
  name: string,
  o: { price?: number; isActive?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await env.handle.db.insert(products).values({
    id,
    outletId: shop.seeded.outletId,
    categoryId: shop.category.id,
    name,
    price: o.price ?? 10_000,
    isActive: o.isActive ?? true,
    ...(o.deleted ? { deletedAt: new Date() } : {}),
  });
  return id;
}

interface Line {
  product: string | null;
  name: string;
  qty: number;
  price: number;
}

/** A transaction whose total is the sum of its lines. */
async function sell(
  shop: Shop,
  at: Date,
  lines: Line[],
  o: {
    status?: 'paid' | 'void_requested' | 'voided' | 'cancelled' | 'pending';
    method?: 'cash' | 'qris';
    deleted?: boolean;
  } = {},
) {
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const id = uuidv7();
  const method = o.method ?? 'cash';
  await env.handle.db.insert(transactions).values({
    id,
    outletId: shop.seeded.outletId,
    shiftId: shop.shiftId,
    deviceId: shop.cashier.deviceId,
    employeeId: shop.cashier.employeeId,
    number: `T-PS-${id.slice(-10)}`,
    status: o.status ?? 'paid',
    paymentMethod: method,
    subtotal: total,
    total,
    clientCreatedAt: at,
    ...(o.deleted
      ? {
          deletedAt: at,
          deletedBy: await userId(env, shop.seeded.ownerEmail),
          deleteReason: 'test',
        }
      : {}),
    paidAt: at,
  });
  await env.handle.db.insert(transactionItems).values(
    lines.map((l) => ({
      id: uuidv7(),
      transactionId: id,
      productId: l.product,
      productName: l.name,
      unitPrice: l.price,
      quantity: l.qty,
      lineTotal: l.qty * l.price,
    })),
  );
  await env.handle.db.insert(payments).values({
    id: uuidv7(),
    transactionId: id,
    method,
    provider: method === 'cash' ? 'cash' : 'qris_static',
    status: 'paid',
    amount: total,
  });
}

const line = (product: string | null, name: string, qty: number, price: number): Line => ({
  product,
  name,
  qty,
  price,
});
const list = async (shop: Shop, qs: string, headers = bearer(shop.ownerToken)) => {
  const res = await get(env, `/v1/reports/products?${qs}`, headers);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Report;
};

/** A shop with Mangga (3 sales lines), Alpukat, an unsold product and rows that must not count. */
async function seedMenu() {
  const shop = await createShop(env);
  const alpukat = shop.product.id;
  const mangga = await addProduct(shop, 'Jus Mangga', { price: 12_000 });
  const unsold = await addProduct(shop, 'Jus Jeruk', { price: 9_000 });
  const inactive = await addProduct(shop, 'Jus Lama', { isActive: false });
  const gone = await addProduct(shop, 'Jus Hapus', { deleted: true });
  const t = wib('2026-03-10', '10:00');
  await sell(shop, t, [
    line(mangga, 'Jus Mangga', 3, 12_000),
    line(alpukat, 'Jus Alpukat', 2, 15_000),
  ]);
  await sell(shop, t, [line(mangga, 'Jus Mangga', 1, 12_000)], { method: 'qris' });
  await sell(shop, t, [line(alpukat, 'Jus Alpukat', 1, 15_000)], { status: 'void_requested' });
  await sell(shop, t, [line(alpukat, 'Jus Alpukat', 9, 15_000)], { status: 'voided' });
  await sell(shop, t, [line(alpukat, 'Jus Alpukat', 9, 15_000)], { status: 'cancelled' });
  await sell(shop, t, [line(alpukat, 'Jus Alpukat', 9, 15_000)], { status: 'pending' });
  await sell(shop, t, [line(alpukat, 'Jus Alpukat', 9, 15_000)], { deleted: true });
  await sell(shop, wib('2026-03-11', '00:30'), [line(alpukat, 'Jus Alpukat', 9, 15_000)]);
  return { shop, alpukat, mangga, unsold, inactive, gone };
}

describe('GET /reports/products', () => {
  it('sums cups and Rupiah, counts void_requested only, and includes active unsold products', async () => {
    const { shop, alpukat, mangga, unsold, inactive, gone } = await seedMenu();
    const body = await list(shop, DAY);
    expect(body).toMatchObject({
      outlet_scope: 'current',
      date_from: '2026-03-10',
      date_to: '2026-03-10',
    });
    expect(body.totals).toEqual({ items_sold: 7, revenue: 93_000, product_count: 3 });
    const names = body.data.map((r) => r.product_name);
    expect(names).toEqual(['Jus Mangga', 'Jus Alpukat', 'Jus Jeruk']);
    const [m, a, u] = body.data;
    expect(m).toMatchObject({
      product_id: mangga,
      key: mangga,
      items_sold: 4,
      revenue: 48_000,
      share_pct: 51.6,
      transaction_count: 2,
      has_sales: true,
    });
    expect(a).toMatchObject({
      product_id: alpukat,
      items_sold: 3,
      revenue: 45_000,
      share_pct: 48.4,
      transaction_count: 2,
    });
    expect(u).toMatchObject({
      product_id: unsold,
      items_sold: 0,
      revenue: 0,
      share_pct: 0,
      has_sales: false,
    });
    expect(m?.category_name).toBe('Jus Buah');
    expect(body.data.map((r) => r.product_id)).not.toContain(inactive);
    expect(body.data.map((r) => r.product_id)).not.toContain(gone);
  });

  it('keeps share_pct and totals when q filters, escaping LIKE wildcards', async () => {
    const { shop } = await seedMenu();
    const all = await list(shop, DAY);
    const q = await list(shop, `${DAY}&q=MANG`);
    expect(q.data.map((r) => r.product_name)).toEqual(['Jus Mangga']);
    expect(q.totals).toEqual(all.totals);
    expect(q.data[0]?.share_pct).toBe(all.data[0]?.share_pct);
    expect((await list(shop, `${DAY}&q=%25`)).data).toEqual([]);
    expect((await list(shop, `${DAY}&q=_`)).data).toEqual([]);
  });

  it('sorts by every key with the cups > Rupiah > name tie-break', async () => {
    const { shop } = await seedMenu();
    const names = async (qs: string) =>
      (await list(shop, `${DAY}&${qs}`)).data.map((r) => r.product_name);
    expect(await names('sort=items_sold&order=asc')).toEqual([
      'Jus Jeruk',
      'Jus Alpukat',
      'Jus Mangga',
    ]);
    expect(await names('sort=revenue')).toEqual(['Jus Mangga', 'Jus Alpukat', 'Jus Jeruk']);
    expect(await names('sort=share_pct&order=asc')).toEqual([
      'Jus Jeruk',
      'Jus Alpukat',
      'Jus Mangga',
    ]);
    expect(await names('sort=name')).toEqual(['Jus Alpukat', 'Jus Jeruk', 'Jus Mangga']);
    expect(await names('sort=name&order=desc')).toEqual(['Jus Mangga', 'Jus Jeruk', 'Jus Alpukat']);
    // Equal revenue and cups fall back to name.
    const tie = await createShop(env);
    const b = await addProduct(tie, 'Bbb');
    const a = await addProduct(tie, 'Aaa');
    await sell(tie, wib('2026-03-10', '09:00'), [
      line(b, 'Bbb', 1, 5_000),
      line(a, 'Aaa', 1, 5_000),
    ]);
    const rows = (await list(tie, `${DAY}&sort=revenue`)).data.filter((r) => r.has_sales);
    expect(rows.map((r) => r.product_name)).toEqual(['Aaa', 'Bbb']);
  });

  it('groups sold items without a product by their name snapshot', async () => {
    const shop = await createShop(env);
    const t = wib('2026-03-10', '10:00');
    await sell(shop, t, [line(null, 'Jus Dulu', 2, 8_000)]);
    await sell(shop, t, [line(null, 'Jus Dulu', 1, 8_000)]);
    const body = await list(shop, DAY);
    const row = body.data.find((r) => r.product_name === 'Jus Dulu');
    expect(row).toMatchObject({
      key: 'name:Jus Dulu',
      product_id: null,
      items_sold: 3,
      revenue: 24_000,
    });
  });

  it('matches /dashboard/summary items_sold for the same scope and period', async () => {
    const { shop } = await seedMenu();
    const summary = JSON.parse(
      (await get(env, `/v1/dashboard/summary?${DAY}`, bearer(shop.ownerToken))).body,
    );
    expect((await list(shop, DAY)).totals.items_sold).toBe(summary.items_sold);
  });

  it('shows a deleted or inactive product that sold in the period', async () => {
    const shop = await createShop(env);
    const gone = await addProduct(shop, 'Jus Hapus', { deleted: true });
    await sell(shop, wib('2026-03-10', '10:00'), [line(gone, 'Jus Hapus', 2, 10_000)]);
    const body = await list(shop, DAY);
    expect(body.data.find((r) => r.product_id === gone)).toMatchObject({ items_sold: 2 });
  });

  it('rejects a period over 366 days and a bad sort', async () => {
    const shop = await createShop(env);
    const h = bearer(shop.ownerToken);
    expect(
      (await get(env, '/v1/reports/products?date_from=2025-01-01&date_to=2026-03-10', h))
        .statusCode,
    ).toBe(400);
    expect((await get(env, '/v1/reports/products?sort=nope', h)).statusCode).toBe(400);
  });
});

/** Two outlets with the same owner and a "Jus Mangga" in both. */
async function seedBranches() {
  const a = await createShop(env);
  const b = await createShop(env);
  await addMembership(env, a.seeded.ownerEmail, b.seeded.outletId, 'owner');
  const owner = await loginAs(env, a.seeded.ownerEmail, a.seeded.outletId);
  const mangA = await addProduct(a, 'Jus Mangga');
  const mangB = await addProduct(b, '  jus  mangga ');
  const onlyB = await addProduct(b, 'Jus Naga');
  const t = wib('2026-03-10', '10:00');
  await sell(a, t, [line(mangA, 'Jus Mangga', 2, 10_000)]);
  await sell(b, t, [line(mangB, 'Jus Mangga', 3, 10_000), line(onlyB, 'Jus Naga', 1, 20_000)]);
  await sell(b, wib('2026-03-09', '10:00'), [line(mangB, 'Jus Mangga', 1, 10_000)]);
  return { a, b, mangA, mangB, onlyB, headers: owner.headers };
}

describe('outlet_scope', () => {
  it('current does not leak the other outlet', async () => {
    const { a, headers, mangA, mangB } = await seedBranches();
    const body = await list(a, DAY, headers);
    expect(body.data.map((r) => r.product_id)).toContain(mangA);
    expect(body.data.map((r) => r.product_id)).not.toContain(mangB);
    expect(body.data.find((r) => r.product_id === mangA)).toMatchObject({ items_sold: 2 });
  });

  it('all merges same-named products across outlets with by_outlet in the detail', async () => {
    const { a, b, headers, mangA, mangB } = await seedBranches();
    const body = await list(a, `${DAY}&outlet_scope=all`, headers);
    const mangga = body.data.filter((r) => r.product_name.toLowerCase().includes('mangga'));
    expect(mangga).toHaveLength(1);
    expect(mangga[0]).toMatchObject({
      product_id: mangA,
      items_sold: 5,
      revenue: 50_000,
      key: 'name:jus mangga',
    });
    expect(body.totals.items_sold).toBe(6);
    const summary = JSON.parse(
      (await get(env, `/v1/dashboard/summary?${DAY}&outlet_scope=all`, headers)).body,
    );
    expect(body.totals.items_sold).toBe(summary.items_sold);

    // Any product of the group opens the same merged detail.
    for (const id of [mangA, mangB]) {
      const res = await get(env, `/v1/reports/products/${id}?${DAY}&outlet_scope=all`, headers);
      expect(res.statusCode, res.body).toBe(200);
      const d = JSON.parse(res.body);
      expect(d).toMatchObject({
        product_name: 'Jus Mangga',
        items_sold: 5,
        revenue: 50_000,
        outlet_scope: 'all',
      });
      expect(d.by_outlet).toEqual(
        [a, b]
          .map((s) => s.seeded)
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((o) => ({
            outlet_id: o.outletId,
            outlet_name: `Outlet ${o.code}`,
            items_sold: o.outletId === a.seeded.outletId ? 2 : 3,
            revenue: o.outletId === a.seeded.outletId ? 20_000 : 30_000,
          })),
      );
      expect(d.by_employee).toHaveLength(2);
    }
  });

  it('a manager gets 403 for all and 404 for another outlet’s product', async () => {
    const { a, b, mangB } = await seedBranches();
    const manager = await createMember(env, a.seeded, 'manager');
    expect(
      (await get(env, `/v1/reports/products?${DAY}&outlet_scope=all`, manager.headers)).statusCode,
    ).toBe(403);
    expect(
      (await get(env, `/v1/reports/products/${mangB}?${DAY}`, manager.headers)).statusCode,
    ).toBe(404);
    expect(
      (
        await get(
          env,
          `/v1/reports/products/${mangB}/series?${DAY}&granularity=day`,
          manager.headers,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await get(env, `/v1/reports/products/export?format=csv&outlet_scope=all`, manager.headers))
        .statusCode,
    ).toBe(403);
    // The owner of A only (current scope) does not see B either.
    const ownerOnlyA = bearer(a.ownerToken);
    expect((await get(env, `/v1/reports/products/${mangB}?${DAY}`, ownerOnlyA)).statusCode).toBe(
      404,
    );
    expect(b.seeded.outletId).not.toBe(a.seeded.outletId);
  });
});

describe('GET /reports/products/{product_id}', () => {
  it('summarises one product with payment split, rank, share and previous period', async () => {
    const { shop, mangga, unsold } = await seedMenu();
    // Previous period (9 March): 2 cups of mangga, so 4 cups is +100%.
    await sell(shop, wib('2026-03-09', '10:00'), [line(mangga, 'Jus Mangga', 2, 12_000)]);
    const res = await get(env, `/v1/reports/products/${mangga}?${DAY}`, bearer(shop.ownerToken));
    expect(res.statusCode, res.body).toBe(200);
    const d = JSON.parse(res.body);
    expect(d).toMatchObject({
      product_id: mangga,
      product_name: 'Jus Mangga',
      category_name: 'Jus Buah',
      catalog_price: 12_000,
      outlet_scope: 'current',
      items_sold: 4,
      revenue: 48_000,
      average_price: 12_000,
      share_pct: 51.6,
      transaction_count: 2,
      rank: 1,
      product_count: 3,
      compare_previous_period: { items_sold_change_pct: 100, revenue_change_pct: 100 },
      by_outlet: [],
    });
    expect(d.by_payment_method).toEqual([
      { method: 'cash', items_sold: 3, revenue: 36_000, share_pct: 75 },
      { method: 'qris', items_sold: 1, revenue: 12_000, share_pct: 25 },
    ]);
    expect(d.by_employee).toEqual([
      {
        employee_id: shop.cashier.employeeId,
        employee_name: expect.any(String),
        outlet_name: expect.any(String),
        items_sold: 4,
        revenue: 48_000,
      },
    ]);

    // No sales: zeros, null deltas, last rank.
    const z = JSON.parse(
      (await get(env, `/v1/reports/products/${unsold}?${DAY}`, bearer(shop.ownerToken))).body,
    );
    expect(z).toMatchObject({
      items_sold: 0,
      revenue: 0,
      average_price: 0,
      share_pct: 0,
      rank: 3,
      compare_previous_period: { items_sold_change_pct: null, revenue_change_pct: null },
      by_employee: [],
    });
    expect(z.by_payment_method.map((m: { method: string }) => m.method)).toEqual(['cash', 'qris']);
  });

  it('answers 404 for an unknown product and 400 for a malformed id', async () => {
    const shop = await createShop(env);
    const h = bearer(shop.ownerToken);
    expect((await get(env, `/v1/reports/products/${uuidv7()}?${DAY}`, h)).statusCode).toBe(404);
    expect((await get(env, `/v1/reports/products/nope?${DAY}`, h)).statusCode).toBe(400);
  });
});

describe('GET /reports/products/{product_id}/series', () => {
  it('zero-fills hours and days and counts only the product', async () => {
    const { shop, mangga } = await seedMenu();
    const h = bearer(shop.ownerToken);
    const hourly = JSON.parse(
      (await get(env, `/v1/reports/products/${mangga}/series?${DAY}&granularity=hour`, h)).body,
    ).data;
    expect(hourly).toHaveLength(24);
    expect(hourly[10]).toEqual({
      bucket_start: wib('2026-03-10', '10:00').toISOString(),
      items_sold: 4,
      revenue: 48_000,
    });
    expect(hourly.filter((b: { items_sold: number }) => b.items_sold > 0)).toHaveLength(1);
    const daily = JSON.parse(
      (
        await get(
          env,
          `/v1/reports/products/${mangga}/series?date_from=2026-03-09&date_to=2026-03-11&granularity=day`,
          h,
        )
      ).body,
    ).data;
    expect(daily.map((b: { items_sold: number }) => b.items_sold)).toEqual([0, 4, 0]);
  });

  it('rejects hourly series over 31 days', async () => {
    const { shop, mangga } = await seedMenu();
    const h = bearer(shop.ownerToken);
    const url = (to: string) =>
      `/v1/reports/products/${mangga}/series?date_from=2026-03-01&date_to=${to}&granularity=hour`;
    expect((await get(env, url('2026-03-31'), h)).statusCode).toBe(200);
    expect((await get(env, url('2026-04-01'), h)).statusCode).toBe(400);
  });
});

describe('GET /reports/products/export', () => {
  const parseCsv = (body: string): string[][] =>
    body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .map((l) => l.split(','));

  it('exports the whole list as CSV with a total row, ignoring q, and audits it', async () => {
    const { shop } = await seedMenu();
    const res = await get(
      env,
      `/v1/reports/products/export?format=csv&${DAY}&q=mang`,
      bearer(shop.ownerToken),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'penjualan-produk_2026-03-10_2026-03-10.csv',
    );
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    expect(res.body).toContain('\r\n');
    const rows = parseCsv(res.body);
    const outlet = `Outlet ${shop.seeded.code}`;
    expect(rows).toEqual([
      ['Produk', 'Kategori', 'Cup', 'Total (Rp)', '% omzet', 'Periode', 'Cabang'],
      ['Jus Mangga', 'Jus Buah', '4', '48000', '51.6', '2026-03-10', outlet],
      ['Jus Alpukat', 'Jus Buah', '3', '45000', '48.4', '2026-03-10', outlet],
      ['Jus Jeruk', 'Jus Buah', '0', '0', '0', '2026-03-10', outlet],
      ['Total', '', '7', '93000', '100', '2026-03-10', outlet],
    ]);
    const audit = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'reports.products_exported'));
    expect(audit.some((a) => a.outletId === shop.seeded.outletId)).toBe(true);
  });

  it('exports XLSX and labels Semua cabang', async () => {
    const { a, headers } = await seedBranches();
    const res = await env.app.inject({
      method: 'GET',
      url: `/v1/reports/products/export?format=xlsx&${DAY}&outlet_scope=all`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(
      'penjualan-produk_2026-03-10_2026-03-10.xlsx',
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0];
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      'Produk',
      'Kategori',
      'Cup',
      'Total (Rp)',
      '% omzet',
      'Periode',
      'Cabang',
    ]);
    expect(sheet?.getRow(2).getCell(7).value).toBe('Semua cabang');
    const last = sheet?.getRow(sheet.rowCount);
    expect(last?.getCell(1).value).toBe('Total');
    expect(last?.getCell(3).value).toBe(6);
    expect(a.seeded.outletId).toBeTruthy();
  });

  it('neutralises formula-like product names', async () => {
    const shop = await createShop(env);
    const evil = await addProduct(shop, '=HYPERLINK("x")');
    await sell(shop, wib('2026-03-10', '10:00'), [line(evil, '=HYPERLINK("x")', 1, 1_000)]);
    const res = await get(
      env,
      `/v1/reports/products/export?format=csv&${DAY}`,
      bearer(shop.ownerToken),
    );
    expect(res.body).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('categories', () => {
  it('reports the representative product category', async () => {
    const shop = await createShop(env);
    const [cat] = await env.handle.db
      .insert(categories)
      .values({ outletId: shop.seeded.outletId, name: 'Minuman Dingin' })
      .returning();
    const id = uuidv7();
    await env.handle.db.insert(products).values({
      id,
      outletId: shop.seeded.outletId,
      categoryId: cat?.id ?? '',
      name: 'Es Teh',
      price: 5_000,
    });
    const body = await list(shop, DAY);
    expect(body.data.find((r) => r.product_id === id)?.category_name).toBe('Minuman Dingin');
  });
});
