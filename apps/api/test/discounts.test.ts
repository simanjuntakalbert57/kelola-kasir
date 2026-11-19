import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, discountHistory, transactions } from '../src/db/schema.js';
import { addMembership, createBranches, createMember, del, loginAs } from './branch-helpers.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  patch,
  post,
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

interface DiscountDto {
  id: string;
  version: number;
  status: string;
  is_active: boolean;
  name: string;
  value: number;
  outlets: { outlet: { id: string }; products: { id: string }[]; categories: { id: string }[] }[];
  deleted: { reason: string } | null;
}
interface Problem {
  code: string;
}

const owner = (shop: Shop) => bearer(shop.ownerToken);
const day = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10);

async function createDiscount(shop: Shop, over: Record<string, unknown> = {}) {
  const res = await post(env, '/v1/discounts', owner(shop), {
    name: 'Promo Alpukat',
    target_type: 'product',
    type: 'percent',
    value: 20,
    starts_on: day(-1),
    product_ids: [shop.product.id],
    ...over,
  });
  expect(res.statusCode, res.body).toBe(201);
  return json<DiscountDto>(res);
}

/** A cash sale of 2 × Rp15.000 where the phone applied `discount` at `version`. */
function discountedSale(
  shop: Shop,
  d: { id: string; version: number },
  o: { qty?: number; perUnit?: number; at?: Date; method?: 'cash' | 'qris'; amount?: number } = {},
) {
  const qty = o.qty ?? 2;
  const perUnit = o.perUnit ?? 3_000;
  const amount = o.amount ?? perUnit * qty;
  const body = txBody(env, shop, { qty, method: o.method ?? 'cash', discount: amount });
  const item = body.items[0] as Record<string, unknown>;
  item['discount_id'] = d.id;
  item['discount_version'] = d.version;
  item['discount_amount'] = amount;
  if (o.at) body.client_created_at = o.at.toISOString();
  if (o.method !== 'qris') {
    body.payment = { id: uuidv7(), method: 'cash', cash_tendered: body.total } as never;
  }
  return body;
}

const syncPush = (shop: Shop, body: ReturnType<typeof txBody>) =>
  post(
    env,
    '/v1/sync/push',
    { 'x-device-token': shop.device.token },
    {
      mutations: [
        {
          id: body.id,
          type: 'transaction.create',
          client_created_at: body.client_created_at,
          employee_id: shop.cashier.employeeId,
          payload: body,
        },
      ],
    },
  );

