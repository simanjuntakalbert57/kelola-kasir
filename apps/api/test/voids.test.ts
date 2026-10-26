import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, transactions, voidRequests } from '../src/db/schema.js';
import { OWNER_PIN_MAX_FAILURES } from '../src/modules/voids/routes.js';
import {
  bearer,
  createShop,
  createTestEnv,
  first,
  get,
  json,
  nextPin,
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

interface VoidDto {
  id: string;
  transaction_id: string;
  transaction_number: string;
  transaction_total: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: { id: string; name: string };
  decided_by: string | null;
  decision_channel: 'dashboard' | 'device_pin' | null;
  decision_note: string | null;
  decided_at: string | null;
}
interface TxDto {
  id: string;
  status: string;
  void_request: VoidDto | null;
}

const owner = (shop: Shop) => bearer(shop.ownerToken);

async function sale(shop: Shop, qty = 2): Promise<string> {
  const body = txBody(env, shop, { qty });
  const res = await post(env, '/v1/transactions', shop.cashier.headers, body);
  expect(res.statusCode, res.body).toBe(201);
  return body.id;
}
const requestVoid = (
  shop: Shop,
  id: string,
  body: Record<string, unknown> = { reason: 'Salah input pesanan' },
) => post(env, `/v1/transactions/${id}/void-requests`, shop.cashier.headers, body);
const statusOf = async (shop: Shop, id: string) =>
  json<TxDto>(await get(env, `/v1/transactions/${id}`, owner(shop)));
const audits = (shop: Shop, action: string) =>
  env.handle.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, action)));
const revenue = async (shop: Shop) =>
  json<{ revenue: number }>(await get(env, '/v1/dashboard/summary', owner(shop))).revenue;

describe('employee requests a void', () => {
  it('moves the sale to void_requested, keeps counting it and audits who, why and when', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const res = await requestVoid(shop, id, { reason: '  Pelanggan batal  ' });
    expect(res.statusCode, res.body).toBe(201);
    const dto = json<VoidDto>(res);
    expect(dto).toMatchObject({
      transaction_id: id,
      transaction_total: 30_000,
      reason: 'Pelanggan batal',
      status: 'pending',
      requested_by: { id: shop.cashier.employeeId },
      decided_by: null,
    });

    const detail = await statusOf(shop, id);
    expect(detail.status).toBe('void_requested');
    expect(detail.void_request?.id).toBe(dto.id);
    // A pending void still counts until the owner decides (TDD §3.3).
    expect(await revenue(shop)).toBe(30_000);

    const [log] = await audits(shop, 'transaction.void_requested');
    expect(log).toMatchObject({
      actorType: 'employee',
      actorId: shop.cashier.employeeId,
      entityId: id,
      before: { status: 'paid' },
      after: { status: 'void_requested', reason: 'Pelanggan batal' },
    });
    expect(log?.meta).toMatchObject({ void_request_id: dto.id, source: 'api', total: 30_000 });
    expect(log?.createdAt).toBeInstanceOf(Date);
  });

  it('is idempotent on the request id and refuses a second request', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const requestId = uuidv7();
    const a = await requestVoid(shop, id, { id: requestId, reason: 'Salah input' });
    const b = await requestVoid(shop, id, { id: requestId, reason: 'Salah input' });
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(json<VoidDto>(b).id).toBe(requestId);
    expect(
      (await audits(shop, 'transaction.void_requested')).filter((l) => l.entityId === id),
    ).toHaveLength(1);

    const other = await requestVoid(shop, id, { reason: 'Coba lagi' });
    expect(other.statusCode).toBe(409);
    expect(json(other)).toMatchObject({ code: 'TRANSACTION_NOT_VOIDABLE' });
  });

  it('validates the reason and the transaction', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    expect((await requestVoid(shop, id, {})).statusCode).toBe(400);
    expect((await requestVoid(shop, id, { reason: 'x' })).statusCode).toBe(400);
    expect((await requestVoid(shop, id, { reason: 'a'.repeat(301) })).statusCode).toBe(400);
    expect((await requestVoid(shop, uuidv7())).statusCode).toBe(404);
    const qris = txBody(env, shop, { method: 'qris' });
    await post(env, '/v1/transactions', shop.cashier.headers, qris);
    const pending = await requestVoid(shop, qris.id);
    expect(pending.statusCode).toBe(409);
    expect(json(pending)).toMatchObject({ code: 'TRANSACTION_NOT_VOIDABLE' });
  });

  it('cannot touch another outlet', async () => {
    const a = await createShop(env);
    const b = await createShop(env);
    const id = await sale(a);
    expect((await requestVoid(b, id)).statusCode).toBe(404);
  });
});

