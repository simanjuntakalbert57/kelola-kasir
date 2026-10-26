import { and, count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, shifts, transactions } from '../src/db/schema.js';
import {
  bearer,
  createEmployee,
  createShop,
  first as head,
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

interface Mutation {
  id: string;
  type: string;
  client_created_at: string;
  employee_id?: string;
  payload: Record<string, unknown>;
}
interface PushResult {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  code?: string;
  detail?: string;
}
interface Pull {
  next_cursor: string;
  has_more: boolean;
  changes: {
    categories: { id: string; name: string }[];
    products: { id: string; name: string; price: number; is_sold_out: boolean }[];
    employees: { id: string; name: string; is_active: boolean; pin_hash: string | null }[];
    settings: { display_name: string; receipt_footer: string | null } | null;
    deleted: { entity: string; id: string }[];
  };
  current_shift: { id: string } | null;
  device_revoked: boolean;
  last_number: string | null;
}

const deviceHeaders = (shop: Shop) => ({ 'x-device-token': shop.device.token });
const pull = async (shop: Shop, qs = '') => {
  const res = await get(env, `/v1/sync/pull${qs}`, deviceHeaders(shop));
  expect(res.statusCode, res.body).toBe(200);
  return json<Pull>(res);
};
const push = async (shop: Shop, mutations: Mutation[]) => {
  const res = await post(env, '/v1/sync/push', deviceHeaders(shop), { mutations });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ results: PushResult[] }>(res).results;
};

function txMutation(
  shop: Shop,
  o: Parameters<typeof txBody>[2] = {},
  employeeId?: string,
): Mutation {
  const body = txBody(env, shop, o);
  return {
    id: body.id,
    type: 'transaction.create',
    client_created_at: body.client_created_at,
    employee_id: employeeId ?? shop.cashier.employeeId,
    payload: body,
  };
}

const countTx = async (id: string) =>
  (await env.handle.db.select({ n: count() }).from(transactions).where(eq(transactions.id, id)))[0]
    ?.n;
const audits = async (shop: Shop, action: string) =>
  env.handle.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, action)));