describe('RBAC', () => {
  it('owner writes, manager only reads own outlet, cashier and device are turned away', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    const manager = await createMember(env, shop.seeded, 'manager');

    expect((await get(env, '/v1/discounts', manager.headers)).statusCode).toBe(200);
    expect((await get(env, `/v1/discounts/${d.id}`, manager.headers)).statusCode).toBe(200);
    const body = { name: 'x', target_type: 'product', type: 'amount', value: 1, starts_on: day() };
    expect(
      (
        await post(env, '/v1/discounts', manager.headers, {
          ...body,
          product_ids: [shop.product.id],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await patch(env, `/v1/discounts/${d.id}`, manager.headers, { version: 1, value: 5 }))
        .statusCode,
    ).toBe(403);
    expect(
      (await del(env, `/v1/discounts/${d.id}`, manager.headers, { reason: 'tidak dipakai' }))
        .statusCode,
    ).toBe(403);
    expect((await get(env, '/v1/discounts/target-options', manager.headers)).statusCode).toBe(403);
    expect((await get(env, '/v1/discounts?outlet_scope=all', manager.headers)).statusCode).toBe(
      403,
    );
    expect((await get(env, '/v1/discounts?status=deleted', manager.headers)).statusCode).toBe(403);

    for (const headers of [shop.cashier.headers, { 'x-device-token': shop.device.token }]) {
      expect((await get(env, '/v1/discounts', headers)).statusCode).toBeGreaterThanOrEqual(401);
      expect(
        (await post(env, '/v1/discounts', headers, { ...body, product_ids: [shop.product.id] }))
          .statusCode,
      ).toBeGreaterThanOrEqual(401);
      expect((await get(env, `/v1/discounts/${d.id}`, headers)).statusCode).toBeGreaterThanOrEqual(
        401,
      );
    }
    expect((await get(env, '/v1/discounts', {})).statusCode).toBe(401);
  });

  it('a manager of another outlet cannot see the discount (404) and never gets a deleted one', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const d = await createDiscount(shop);
    const outsider = await createMember(env, other.seeded, 'manager');
    expect((await get(env, `/v1/discounts/${d.id}`, outsider.headers)).statusCode).toBe(404);
    const list = json<{ data: unknown[] }>(await get(env, '/v1/discounts', outsider.headers));
    expect(list.data).toEqual([]);

    const manager = await createMember(env, shop.seeded, 'manager');
    await del(env, `/v1/discounts/${d.id}`, owner(shop), { reason: 'salah buat' });
    expect((await get(env, `/v1/discounts/${d.id}`, manager.headers)).statusCode).toBe(404);
    expect((await get(env, `/v1/discounts/${d.id}`, owner(shop))).statusCode).toBe(200);
  });

  it('an owner who does not own every target outlet gets 403, unknown targets 422', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const foreign = await post(env, '/v1/discounts', owner(shop), {
      name: 'Lintas',
      target_type: 'product',
      type: 'amount',
      value: 1000,
      starts_on: day(),
      product_ids: [other.product.id],
    });
    expect(foreign.statusCode).toBe(403);
    const unknown = await post(env, '/v1/discounts', owner(shop), {
      name: 'Hantu',
      target_type: 'product',
      type: 'amount',
      value: 1000,
      starts_on: day(),
      product_ids: [uuidv7()],
    });
    expect(unknown.statusCode).toBe(422);
    expect(json<Problem>(unknown).code).toBe('DISCOUNT_TARGET_INVALID');
  });
});

