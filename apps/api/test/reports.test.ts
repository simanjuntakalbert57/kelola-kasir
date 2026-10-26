import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactions } from '../src/db/schema.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  post,
  seedTransaction,
  txBody,
  type Shop,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

const owner = (shop: Shop) => bearer(shop.ownerToken);

interface Summary {
  revenue: number;
  transaction_count: number;
  average_ticket: number;
  cash_revenue: number;
  qris_revenue: number;
  cash_count: number;
  qris_count: number;
  voided_count: number;
  pending_void_count: number;
  compare_previous_period: { revenue_change_pct: number | null };
}

/** WIB (UTC+7) wall-clock time on 2026-03-10 as an instant. */
const wib = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00+07:00`);

async function seedDay(shop: Shop) {
  const base = {
    shiftId: shop.shiftId,
    outletId: shop.seeded.outletId,
    deviceId: shop.cashier.deviceId,
    employeeId: shop.cashier.employeeId,
  };
  const sale = (total: number, at: Date, o: Partial<Parameters<typeof seedTransaction>[1]> = {}) =>
    seedTransaction(env, { ...base, total, createdAt: at, ...o });
  await sale(15_000, wib('2026-03-10', '10:30'));
  await sale(30_000, wib('2026-03-10', '10:45'), { method: 'qris' });
  await sale(5_000, wib('2026-03-10', '23:30'), { status: 'void_requested' });
  await sale(7_000, wib('2026-03-10', '12:00'), { status: 'voided' });
  await sale(9_000, wib('2026-03-10', '13:00'), { status: 'cancelled', method: 'qris' });
  await sale(11_000, wib('2026-03-10', '14:00'), { status: 'pending', method: 'qris' });
  // 00:30 WIB belongs to the next business day even though it is still 10 March in UTC.
  await sale(20_000, wib('2026-03-11', '00:30'));
}

describe('GET /dashboard/summary', () => {
  it('counts paid and void_requested of the WIB business day, split by method', async () => {
    const shop = await createShop(env);
    await seedDay(shop);
    const res = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-10&date_to=2026-03-10',
      owner(shop),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(json<Summary>(res)).toMatchObject({
      revenue: 50_000,
      transaction_count: 3,
      average_ticket: 16_666,
      cash_revenue: 20_000,
      cash_count: 2,
      qris_revenue: 30_000,
      qris_count: 1,
      voided_count: 1,
      pending_void_count: 1,
    });
  });

  it('matches the sum of the paid transactions in the database', async () => {
    const shop = await createShop(env);
    await seedDay(shop);
    const [row] = await env.handle.db
      .select({ total: sql<string>`coalesce(sum(${transactions.total}), 0)::text` })
      .from(transactions)
      .where(
        and(
          eq(transactions.outletId, shop.seeded.outletId),
          inArray(transactions.status, ['paid', 'void_requested']),
        ),
      );
    const res = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-10&date_to=2026-03-11',
      owner(shop),
    );
    expect(json<Summary>(res).revenue).toBe(Number(row?.total));
    expect(Number(row?.total)).toBe(70_000);
  });

  it('compares with the previous period of the same length', async () => {
    const shop = await createShop(env);
    await seedDay(shop);
    const res = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-11&date_to=2026-03-11',
      owner(shop),
    );
    expect(json<Summary>(res)).toMatchObject({
      revenue: 20_000,
      compare_previous_period: { revenue_change_pct: -60 },
    });
    const empty = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-09&date_to=2026-03-09',
      owner(shop),
    );
    expect(json<Summary>(empty)).toMatchObject({
      revenue: 0,
      average_ticket: 0,
      compare_previous_period: { revenue_change_pct: null },
    });
  });

  it('never mixes outlets', async () => {
    const a = await createShop(env);
    const b = await createShop(env);
    await seedDay(a);
    const res = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-10&date_to=2026-03-10',
      owner(b),
    );
    expect(json<Summary>(res).revenue).toBe(0);
  });

  it('defaults to today, rejects bad ranges and non-owners', async () => {
    const shop = await createShop(env);
    await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop, { qty: 2 }));
    const today = await get(env, '/v1/dashboard/summary', owner(shop));
    expect(json<Summary>(today)).toMatchObject({ revenue: 30_000, transaction_count: 1 });

    const reversed = await get(
      env,
      '/v1/dashboard/summary?date_from=2026-03-11&date_to=2026-03-10',
      owner(shop),
    );
    expect(reversed.statusCode).toBe(400);
    const wide = await get(
      env,
      '/v1/dashboard/summary?date_from=2024-01-01&date_to=2026-03-10',
      owner(shop),
    );
    expect(wide.statusCode).toBe(400);
    // Dates outside 2020-2099 are validation errors, not database overflows.
    for (const url of [
      '/v1/dashboard/summary?date_to=0001-01-01',
      '/v1/reports/sales?group_by=day&date_from=9999-12-31',
      '/v1/transactions/export?format=csv&date_from=0001-01-01',
    ]) {
      expect((await get(env, url, owner(shop))).statusCode, url).toBe(400);
    }
    expect((await get(env, '/v1/dashboard/summary', shop.cashier.headers)).statusCode).toBe(403);
    expect((await get(env, '/v1/dashboard/summary', {})).statusCode).toBe(401);
  });
});

describe('GET /dashboard/sales-series', () => {
  interface Series {
    data: { bucket_start: string; revenue: number; transaction_count: number }[];
  }

  it('returns one bucket per WIB day, zero-filled', async () => {
    const shop = await createShop(env);
    await seedDay(shop);
    const res = await get(
      env,
      '/v1/dashboard/sales-series?date_from=2026-03-09&date_to=2026-03-11&granularity=day',
      owner(shop),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(json<Series>(res).data).toEqual([
      { bucket_start: '2026-03-08T17:00:00.000Z', revenue: 0, transaction_count: 0 },
      { bucket_start: '2026-03-09T17:00:00.000Z', revenue: 50_000, transaction_count: 3 },
      { bucket_start: '2026-03-10T17:00:00.000Z', revenue: 20_000, transaction_count: 1 },
    ]);
  });

  it('returns 24 hourly buckets whose sum equals the day', async () => {
    const shop = await createShop(env);
    await seedDay(shop);
    const res = await get(
      env,
      '/v1/dashboard/sales-series?date_from=2026-03-10&date_to=2026-03-10&granularity=hour',
      owner(shop),
    );
    const { data } = json<Series>(res);
    expect(data).toHaveLength(24);
    expect(data[0]?.bucket_start).toBe('2026-03-09T17:00:00.000Z');
    const at = (hour: number) => data[hour];
    expect(at(10)).toMatchObject({ revenue: 45_000, transaction_count: 2 });
    expect(at(23)).toMatchObject({ revenue: 5_000, transaction_count: 1 });
    expect(data.reduce((n, d) => n + d.revenue, 0)).toBe(50_000);
  });

  it('requires a granularity and limits hourly ranges', async () => {
    const shop = await createShop(env);
    expect((await get(env, '/v1/dashboard/sales-series', owner(shop))).statusCode).toBe(400);
    const res = await get(
      env,
      '/v1/dashboard/sales-series?date_from=2026-01-01&date_to=2026-03-01&granularity=hour',
      owner(shop),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('top products and sales report', () => {
  async function sellMix() {
    const shop = await createShop(env);
    const mango = json<{ id: string; name: string; price: number }>(
      await post(env, '/v1/products', owner(shop), {
        category_id: shop.category.id,
        name: 'Jus Mangga',
        price: 12_000,
      }),
    );
    const buy = async (product: { id: string; name: string; price: number }, qty: number) => {
      const body = txBody(env, shop, { qty });
      body.items[0] = {
        ...body.items[0],
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        line_total: product.price * qty,
      } as (typeof body.items)[0];
      body.subtotal = body.total = product.price * qty;
      body.payment = { id: body.payment.id, method: 'cash', cash_tendered: body.total };
      const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
      expect(res.statusCode, res.body).toBe(201);
    };
    await buy(shop.product, 3);
    await buy(mango, 1);
    await buy(shop.product, 1);
    return { shop, mango };
  }

  it('ranks products by quantity with their revenue', async () => {
    const { shop, mango } = await sellMix();
    const res = await get(env, '/v1/dashboard/top-products?limit=5', owner(shop));
    expect(json<{ data: unknown[] }>(res).data).toEqual([
      { product_id: shop.product.id, product_name: 'Jus Alpukat', quantity: 4, revenue: 60_000 },
      { product_id: mango.id, product_name: 'Jus Mangga', quantity: 1, revenue: 12_000 },
    ]);
    const one = await get(env, '/v1/dashboard/top-products?limit=1', owner(shop));
    expect(json<{ data: unknown[] }>(one).data).toHaveLength(1);
    expect((await get(env, '/v1/dashboard/top-products?limit=51', owner(shop))).statusCode).toBe(
      400,
    );
  });

  it('groups the sales report by product, employee, payment method and day', async () => {
    const { shop } = await sellMix();
    const group = async (by: string) =>
      json<{ data: Record<string, unknown>[] }>(
        await get(env, `/v1/reports/sales?group_by=${by}`, owner(shop)),
      ).data;

    expect(await group('product')).toMatchObject([
      { label: 'Jus Alpukat', quantity: 4, transaction_count: 2, revenue: 60_000 },
      { label: 'Jus Mangga', quantity: 1, transaction_count: 1, revenue: 12_000 },
    ]);
    expect(await group('employee')).toEqual([
      {
        key: shop.cashier.employeeId,
        label: 'Siti',
        quantity: 5,
        transaction_count: 3,
        revenue: 72_000,
      },
    ]);
    expect(await group('payment_method')).toEqual([
      { key: 'cash', label: 'Tunai', quantity: 5, transaction_count: 3, revenue: 72_000 },
    ]);
    const days = await group('day');
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ transaction_count: 3, revenue: 72_000 });
    expect((await get(env, '/v1/reports/sales', owner(shop))).statusCode).toBe(400);
  });
});