describe('sync pull', () => {
  it('returns a full snapshot without a cursor', async () => {
    const shop = await createShop(env);
    const res = await pull(shop);
    expect(res.has_more).toBe(false);
    expect(res.device_revoked).toBe(false);
    expect(res.changes.categories.map((c) => c.name)).toEqual(['Jus Buah']);
    expect(res.changes.products.map((p) => p.name)).toEqual(['Jus Alpukat']);
    expect(res.changes.employees.map((e) => e.id)).toEqual([shop.cashier.employeeId]);
    expect(res.changes.settings).toMatchObject({ display_name: expect.any(String) });
    expect(res.changes.deleted).toEqual([]);
    expect(res.current_shift?.id).toBe(shop.shiftId);
    expect(res.last_number).toBeNull();
    expect(typeof res.next_cursor).toBe('string');
  });

  it('then only returns what changed since the cursor', async () => {
    const shop = await createShop(env);
    const first = await pull(shop);
    const idle = await pull(shop, `?cursor=${first.next_cursor}`);
    expect(idle.changes).toEqual({
      categories: [],
      products: [],
      employees: [],
      settings: null,
      deleted: [],
    });
    expect(idle.next_cursor).toBe(first.next_cursor);

    await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), { price: 16_500 });
    const changed = await pull(shop, `?cursor=${first.next_cursor}`);
    expect(changed.changes.products).toMatchObject([{ id: shop.product.id, price: 16_500 }]);
    expect(changed.changes.categories).toEqual([]);
    expect(changed.next_cursor).not.toBe(first.next_cursor);
  });

  it('delivers deletions as tombstones and omits them from a fresh snapshot', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const start = await pull(shop);
    const cat2 = json<{ id: string }>(
      await post(env, '/v1/categories', owner, { name: 'Sementara' }),
    );
    await env.app.inject({ method: 'DELETE', url: `/v1/categories/${cat2.id}`, headers: owner });
    await env.app.inject({
      method: 'DELETE',
      url: `/v1/products/${shop.product.id}`,
      headers: owner,
    });

    const delta = await pull(shop, `?cursor=${start.next_cursor}`);
    expect(delta.changes.deleted).toEqual(
      expect.arrayContaining([
        { entity: 'category', id: cat2.id },
        { entity: 'product', id: shop.product.id },
      ]),
    );
    expect(delta.changes.products).toEqual([]);
    const fresh = await pull(shop);
    expect(fresh.changes.deleted).toEqual([]);
    expect(fresh.changes.products).toEqual([]);
    expect(fresh.changes.categories.map((c) => c.id)).not.toContain(cat2.id);
  });

  it('carries sold-out flags and store settings (receipt footer)', async () => {
    const shop = await createShop(env);
    const start = await pull(shop);
    await patch(env, `/v1/products/${shop.product.id}/availability`, shop.cashier.headers, {
      is_sold_out: true,
    });
    await patch(env, '/v1/settings', bearer(shop.ownerToken), { receipt_footer: 'Dadah!' });
    const delta = await pull(shop, `?cursor=${start.next_cursor}`);
    expect(delta.changes.products[0]).toMatchObject({ id: shop.product.id, is_sold_out: true });
    expect(delta.changes.settings).toMatchObject({ receipt_footer: 'Dadah!' });
  });

  it('pages through changes exactly once with limit and has_more', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const start = await pull(shop);
    const expected = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const p = json<{ id: string }>(
        await post(env, '/v1/products', owner, {
          category_id: shop.category.id,
          name: `Produk ${i}`,
          price: 1000 + i,
        }),
      );
      expected.add(p.id);
    }
    const seen: string[] = [];
    let cursor = start.next_cursor;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await pull(shop, `?cursor=${cursor}&limit=2`);
      seen.push(...page.changes.products.map((p) => p.id));
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(expected);
  });

  it('sends PIN hashes only when offline login is enabled, and only for active employees', async () => {
    const shop = await createShop(env);
    const owner = bearer(shop.ownerToken);
    const gone = await createEmployee(env, shop.ownerToken, 'Resign');
    await patch(env, `/v1/employees/${gone.id}`, owner, { is_active: false });

    const before = await pull(shop);
    expect(before.changes.employees.every((e) => e.pin_hash === null)).toBe(true);

    await patch(env, '/v1/settings', owner, { offline_login_enabled: true });
    const after = await pull(shop, `?cursor=${before.next_cursor}`);
    const byId = new Map(after.changes.employees.map((e) => [e.id, e]));
    expect(byId.get(shop.cashier.employeeId)?.pin_hash).toMatch(/^\$argon2id\$/);
    expect(byId.get(gone.id)).toMatchObject({ is_active: false, pin_hash: null });

    const cursor = after.next_cursor;
    await patch(env, '/v1/settings', owner, { offline_login_enabled: false });
    const off = await pull(shop, `?cursor=${cursor}`);
    expect(off.changes.employees.every((e) => e.pin_hash === null)).toBe(true);
    expect(off.changes.employees.length).toBeGreaterThan(0);
  });

  it('reports the running shift and the last transaction number of the device', async () => {
    const shop = await createShop(env);
    const a = txMutation(shop);
    const b = txMutation(shop);
    await push(shop, [a, b]);
    const res = await pull(shop);
    expect(res.current_shift?.id).toBe(shop.shiftId);
    expect(res.last_number).toBe(
      [a.payload['number'] as string, b.payload['number'] as string].sort().at(-1),
    );
    await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 0,
      closed_at: env.clock.now.toISOString(),
    });
    expect((await pull(shop)).current_shift).toBeNull();
  });

  it('is scoped to the outlet of the device and needs a device token', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const res = await pull(other);
    expect(res.changes.products.map((p) => p.id)).not.toContain(shop.product.id);
    expect((await get(env, '/v1/sync/pull', {})).statusCode).toBe(401);
    expect((await get(env, '/v1/sync/pull', bearer(shop.ownerToken))).statusCode).toBe(401);
    expect((await get(env, '/v1/sync/pull?cursor=%21%21', deviceHeaders(shop))).statusCode).toBe(
      400,
    );
    expect((await get(env, '/v1/sync/pull?limit=501', deviceHeaders(shop))).statusCode).toBe(400);
  });

  it('turns a revoked device away', async () => {
    const shop = await createShop(env);
    const revoke = await post(
      env,
      `/v1/devices/${shop.device.id}/revoke`,
      bearer(shop.ownerToken),
      {},
    );
    expect(revoke.statusCode).toBe(200);
    const res = await get(env, '/v1/sync/pull', deviceHeaders(shop));
    expect(res.statusCode).toBe(401);
    expect(json(res)).toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(
      (await post(env, '/v1/sync/push', deviceHeaders(shop), { mutations: [] })).statusCode,
    ).toBe(401);
  });
});