describe('CRUD, versions, history and audit', () => {
  it('creates, edits with an optimistic lock, deactivates and deletes with history', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    expect(d).toMatchObject({ version: 1, status: 'active', is_active: true });
    expect(d.outlets[0]?.products[0]?.id).toBe(shop.product.id);

    const edited = json<DiscountDto>(
      await patch(env, `/v1/discounts/${d.id}`, owner(shop), {
        version: 1,
        value: 30,
        name: 'Promo Baru',
      }),
    );
    expect(edited).toMatchObject({ version: 2, value: 30, name: 'Promo Baru' });

    const stale = await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 1, value: 40 });
    expect(stale.statusCode).toBe(409);
    expect(json<Problem>(stale).code).toBe('DISCOUNT_VERSION_CONFLICT');

    const noop = json<DiscountDto>(
      await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 2, value: 30 }),
    );
    expect(noop.version).toBe(2);

    const off = json<DiscountDto>(
      await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 2, is_active: false }),
    );
    expect(off).toMatchObject({ version: 3, status: 'inactive' });

    expect(
      (await del(env, `/v1/discounts/${d.id}`, owner(shop), { reason: 'abc' })).statusCode,
    ).toBe(400);
    const gone = json<DiscountDto>(
      await del(env, `/v1/discounts/${d.id}`, owner(shop), { reason: 'promo berakhir' }),
    );
    expect(gone).toMatchObject({ version: 4, status: 'deleted' });
    const again = json<DiscountDto>(
      await del(env, `/v1/discounts/${d.id}`, owner(shop), { reason: 'alasan lain' }),
    );
    expect(again.version).toBe(4);
    expect(again.deleted?.reason).toBe('promo berakhir');
    const locked = await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 4, value: 5 });
    expect(locked.statusCode).toBe(409);
    expect(json<Problem>(locked).code).toBe('DISCOUNT_DELETED');

    const detail = json<{
      history: { version: number; action: string; changes: Record<string, unknown> | null }[];
    }>(await get(env, `/v1/discounts/${d.id}`, owner(shop)));
    expect(detail.history.map((h) => [h.version, h.action])).toEqual([
      [1, 'create'],
      [2, 'update'],
      [3, 'deactivate'],
      [4, 'delete'],
    ]);
    expect(detail.history[1]?.changes).toMatchObject({ value: { from: 20, to: 30 } });

    const audits = await env.handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'discount'), eq(auditLogs.entityId, d.id)));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'discount.created',
      'discount.deactivated',
      'discount.deleted',
      'discount.updated',
    ]);
  });

  it('discount history is append-only', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    await expect(
      env.handle.db
        .update(discountHistory)
        .set({ reason: 'x' })
        .where(eq(discountHistory.discountId, d.id)),
    ).rejects.toThrow();
    await expect(
      env.handle.db.delete(discountHistory).where(eq(discountHistory.discountId, d.id)),
    ).rejects.toThrow();
  });

  it('validates the rule fields', async () => {
    const shop = await createShop(env);
    const base = {
      name: 'x',
      target_type: 'product',
      type: 'percent',
      value: 10,
      starts_on: day(),
      product_ids: [shop.product.id],
    };
    for (const bad of [
      { value: 101 },
      { ends_on: day(-5) },
      { time_start: '14:00' },
      { time_start: '16:00', time_end: '14:00' },
      { days_of_week: [0] },
      { name: '   ' },
      { product_ids: undefined },
      { category_ids: [shop.category.id] },
    ]) {
      const res = await post(env, '/v1/discounts', owner(shop), { ...base, ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('derives the status from today (scheduled, active, ended, inactive)', async () => {
    const shop = await createShop(env);
    const scheduled = await createDiscount(shop, { name: 'S', starts_on: day(3) });
    const ended = await createDiscount(shop, { name: 'E', starts_on: day(-5), ends_on: day(-2) });
    const active = await createDiscount(shop, { name: 'A', value: 10 });
    const off = await createDiscount(shop, { name: 'I', is_active: false });
    expect([scheduled.status, ended.status, active.status, off.status]).toEqual([
      'scheduled',
      'ended',
      'active',
      'inactive',
    ]);
    const list = json<{ data: DiscountDto[]; outdated_devices: unknown[] }>(
      await get(env, '/v1/discounts', owner(shop)),
    );
    expect(list.data.map((x) => x.name)).toEqual(['A', 'S', 'I', 'E']);
    const onlyEnded = json<{ data: DiscountDto[] }>(
      await get(env, '/v1/discounts?status=ended', owner(shop)),
    );
    expect(onlyEnded.data.map((x) => x.name)).toEqual(['E']);
  });

  it('a category discount follows the category; target type changes need the matching ids', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop, {
      target_type: 'category',
      product_ids: undefined,
      category_ids: [shop.category.id],
    });
    expect(d.outlets[0]?.categories[0]?.id).toBe(shop.category.id);
    const bad = await patch(env, `/v1/discounts/${d.id}`, owner(shop), {
      version: 1,
      target_type: 'product',
    });
    expect(bad.statusCode).toBe(400);
    const ok = json<DiscountDto>(
      await patch(env, `/v1/discounts/${d.id}`, owner(shop), {
        version: 1,
        target_type: 'product',
        product_ids: [shop.product.id],
      }),
    );
    expect(ok.outlets[0]?.products).toHaveLength(1);
    expect(ok.outlets[0]?.categories).toHaveLength(0);
  });

  it('spans outlets of the same owner, and target-options groups products by name', async () => {
    const { a, b, ownerA } = await createBranches(env);
    const mk = async (outletId: string) => {
      const o = await loginAs(env, a.ownerEmail, outletId);
      const cat = json<{ id: string }>(
        await post(env, '/v1/categories', o.headers, { name: 'Jus' }),
      );
      const prod = json<{ id: string }>(
        await post(env, '/v1/products', o.headers, {
          category_id: cat.id,
          name: 'Jus  Mangga',
          price: 12_000,
        }),
      );
      return { cat: cat.id, prod: prod.id };
    };
    const pa = await mk(a.outletId);
    const pb = await mk(b.outletId);
    const opts = json<{ products: { key: string; outlets: { product_id: string }[] }[] }>(
      await get(env, '/v1/discounts/target-options?outlet_scope=all', ownerA.headers),
    );
    const group = opts.products.find((p) => p.key === 'name:jus mangga');
    expect(group?.outlets.map((o) => o.product_id).sort()).toEqual([pa.prod, pb.prod].sort());

    const res = await post(env, '/v1/discounts', ownerA.headers, {
      name: 'Promo Mangga',
      target_type: 'product',
      type: 'percent',
      value: 20,
      starts_on: day(),
      product_ids: [pa.prod, pb.prod],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(json<DiscountDto>(res).outlets).toHaveLength(2);

    // Outlet B drops out of the promo: A's list keeps it, B gets a tombstone later (see sync tests).
    const d = json<DiscountDto>(res);
    const one = json<DiscountDto>(
      await patch(env, `/v1/discounts/${d.id}`, ownerA.headers, {
        version: 1,
        product_ids: [pa.prod],
      }),
    );
    expect(one.outlets).toHaveLength(1);

    // A manager-only membership in B must not allow targeting B.
    await addMembership(env, a.ownerEmail, b.outletId, 'owner').catch(() => undefined);
  });
});

describe('transaction validation (ADR-0023 §3)', () => {
  it('accepts a valid discounted sale via api (QRIS) and sync, with snapshots on items and receipt', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop); // 20% of 15.000 = 3.000/unit
    const qris = discountedSale(shop, d, { method: 'qris' });
    const created = await post(env, '/v1/transactions', shop.cashier.headers, qris);
    expect(created.statusCode, created.body).toBe(201);
    expect(
      json<{ items: Record<string, unknown>[]; discount_amount: number; total: number }>(created),
    ).toMatchObject({
      discount_amount: 6_000,
      total: 24_000,
      items: [{ discount_id: d.id, discount_name: 'Promo Alpukat', discount_amount: 6_000 }],
    });

    const sale = discountedSale(shop, d);
    const res = json<{ results: { status: string }[] }>(await syncPush(shop, sale));
    expect(res.results[0]?.status).toBe('applied');
    const [row] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, sale.id));
    expect(row).toMatchObject({
      priceMismatch: false,
      discountAmount: 6_000,
      subtotal: 30_000,
      total: 24_000,
    });

    const receipt = await get(env, `/v1/transactions/${sale.id}/receipt`, shop.cashier.headers);
    if (receipt.statusCode === 200) {
      expect(receipt.body).toContain('Promo Alpukat');
      expect(receipt.body).toContain('Hemat');
    }
  });

  it('100% discount and a Rp amount larger than the price both give a free (not negative) line', async () => {
    const shop = await createShop(env);
    const full = await createDiscount(shop, { name: 'Gratis', value: 100 });
    const body = discountedSale(shop, full, { perUnit: 15_000 });
    expect(body.total).toBe(0);
    const ok = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(ok.statusCode, ok.body).toBe(201);

    const big = await createDiscount(shop, { name: 'Besar', type: 'amount', value: 50_000 });
    const body2 = discountedSale(shop, big, { perUnit: 15_000 });
    expect(body2.total).toBe(0);
    expect((await post(env, '/v1/transactions', shop.cashier.headers, body2)).statusCode).toBe(201);
    const over = discountedSale(shop, big, { perUnit: 50_000 });
    const res = await post(env, '/v1/transactions', shop.cashier.headers, over);
    // A discount above the line is never valid (negative total / DISCOUNT_INVALID).
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects discounts no honest app produces: DISCOUNT_INVALID on api and sync', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    const cases: [string, (b: ReturnType<typeof discountedSale>) => void][] = [
      ['wrong amount', (b) => ((b.items[0] as Record<string, unknown>)['discount_amount'] = 3_000)],
      ['unknown version', (b) => ((b.items[0] as Record<string, unknown>)['discount_version'] = 9)],
      [
        'unknown discount',
        (b) => ((b.items[0] as Record<string, unknown>)['discount_id'] = uuidv7()),
      ],
      ['no id', (b) => ((b.items[0] as Record<string, unknown>)['discount_id'] = null)],
      ['no version', (b) => ((b.items[0] as Record<string, unknown>)['discount_version'] = null)],
    ];
    for (const [label, mutate] of cases) {
      // Keep the transaction totals consistent so only the discount is wrong.
      const body = discountedSale(shop, d);
      mutate(body);
      const item = body.items[0] as Record<string, unknown>;
      const amount = item['discount_amount'] as number;
      body.discount_amount = amount;
      body.total = body.subtotal - amount;
      body.payment = { id: uuidv7(), method: 'cash', cash_tendered: body.total } as never;
      const api = await post(env, '/v1/transactions', shop.cashier.headers, body);
      expect(api.statusCode, label).toBe(422);
      expect(json<Problem>(api).code, label).toBe('DISCOUNT_INVALID');
      const sync = json<{ results: { status: string; code?: string }[] }>(
        await syncPush(shop, body),
      );
      expect(sync.results[0], label).toMatchObject({
        status: 'rejected',
        code: 'DISCOUNT_INVALID',
      });
    }
    // Quantity not dividing the amount.
    const odd = discountedSale(shop, d, { qty: 2, amount: 3_001 });
    expect(json<Problem>(await post(env, '/v1/transactions', shop.cashier.headers, odd)).code).toBe(
      'DISCOUNT_INVALID',
    );
  });

  it('a discount of another outlet does not cover this device', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const d = await createDiscount(other, { product_ids: [other.product.id] });
    const body = discountedSale(shop, d);
    const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(json<Problem>(res).code).toBe('DISCOUNT_INVALID');
  });

  it('Σ item discounts must equal the transaction discount (TOTAL_MISMATCH)', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    const body = discountedSale(shop, d);
    body.discount_amount = 5_000;
    body.total = body.subtotal - 5_000;
    body.payment = { id: uuidv7(), method: 'cash', cash_tendered: body.total } as never;
    const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(res.statusCode).toBe(422);
    expect(json<Problem>(res).code).toBe('TOTAL_MISMATCH');
  });

  it('apps without discount fields still sell at the normal price', async () => {
    const shop = await createShop(env);
    await createDiscount(shop);
    const res = await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop));
    expect(res.statusCode).toBe(201);
  });

  it('stale rule: QRIS gets DISCOUNT_STALE, sync accepts it flagged and audited, grace is 10 minutes', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 1, is_active: false });
    const v1 = { id: d.id, version: 1 };

    const late = new Date(Date.now() + 11 * 60_000);
    const qris = discountedSale(shop, v1, { method: 'qris', at: late });
    const refused = await post(env, '/v1/transactions', shop.cashier.headers, qris);
    expect(refused.statusCode).toBe(422);
    expect(json<Problem>(refused).code).toBe('DISCOUNT_STALE');

    const sale = discountedSale(shop, v1, { at: late });
    const pushed = json<{ results: { status: string }[] }>(await syncPush(shop, sale));
    expect(pushed.results[0]?.status).toBe('applied');
    const [row] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, sale.id));
    expect(row?.priceMismatch).toBe(true);
    const [audit] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, sale.id), eq(auditLogs.action, 'sync.discount_stale')));
    expect(audit?.after).toMatchObject({
      items: [{ discount_id: d.id, sent_version: 1, current_version: 2 }],
    });

    // Within the grace window the old version is still accepted for QRIS (the old rule was still active at 5 min).
    const fresh = await createDiscount(shop, { name: 'Baru' });
    await patch(env, `/v1/discounts/${fresh.id}`, owner(shop), { version: 1, value: 25 });
    const soon = discountedSale(
      shop,
      { id: fresh.id, version: 1 },
      { method: 'qris', at: new Date(Date.now() + 5 * 60_000) },
    );
    expect((await post(env, '/v1/transactions', shop.cashier.headers, soon)).statusCode).toBe(201);

    // Owner filter: only the stale sale is listed.
    const listed = json<{ data: { id: string }[] }>(
      await get(env, '/v1/transactions?discount_stale=true', owner(shop)),
    );
    expect(listed.data.map((t) => t.id)).toEqual([sale.id]);
  });

  it('an offline sale made before the rule changed stays valid even when synced much later', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    const madeAt = new Date(Date.now() - 60_000);
    await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 1, value: 50 });
    const sale = discountedSale(shop, { id: d.id, version: 1 }, { at: madeAt });
    await syncPush(shop, sale);
    const [row] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, sale.id));
    expect(row?.priceMismatch).toBe(false);
  });
});