describe('owner decides on the dashboard', () => {
  it('approves: transaction voided, out of the revenue, audited with actor, reason and time', async () => {
    const shop = await createShop(env);
    const keep = await sale(shop, 1);
    const id = await sale(shop, 2);
    expect(await revenue(shop)).toBe(45_000);
    const requested = json<VoidDto>(await requestVoid(shop, id, { reason: 'Salah menu' }));

    const res = await post(env, `/v1/void-requests/${requested.id}/approve`, owner(shop), {
      note: ' OK ',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<VoidDto>(res)).toMatchObject({
      status: 'approved',
      decision_channel: 'dashboard',
      decision_note: 'OK',
    });
    expect(json<VoidDto>(res).decided_by).toBeTruthy();
    expect((await statusOf(shop, id)).status).toBe('voided');
    expect((await statusOf(shop, keep)).status).toBe('paid');
    expect(await revenue(shop)).toBe(15_000);

    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, id));
    expect(row?.voidedAt).toBeInstanceOf(Date);
    const [log] = await audits(shop, 'transaction.void_approved');
    expect(log).toMatchObject({
      actorType: 'user',
      entityId: id,
      before: { status: 'void_requested' },
      after: { status: 'voided', note: 'OK' },
    });
    expect(log?.actorId).toBe(json<VoidDto>(res).decided_by);
    expect(log?.meta).toMatchObject({
      reason: 'Salah menu',
      requested_by: shop.cashier.employeeId,
      channel: 'dashboard',
    });
    expect((log?.meta as { decided_at: string }).decided_at).toBeTruthy();
  });

  it('rejects: the sale is paid again and counted', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const requested = json<VoidDto>(await requestVoid(shop, id));
    const res = await post(env, `/v1/void-requests/${requested.id}/reject`, owner(shop), {
      note: 'Tidak valid',
    });
    expect(json<VoidDto>(res)).toMatchObject({ status: 'rejected', decision_note: 'Tidak valid' });
    expect((await statusOf(shop, id)).status).toBe('paid');
    expect(await revenue(shop)).toBe(30_000);
    expect(await audits(shop, 'transaction.void_rejected')).toHaveLength(1);
    // A rejected sale can be voided again with a new request.
    expect((await requestVoid(shop, id, { reason: 'Benar-benar salah' })).statusCode).toBe(201);
  });

  it('replays the same decision and refuses the opposite one', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const requested = json<VoidDto>(await requestVoid(shop, id));
    const approve = () => post(env, `/v1/void-requests/${requested.id}/approve`, owner(shop), {});
    expect((await approve()).statusCode).toBe(200);
    expect((await approve()).statusCode).toBe(200);
    expect(await audits(shop, 'transaction.void_approved')).toHaveLength(1);
    const reject = await post(env, `/v1/void-requests/${requested.id}/reject`, owner(shop), {});
    expect(reject.statusCode).toBe(409);
    expect(json(reject)).toMatchObject({ code: 'VOID_ALREADY_DECIDED' });
  });

  it('lists requests by status with pagination, owner only', async () => {
    const shop = await createShop(env);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await sale(shop, 1);
      ids.push(json<VoidDto>(await requestVoid(shop, id)).id);
    }
    await post(env, `/v1/void-requests/${first(ids)}/approve`, owner(shop), {});
    const pending = json<{ data: VoidDto[]; next_cursor: string | null }>(
      await get(env, '/v1/void-requests?status=pending', owner(shop)),
    );
    expect(pending.data).toHaveLength(2);
    expect(pending.data.every((v) => v.status === 'pending' && v.transaction_number)).toBe(true);

    const page1 = json<{ data: VoidDto[]; next_cursor: string | null }>(
      await get(env, '/v1/void-requests?limit=2', owner(shop)),
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();
    const page2 = json<{ data: VoidDto[]; next_cursor: string | null }>(
      await get(env, `/v1/void-requests?limit=2&cursor=${page1.next_cursor}`, owner(shop)),
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.next_cursor).toBeNull();
    expect(new Set([...page1.data, ...page2.data].map((v) => v.id)).size).toBe(3);

    expect((await get(env, '/v1/void-requests', shop.cashier.headers)).statusCode).toBe(403);
    expect(
      (await post(env, `/v1/void-requests/${first(ids)}/approve`, shop.cashier.headers, {}))
        .statusCode,
    ).toBe(403);
    expect((await get(env, '/v1/void-requests?cursor=nope', owner(shop))).statusCode).toBe(400);
  });

  it('hides other outlets', async () => {
    const a = await createShop(env);
    const b = await createShop(env);
    const requested = json<VoidDto>(await requestVoid(a, await sale(a)));
    expect(
      (await post(env, `/v1/void-requests/${requested.id}/approve`, owner(b), {})).statusCode,
    ).toBe(404);
    expect(json<{ data: unknown[] }>(await get(env, '/v1/void-requests', owner(b))).data).toEqual(
      [],
    );
  });
});