describe('sync push: transactions', () => {
  it('applies a queued cash sale', async () => {
    const shop = await createShop(env);
    const m = txMutation(shop, { qty: 2 });
    const [result] = await push(shop, [m]);
    expect(result).toEqual({ id: m.id, status: 'applied' });
    const res = await get(env, `/v1/transactions/${m.id}`, shop.cashier.headers);
    expect(json<{ status: string; total: number; employee: { id: string } }>(res)).toMatchObject({
      status: 'paid',
      total: 30_000,
      employee: { id: shop.cashier.employeeId },
    });
  });

  it('pushing the same transaction twice creates no duplicate', async () => {
    const shop = await createShop(env);
    const m = txMutation(shop);
    expect((await push(shop, [m]))[0]?.status).toBe('applied');
    expect((await push(shop, [m]))[0]).toEqual({ id: m.id, status: 'duplicate' });
    expect(await countTx(m.id)).toBe(1);
    // Also within one batch, and mixed with the online endpoint.
    const n = txMutation(shop);
    const results = await push(shop, [n, n]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'duplicate']);
    expect((await post(env, '/v1/transactions', shop.cashier.headers, n.payload)).statusCode).toBe(
      200,
    );
    expect(await countTx(n.id)).toBe(1);
    const summary = json<{ transaction_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, shop.cashier.headers),
    );
    expect(summary.transaction_count).toBe(2);
  });

  it('survives concurrent pushes of the same batch', async () => {
    const shop = await createShop(env);
    const batch = [txMutation(shop), txMutation(shop), txMutation(shop)];
    const runs = await Promise.all([1, 2, 3, 4].map(() => push(shop, batch)));
    for (const [i, m] of batch.entries()) {
      const statuses = runs.map((r) => r[i]?.status);
      expect(statuses.filter((s) => s === 'applied')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(3);
      expect(await countTx(m.id)).toBe(1);
    }
  });

  it('rejects one bad mutation without stopping the rest of the batch', async () => {
    const shop = await createShop(env);
    const good1 = txMutation(shop);
    const bad = txMutation(shop);
    head(bad.payload['items'] as { line_total: number }[]).line_total += 1;
    const good2 = txMutation(shop);
    const results = await push(shop, [good1, bad, good2]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected', 'applied']);
    expect(results[1]).toMatchObject({ id: bad.id, code: 'TOTAL_MISMATCH' });
    expect(await countTx(bad.id)).toBe(0);
    expect(await countTx(good2.id)).toBe(1);
  });

  it('accepts real sales at an old price or for sold-out products, flagging them', async () => {
    const shop = await createShop(env);
    await patch(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken), { price: 17_000 });
    await patch(env, `/v1/products/${shop.product.id}/availability`, bearer(shop.ownerToken), {
      is_sold_out: true,
    });
    const m = txMutation(shop, { unitPrice: 15_000 });
    expect((await push(shop, [m]))[0]?.status).toBe('applied');
    const tx = json<{ price_mismatch: boolean; total: number }>(
      await get(env, `/v1/transactions/${m.id}`, shop.cashier.headers),
    );
    expect(tx).toMatchObject({ price_mismatch: true, total: 30_000 });
    expect(await audits(shop, 'sync.price_mismatch')).toHaveLength(1);
    expect(await audits(shop, 'sync.product_unavailable')).toHaveLength(1);
  });

  it('does not flag an old sale as clock skew merely for arriving late', async () => {
    const shop = await createShop(env);
    const yesterday = new Date(env.clock.now.getTime() - 20 * 3600_000);
    expect((await push(shop, [txMutation(shop, { createdAt: yesterday })]))[0]?.status).toBe(
      'applied',
    );
    expect(await audits(shop, 'transaction.clock_skew')).toHaveLength(0);
    const ahead = new Date(env.clock.now.getTime() + 30 * 60_000);
    await push(shop, [txMutation(shop, { createdAt: ahead })]);
    expect(await audits(shop, 'transaction.clock_skew')).toHaveLength(1);
  });

  it('refuses QRIS (online only), unknown products, wrong employees and bad ids', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const qris = txMutation(shop, { method: 'qris' });
    const unknown = txMutation(shop);
    head(unknown.payload['items'] as { product_id: string }[]).product_id = uuidv7();
    const foreignEmployee = txMutation(shop, {}, other.cashier.employeeId);
    const noEmployee = txMutation(shop);
    delete noEmployee.employee_id;
    const mismatch = txMutation(shop);
    mismatch.id = uuidv7();
    const duplicateNumber = txMutation(shop);
    const first = txMutation(shop);
    duplicateNumber.payload['number'] = first.payload['number'];
    const malformed: Mutation = { ...txMutation(shop), payload: { id: uuidv7() } };

    const results = await push(shop, [
      qris,
      unknown,
      foreignEmployee,
      noEmployee,
      mismatch,
      first,
      duplicateNumber,
      malformed,
    ]);
    expect(results.map((r) => r.code ?? r.status)).toEqual([
      'QRIS_NOT_SYNCABLE',
      'PRODUCT_UNAVAILABLE',
      'EMPLOYEE_UNKNOWN',
      'EMPLOYEE_REQUIRED',
      'ID_MISMATCH',
      'applied',
      'NUMBER_CONFLICT',
      'VALIDATION_ERROR',
    ]);
    expect(await countTx(qris.id)).toBe(0);
  });
});