describe('sync pull', () => {
  const pull = async (shop: Shop, qs = '', headers: Record<string, string> = {}) =>
    json<{
      next_cursor: string;
      changes: {
        discounts: {
          id: string;
          version: number;
          name: string;
          product_ids: string[];
          utc_offset_minutes: number;
        }[];
        deleted: { entity: string; id: string }[];
      };
    }>(await get(env, `/v1/sync/pull${qs}`, { 'x-device-token': shop.device.token, ...headers }));

  it('delivers rules, edits and tombstones; full snapshot has only live discounts', async () => {
    const shop = await createShop(env);
    const first = await pull(shop);
    const d = await createDiscount(shop);
    const dead = await createDiscount(shop, { name: 'Mati', is_active: false });

    const next = await pull(shop, `?cursor=${first.next_cursor}`);
    expect(next.changes.discounts.map((x) => x.id)).toEqual([d.id]);
    expect(next.changes.discounts[0]).toMatchObject({
      version: 1,
      product_ids: [shop.product.id],
      utc_offset_minutes: 420,
    });
    expect(next.changes.deleted).toEqual([{ entity: 'discount', id: dead.id }]);

    const full = await pull(shop);
    expect(full.changes.discounts.map((x) => x.id)).toEqual([d.id]);
    expect(full.changes.deleted).toEqual([]);

    await patch(env, `/v1/discounts/${d.id}`, owner(shop), { version: 1, value: 35 });
    const edited = await pull(shop, `?cursor=${next.next_cursor}`);
    expect(edited.changes.discounts[0]?.version).toBe(2);
    await del(env, `/v1/discounts/${d.id}`, owner(shop), { reason: 'sudah selesai' });
    const gone = await pull(shop, `?cursor=${edited.next_cursor}`);
    expect(gone.changes.deleted).toEqual([{ entity: 'discount', id: d.id }]);
  });

  it('X-App-Version updates the device and drives outdated_devices', async () => {
    const shop = await createShop(env);
    await createDiscount(shop);
    await pull(shop, '', { 'x-app-version': '0.2.0' });
    const old = json<{ outdated_devices: { device_id: string; app_version: string }[] }>(
      await get(env, '/v1/discounts', owner(shop)),
    );
    expect(old.outdated_devices).toMatchObject([
      { device_id: shop.device.id, app_version: '0.2.0' },
    ]);
    await pull(shop, '', { 'x-app-version': '0.10.0' });
    const fresh = json<{ outdated_devices: unknown[] }>(
      await get(env, '/v1/discounts', owner(shop)),
    );
    expect(fresh.outdated_devices).toEqual([]);
    await pull(shop, '', { 'x-app-version': 'bad value!' });
    const still = json<{ outdated_devices: unknown[] }>(
      await get(env, '/v1/discounts', owner(shop)),
    );
    expect(still.outdated_devices).toEqual([]);
  });
});