describe('owner voids directly', () => {
  it('voids a paid sale at once with the reason in the audit log', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const res = await post(env, `/v1/transactions/${id}/void-requests`, owner(shop), {
      reason: 'Uang kembali ke pelanggan',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<TxDto>(res).status).toBe('voided');
    expect(await revenue(shop)).toBe(0);
    const [log] = await audits(shop, 'transaction.void_approved');
    expect(log).toMatchObject({
      actorType: 'user',
      entityId: id,
      after: { status: 'voided', reason: 'Uang kembali ke pelanggan' },
    });
    expect(log?.meta).toMatchObject({ direct: true, reason: 'Uang kembali ke pelanggan' });
    // Repeating it is harmless and writes no second record.
    expect(
      (await post(env, `/v1/transactions/${id}/void-requests`, owner(shop), { reason: 'Ulang' }))
        .statusCode,
    ).toBe(200);
    expect(await audits(shop, 'transaction.void_approved')).toHaveLength(1);
  });

  it('settles a pending request of an employee', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const requested = json<VoidDto>(await requestVoid(shop, id));
    await post(env, `/v1/transactions/${id}/void-requests`, owner(shop), {
      reason: 'Saya void langsung',
    });
    const [row] = await env.handle.db
      .select()
      .from(voidRequests)
      .where(eq(voidRequests.id, requested.id));
    expect(row).toMatchObject({ status: 'approved', decisionChannel: 'dashboard' });
    expect((await statusOf(shop, id)).status).toBe('voided');
  });
});