describe('sync push: sales around a shift close', () => {
  it('keeps a late-arriving sale made before the close in the shift and recomputes expected cash', async () => {
    const shop = await createShop(env);
    env.clock.advance(20 * 60_000); // the shift has been open for a while
    const soldAt = new Date(env.clock.now.getTime() - 5 * 60_000);
    const closeAt = env.clock.now;
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: closeAt.toISOString(),
    });
    expect(closed.statusCode).toBe(200);
    expect(json<{ expected_cash: number }>(closed).expected_cash).toBe(100_000);

    const m = txMutation(shop, { qty: 2, createdAt: soldAt }); // Rp30.000, offline until now
    expect((await push(shop, [m]))[0]?.status).toBe('applied');
    const [row] = await env.handle.db.select().from(shifts).where(eq(shifts.id, shop.shiftId));
    expect(row?.expectedCash).toBe(130_000);
    expect(row?.cashDifference).toBe(-30_000);
    expect(row?.totalCashSales).toBe(30_000);
    const tx = json<{ after_shift_close: boolean }>(
      await get(env, `/v1/transactions/${m.id}`, bearer(shop.ownerToken)),
    );
    expect(tx.after_shift_close).toBe(false);
    expect(await audits(shop, 'shift.totals_recomputed')).toHaveLength(1);
  });

  it('accepts a sale created after the close but flags it as late, outside expected cash', async () => {
    const shop = await createShop(env);
    env.clock.advance(20 * 60_000);
    const closeAt = new Date(env.clock.now.getTime() - 10 * 60_000);
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: closeAt.toISOString(),
    });
    expect(closed.statusCode).toBe(200);
    const m = txMutation(shop, { createdAt: env.clock.now });
    expect((await push(shop, [m]))[0]?.status).toBe('applied');
    const tx = json<{ after_shift_close: boolean }>(
      await get(env, `/v1/transactions/${m.id}`, bearer(shop.ownerToken)),
    );
    expect(tx.after_shift_close).toBe(true);
    const summary = json<{
      expected_cash: number;
      late_transaction_count: number;
      late_cash_amount: number;
    }>(await get(env, `/v1/shifts/${shop.shiftId}/summary`, bearer(shop.ownerToken)));
    expect(summary).toMatchObject({
      expected_cash: 100_000,
      late_transaction_count: 1,
      late_cash_amount: 30_000,
    });
  });
});

