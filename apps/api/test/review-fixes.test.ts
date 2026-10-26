import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, payments, transactions } from '../src/db/schema.js';
import {
  bearer,
  createShop,
  createTestEnv,
  get,
  json,
  patch,
  post,
  txBody,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

describe('same id, different content is not a duplicate', () => {
  it('rejects a changed total online with ID_REUSED and keeps the first sale', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop, { qty: 2 });
    expect((await post(env, '/v1/transactions', shop.cashier.headers, body)).statusCode).toBe(201);

    const replay = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(replay.statusCode).toBe(200);

    const changed = txBody(env, shop, { qty: 3 });
    const res = await post(env, '/v1/transactions', shop.cashier.headers, {
      ...changed,
      id: body.id,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'ID_REUSED' });
    const [row] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, body.id));
    expect(row?.total).toBe(30_000);
  });

  it('rejects a changed number, and reports it per mutation when synced', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    await post(env, '/v1/transactions', shop.cashier.headers, body);
    const other = txBody(env, shop);
    const res = await post(env, '/v1/transactions', shop.cashier.headers, {
      ...body,
      number: other.number,
    });
    expect(json(res)).toMatchObject({ code: 'ID_REUSED' });

    const sync = await post(
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
            payload: { ...txBody(env, shop, { qty: 5 }), id: body.id },
          },
        ],
      },
    );
    expect(json<{ results: unknown[] }>(sync).results).toEqual([
      expect.objectContaining({ id: body.id, status: 'rejected', code: 'ID_REUSED' }),
    ]);
  });
});

describe('closing a shift with an overdue QRIS', () => {
  it('expires the QRIS past 15 minutes instead of answering PENDING_QRIS_EXISTS', async () => {
    const shop = await createShop(env);
    const qris = txBody(env, shop, { method: 'qris' });
    expect((await post(env, '/v1/transactions', shop.cashier.headers, qris)).statusCode).toBe(201);

    // Still within 15 minutes: the pending QRIS keeps blocking the close.
    env.clock.advance(14 * 60_000);
    const early = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(early.statusCode).toBe(409);
    expect(json(early)).toMatchObject({ code: 'PENDING_QRIS_EXISTS' });

    env.clock.advance(2 * 60_000);
    const res = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 100_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(res.statusCode, res.body).toBe(200);
    const [tx] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, qris.id));
    expect(tx?.status).toBe('cancelled');
    const [pay] = await env.handle.db
      .select()
      .from(payments)
      .where(eq(payments.id, qris.payment.id));
    expect(pay?.status).toBe('expired');
    const logs = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.outletId, shop.seeded.outletId),
          eq(auditLogs.action, 'payment.qris_expired'),
        ),
      );
    expect(logs).toHaveLength(1);
  });
});

describe('sync from a deactivated employee', () => {
  it('keeps the sale and flags it in the audit log', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    const off = await patch(
      env,
      `/v1/employees/${shop.cashier.employeeId}`,
      bearer(shop.ownerToken),
      {
        is_active: false,
      },
    );
    expect(off.statusCode, off.body).toBe(200);

    const res = await post(
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
    expect(json<{ results: { status: string }[] }>(res).results[0]?.status).toBe('applied');
    const [log] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, body.id), eq(auditLogs.action, 'sync.inactive_employee')));
    expect(log).toMatchObject({
      actorType: 'employee',
      actorId: shop.cashier.employeeId,
      after: { employee_id: shop.cashier.employeeId },
    });
    const detail = await get(env, `/v1/transactions/${body.id}`, bearer(shop.ownerToken));
    expect(detail.statusCode).toBe(200);
  });
});