describe('approve with the owner PIN on the device', () => {
  async function setOwnerPin(shop: Shop, pin = nextPin()) {
    const res = await patch(env, '/v1/settings', owner(shop), { owner_pin: pin });
    expect(res.statusCode, res.body).toBe(200);
    return pin;
  }
  const withPin = (shop: Shop, voidId: string, pin: string, note?: string) =>
    post(env, `/v1/void-requests/${voidId}/approve-with-pin`, shop.cashier.headers, {
      owner_pin: pin,
      ...(note ? { note } : {}),
    });

  it('approves with the right PIN and records the channel and the device', async () => {
    const shop = await createShop(env);
    const pin = await setOwnerPin(shop);
    const id = await sale(shop);
    const requested = json<VoidDto>(await requestVoid(shop, id));
    const res = await withPin(shop, requested.id, pin, 'Disetujui di kasir');
    expect(res.statusCode, res.body).toBe(200);
    expect(json<VoidDto>(res)).toMatchObject({
      status: 'approved',
      decision_channel: 'device_pin',
      decision_note: 'Disetujui di kasir',
    });
    expect((await statusOf(shop, id)).status).toBe('voided');
    const [log] = await audits(shop, 'transaction.void_approved');
    expect(log?.meta).toMatchObject({
      channel: 'device_pin',
      via_employee_id: shop.cashier.employeeId,
      device_id: shop.cashier.deviceId,
    });
    expect(JSON.stringify(log)).not.toContain(pin);
  });

  it('rejects a wrong PIN, audits the attempt and does not change the sale', async () => {
    const shop = await createShop(env);
    await setOwnerPin(shop, '482913');
    const id = await sale(shop);
    const requested = json<VoidDto>(await requestVoid(shop, id));
    const res = await withPin(shop, requested.id, '000000');
    expect(res.statusCode).toBe(401);
    expect(json(res)).toMatchObject({ code: 'INVALID_OWNER_PIN' });
    expect((await statusOf(shop, id)).status).toBe('void_requested');
    expect(await audits(shop, 'void.owner_pin_failed')).toHaveLength(1);
    expect((await withPin(shop, requested.id, '12ab56')).statusCode).toBe(400);
  });

  it('answers the same when no owner PIN was ever set', async () => {
    const shop = await createShop(env);
    const requested = json<VoidDto>(await requestVoid(shop, await sale(shop)));
    const res = await withPin(shop, requested.id, '123456');
    expect(res.statusCode).toBe(401);
    expect(json(res)).toMatchObject({ code: 'INVALID_OWNER_PIN' });
  });

  it('locks the PIN pad after repeated failures, even for the right PIN', async () => {
    const shop = await createShop(env);
    const pin = await setOwnerPin(shop, '735192');
    const requested = json<VoidDto>(await requestVoid(shop, await sale(shop)));
    for (let i = 0; i < OWNER_PIN_MAX_FAILURES; i++) {
      expect((await withPin(shop, requested.id, '111111')).statusCode).toBe(401);
    }
    const locked = await withPin(shop, requested.id, pin);
    expect(locked.statusCode).toBe(423);
    expect(json(locked)).toMatchObject({ code: 'OWNER_PIN_LOCKED' });
    expect(locked.headers['retry-after']).toBeTruthy();
    // Another outlet is not affected.
    const other = await createShop(env);
    const otherPin = await setOwnerPin(other);
    const otherRequest = json<VoidDto>(await requestVoid(other, await sale(other)));
    expect((await withPin(other, otherRequest.id, otherPin)).statusCode).toBe(200);
  });

  it('counts parallel wrong PINs atomically: never more than the limit gets through', async () => {
    const shop = await createShop(env);
    await setOwnerPin(shop, '593017');
    const requested = json<VoidDto>(await requestVoid(shop, await sale(shop)));
    const results = await Promise.all(
      Array.from({ length: 12 }, () => withPin(shop, requested.id, '111111')),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(OWNER_PIN_MAX_FAILURES);
    expect(codes.filter((c) => c === 423)).toHaveLength(12 - OWNER_PIN_MAX_FAILURES);
    expect(await audits(shop, 'void.owner_pin_failed')).toHaveLength(OWNER_PIN_MAX_FAILURES);
  });

  it('needs an employee session', async () => {
    const shop = await createShop(env);
    const pin = await setOwnerPin(shop);
    const requested = json<VoidDto>(await requestVoid(shop, await sale(shop)));
    const res = await post(env, `/v1/void-requests/${requested.id}/approve-with-pin`, owner(shop), {
      owner_pin: pin,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('offline sync of void requests', () => {
  const push = async (shop: Shop, mutations: unknown[]) => {
    const res = await post(
      env,
      '/v1/sync/push',
      { 'x-device-token': shop.device.token },
      { mutations },
    );
    expect(res.statusCode, res.body).toBe(200);
    return json<{ results: { id: string; status: string; code?: string }[] }>(res).results;
  };
  const mutation = (
    shop: Shop,
    id: string,
    transactionId: string,
    reason = 'Salah input offline',
  ) => ({
    id,
    type: 'void_request.create',
    client_created_at: new Date(env.clock.now.getTime() - 60_000).toISOString(),
    employee_id: shop.cashier.employeeId,
    payload: { transaction_id: transactionId, reason },
  });

  it('applies once, answers duplicate on replay and dates the request by the device clock', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const requestId = uuidv7();
    const [a] = await push(shop, [mutation(shop, requestId, id)]);
    expect(a).toMatchObject({ id: requestId, status: 'applied' });
    const [b] = await push(shop, [mutation(shop, requestId, id)]);
    expect(b).toMatchObject({ status: 'duplicate' });
    expect((await statusOf(shop, id)).status).toBe('void_requested');
    const [row] = await env.handle.db
      .select()
      .from(voidRequests)
      .where(eq(voidRequests.id, requestId));
    expect(row?.requestedAt.getTime()).toBe(env.clock.now.getTime() - 60_000);
    const [log] = await audits(shop, 'transaction.void_requested');
    expect(log?.meta).toMatchObject({ source: 'sync', void_request_id: requestId });
  });

  it('rejects instead of failing the batch', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const results = await push(shop, [
      mutation(shop, uuidv7(), uuidv7()),
      { ...mutation(shop, uuidv7(), id), employee_id: undefined },
      { ...mutation(shop, uuidv7(), id), payload: { transaction_id: id } },
      { ...mutation(shop, uuidv7(), id), employee_id: uuidv7() },
      mutation(shop, uuidv7(), id),
    ]);
    expect(results.map((r) => r.code ?? r.status)).toEqual([
      'NOT_FOUND',
      'EMPLOYEE_REQUIRED',
      'VALIDATION_ERROR',
      'EMPLOYEE_UNKNOWN',
      'applied',
    ]);
  });

  it('refuses to void a sale that is not paid', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    await post(env, `/v1/transactions/${id}/void-requests`, owner(shop), { reason: 'Void owner' });
    const [r] = await push(shop, [mutation(shop, uuidv7(), id)]);
    expect(r).toMatchObject({ status: 'rejected', code: 'TRANSACTION_NOT_VOIDABLE' });
  });
});

describe('sync void requests follow the visibility rule', () => {
  const pushVoid = async (shop: Shop, transactionId: string, at: Date) => {
    const id = uuidv7();
    const res = await post(
      env,
      '/v1/sync/push',
      { 'x-device-token': shop.device.token },
      {
        mutations: [
          {
            id,
            type: 'void_request.create',
            client_created_at: at.toISOString(),
            employee_id: shop.cashier.employeeId,
            payload: { transaction_id: transactionId, reason: 'Salah input offline' },
          },
        ],
      },
    );
    expect(res.statusCode, res.body).toBe(200);
    return first(json<{ results: { status: string; code?: string }[] }>(res).results);
  };

  it('rejects a sale of a closed shift on another day, accepts it on its own day', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 130_000,
      closed_at: env.clock.now.toISOString(),
    });
    expect(closed.statusCode, closed.body).toBe(200);
    const saleDay = new Date(env.clock.now);

    env.clock.advance(2 * 24 * 60 * 60_000);
    const late = await pushVoid(shop, id, new Date(env.clock.now));
    expect(late).toMatchObject({ status: 'rejected', code: 'FORBIDDEN' });
    expect((await statusOf(shop, id)).status).toBe('paid');

    // The employee asked on the day of the sale, while offline: that request still counts.
    expect(await pushVoid(shop, id, saleDay)).toMatchObject({ status: 'applied' });
    expect((await statusOf(shop, id)).status).toBe('void_requested');
  });

  it('accepts any sale of a shift that is still open', async () => {
    const shop = await createShop(env);
    const id = await sale(shop);
    env.clock.advance(2 * 24 * 60 * 60_000);
    expect(await pushVoid(shop, id, new Date(env.clock.now))).toMatchObject({ status: 'applied' });
  });
});

describe('void and the cash of the open shift', () => {
  const expectedCash = async (shop: Shop) =>
    json<{ expected_cash: number; voided_count: number; pending_void_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, shop.cashier.headers),
    );

  it('lowers expected cash only once the void is approved', async () => {
    const shop = await createShop(env); // opening cash 100.000
    const id = await sale(shop, 2); // + 30.000 cash
    await sale(shop, 1); // + 15.000 cash
    expect(await expectedCash(shop)).toMatchObject({ expected_cash: 145_000 });

    const requested = json<VoidDto>(await requestVoid(shop, id));
    // Still counted while the owner has not decided (reported as pending).
    expect(await expectedCash(shop)).toMatchObject({
      expected_cash: 145_000,
      pending_void_count: 1,
    });

    await post(env, `/v1/void-requests/${requested.id}/approve`, owner(shop), {});
    expect(await expectedCash(shop)).toMatchObject({
      expected_cash: 115_000,
      voided_count: 1,
      pending_void_count: 0,
    });
  });

  it('is back to the full amount when the void is rejected, and drops on a direct owner void', async () => {
    const shop = await createShop(env);
    const a = await sale(shop, 2);
    const b = await sale(shop, 1);
    const requested = json<VoidDto>(await requestVoid(shop, a));
    await post(env, `/v1/void-requests/${requested.id}/reject`, owner(shop), {});
    expect(await expectedCash(shop)).toMatchObject({ expected_cash: 145_000 });
    await post(env, `/v1/transactions/${b}/void-requests`, owner(shop), {
      reason: 'Uang dikembalikan',
    });
    expect(await expectedCash(shop)).toMatchObject({ expected_cash: 130_000, voided_count: 1 });
  });
});

describe('database guarantees', () => {
  it('keeps the audit log append-only', async () => {
    const shop = await createShop(env);
    await requestVoid(shop, await sale(shop));
    const [log] = await audits(shop, 'transaction.void_requested');
    const err = await env.handle.db
      .update(auditLogs)
      .set({ action: 'edited' })
      .where(eq(auditLogs.id, log?.id ?? ''))
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(String((err as Error | undefined)?.cause ?? err)).toContain('append-only');
  });
});