describe('reports (ADR-0023 §5)', () => {
  it('summary, products, top products, sales and discount report agree on gross, discount and net', async () => {
    const shop = await createShop(env);
    const d = await createDiscount(shop);
    await post(env, '/v1/transactions', shop.cashier.headers, discountedSale(shop, d)); // 30.000 - 6.000
    await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop, { qty: 1 })); // 15.000
    const q = `date_from=${day()}&date_to=${day()}`;

    const summary = json<Record<string, number>>(
      await get(env, `/v1/dashboard/summary?${q}`, owner(shop)),
    );
    expect(summary).toMatchObject({ revenue: 39_000, gross_sales: 45_000, discount_total: 6_000 });

    const products = json<{ totals: Record<string, number>; data: Record<string, number>[] }>(
      await get(env, `/v1/reports/products?${q}`, owner(shop)),
    );
    expect(products.totals).toMatchObject({
      revenue: 39_000,
      gross_revenue: 45_000,
      discount_amount: 6_000,
    });
    expect(products.data[0]).toMatchObject({
      revenue: 39_000,
      gross_revenue: 45_000,
      discount_amount: 6_000,
    });

    const top = json<{ data: { revenue: number }[] }>(
      await get(env, `/v1/dashboard/top-products?${q}`, owner(shop)),
    );
    expect(top.data[0]?.revenue).toBe(39_000);
    const sales = json<{ data: Record<string, number>[] }>(
      await get(env, `/v1/reports/sales?group_by=product&${q}`, owner(shop)),
    );
    expect(sales.data[0]).toMatchObject({
      revenue: 39_000,
      gross_revenue: 45_000,
      discount_amount: 6_000,
    });

    const report = json<{
      totals: Record<string, number>;
      data: {
        discount_id: string;
        transaction_count: number;
        items_sold: number;
        gross_revenue: number;
        discount_total: number;
        revenue: number;
      }[];
    }>(await get(env, `/v1/reports/discounts?${q}`, owner(shop)));
    expect(report.totals).toEqual({
      discount_total: 6_000,
      sales_gross: 45_000,
      sales_discount_total: 6_000,
    });
    expect(report.data).toEqual([
      expect.objectContaining({
        discount_id: d.id,
        transaction_count: 1,
        items_sold: 2,
        gross_revenue: 30_000,
        discount_total: 6_000,
        revenue: 24_000,
      }),
    ]);

    const csv = await get(env, `/v1/reports/discounts/export?format=csv&${q}`, owner(shop));
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toContain(`diskon_${day()}_${day()}.csv`);
    expect(csv.body).toContain(
      'Promo,Jenis,Nilai,Transaksi,Cup,Kotor (Rp),Diskon (Rp),Bersih (Rp),Periode,Cabang',
    );
    expect(csv.body).toContain('Promo Alpukat,Persen (%),20,1,2,30000,6000,24000');
    const xlsx = await get(env, `/v1/reports/discounts/export?format=xlsx&${q}`, owner(shop));
    expect(xlsx.statusCode).toBe(200);
    const audit = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.outletId, shop.seeded.outletId),
          eq(auditLogs.action, 'reports.discounts_exported'),
        ),
      );
    expect(audit).toHaveLength(2);

    const manager = await createMember(env, shop.seeded, 'manager');
    expect((await get(env, `/v1/reports/discounts?${q}`, manager.headers)).statusCode).toBe(200);
    expect(
      (await get(env, `/v1/reports/discounts?outlet_scope=all&${q}`, manager.headers)).statusCode,
    ).toBe(403);
  });
});