describe('sync push: shift.close', () => {
  const closeMutation = (shop: Shop, extra: Record<string, unknown> = {}): Mutation => ({
    id: shop.shiftId,
    type: 'shift.close',
    client_created_at: env.clock.now.toISOString(),
    employee_id: shop.cashier.employeeId,
    payload: {
      shift_id: shop.shiftId,
      actual_cash: 145_000,
      closed_at: env.clock.now.toISOString(),
      closed_offline: true,
      unsynced_count: 2,
      ...extra,
    },
  });

  it('closes the shift after the queued sales were applied, and replays as duplicate', async () => {
    const shop = await createShop(env);
    const sale = txMutation(shop, { qty: 3 }); // Rp45.000 cash
    const close = closeMutation(shop);
    const results = await push(shop, [sale, close]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const [row] = await env.handle.db.select().from(shifts).where(eq(shifts.id, shop.shiftId));
    expect(row).toMatchObject({
      status: 'closed',
      expectedCash: 145_000,
      actualCash: 145_000,
      cashDifference: 0,
      closedOffline: true,
      unsyncedCount: 2,
      closedBy: shop.cashier.employeeId,
      closedDeviceId: shop.device.id,
    });
    expect((await push(shop, [close]))[0]).toEqual({ id: shop.shiftId, status: 'duplicate' });
    expect(await audits(shop, 'shift.closed_offline')).toHaveLength(1);
  });

  it('rejects a conflicting second close, a mismatching id and a pending QRIS sale', async () => {
    const shop = await createShop(env);
    const pending = await post(
      env,
      '/v1/transactions',
      shop.cashier.headers,
      txBody(env, shop, { method: 'qris' }),
    );
    expect(pending.statusCode).toBe(201);
    const blocked = (await push(shop, [closeMutation(shop)]))[0];
    expect(blocked).toMatchObject({ status: 'rejected', code: 'PENDING_QRIS_EXISTS' });

    const bad = closeMutation(shop);
    bad.id = uuidv7();
    expect((await push(shop, [bad]))[0]).toMatchObject({ status: 'rejected', code: 'ID_MISMATCH' });

    const paymentId = json<{ payments: { id: string }[] }>(pending).payments[0]?.id ?? '';
    await post(env, `/v1/payments/${paymentId}/cancel`, shop.cashier.headers, {});
    expect((await push(shop, [closeMutation(shop)]))[0]?.status).toBe('applied');
    const again = closeMutation(shop, { actual_cash: 1 });
    expect((await push(shop, [again]))[0]).toMatchObject({
      status: 'rejected',
      code: 'SHIFT_CLOSED',
    });
  });

  it('refuses another outlet shift and requires the employee', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const foreign = closeMutation(other);
    expect((await push(shop, [foreign]))[0]).toMatchObject({
      status: 'rejected',
      code: 'NOT_FOUND',
    });
    const noEmployee = closeMutation(shop);
    delete noEmployee.employee_id;
    expect((await push(shop, [noEmployee]))[0]).toMatchObject({
      status: 'rejected',
      code: 'EMPLOYEE_REQUIRED',
    });
  });
});

describe('sync push: other mutations and envelope', () => {
  it('applies product.mark_sold_out idempotently', async () => {
    const shop = await createShop(env);
    const m: Mutation = {
      id: uuidv7(),
      type: 'product.mark_sold_out',
      client_created_at: env.clock.now.toISOString(),
      employee_id: shop.cashier.employeeId,
      payload: { product_id: shop.product.id, is_sold_out: true },
    };
    expect((await push(shop, [m]))[0]?.status).toBe('applied');
    expect((await push(shop, [m]))[0]?.status).toBe('duplicate');
    const product = json<{ is_sold_out: boolean }>(
      await get(env, `/v1/products/${shop.product.id}`, bearer(shop.ownerToken)),
    );
    expect(product.is_sold_out).toBe(true);
    const missing = { ...m, id: uuidv7(), payload: { product_id: uuidv7(), is_sold_out: true } };
    expect((await push(shop, [missing]))[0]).toMatchObject({
      status: 'rejected',
      code: 'NOT_FOUND',
    });
    const invalid = { ...m, id: uuidv7(), payload: { product_id: 'x' } };
    expect((await push(shop, [invalid]))[0]).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an invalid void request and unknown types per mutation', async () => {
    const shop = await createShop(env);
    const base = {
      client_created_at: env.clock.now.toISOString(),
      employee_id: shop.cashier.employeeId,
      payload: {},
    };
    const results = await push(shop, [
      { ...base, id: uuidv7(), type: 'void_request.create' },
      { ...base, id: uuidv7(), type: 'teleport' },
    ]);
    expect(results.map((r) => r.code)).toEqual(['VALIDATION_ERROR', 'UNKNOWN_MUTATION']);
  });

  it('validates the envelope: 1..50 mutations, authentication', async () => {
    const shop = await createShop(env);
    const many = Array.from({ length: 51 }, () => txMutation(shop));
    expect(
      (await post(env, '/v1/sync/push', deviceHeaders(shop), { mutations: many })).statusCode,
    ).toBe(400);
    expect(
      (await post(env, '/v1/sync/push', deviceHeaders(shop), { mutations: [] })).statusCode,
    ).toBe(400);
    expect((await post(env, '/v1/sync/push', deviceHeaders(shop), {})).statusCode).toBe(400);
    expect(
      (await post(env, '/v1/sync/push', {}, { mutations: [txMutation(shop)] })).statusCode,
    ).toBe(401);
    expect(
      (await post(env, '/v1/sync/push', shop.cashier.headers, { mutations: [] })).statusCode,
    ).toBe(400);
    const fifty = Array.from({ length: 50 }, () => txMutation(shop, { qty: 1 }));
    const results = await push(shop, fifty);
    expect(results.every((r) => r.status === 'applied')).toBe(true);
  });
});
