import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, shifts, transactions } from '../src/db/schema.js';
import {
  bearer,
  cashierSession,
  createTestEnv,
  json,
  loginOwner,
  newShiftId,
  seedOutlet,
  seedTransaction,
  type CashierSession,
  type SeededOutlet,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

interface World {
  seeded: SeededOutlet;
  ownerToken: string;
  a: CashierSession;
  b: CashierSession;
}

/** One outlet with two cashiers on two different paired devices. */
async function world(): Promise<World> {
  const seeded = await seedOutlet(env);
  const owner = await loginOwner(env, seeded);
  const a = await cashierSession(env, seeded, owner, undefined, 'Ani');
  const b = await cashierSession(env, seeded, owner, undefined, 'Budi');
  return { seeded, ownerToken: owner.token, a, b };
}

const openShift = (s: CashierSession, body: Record<string, unknown> = {}) =>
  env.app.inject({
    method: 'POST',
    url: '/v1/shifts',
    headers: s.headers,
    payload: {
      id: newShiftId(),
      opening_cash: 200_000,
      opened_at: env.clock.now.toISOString(),
      ...body,
    },
  });

const closeShift = (s: CashierSession, shiftId: string, body: Record<string, unknown> = {}) =>
  env.app.inject({
    method: 'POST',
    url: `/v1/shifts/${shiftId}/close`,
    headers: s.headers,
    payload: { actual_cash: 0, closed_at: env.clock.now.toISOString(), ...body },
  });

const summary = (headers: Record<string, string>, shiftId: string) =>
  env.app.inject({ method: 'GET', url: `/v1/shifts/${shiftId}/summary`, headers });

describe('open shift', () => {
  it('opens the outlet shift with opening cash, naming the employee and device', async () => {
    const w = await world();
    const id = newShiftId();
    const res = await openShift(w.a, { id, opening_cash: 150_000 });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toMatchObject({
      id,
      status: 'open',
      opening_cash: 150_000,
      opened_on_device_id: w.a.deviceId,
      opened_by: { id: w.a.employeeId, name: 'Ani' },
      closed_by: null,
      closed_at: null,
      expected_cash: null,
      actual_cash: null,
      cash_difference: null,
    });
  });

  it('is idempotent on the client id: replay returns 200 with the same shift', async () => {
    const w = await world();
    const id = newShiftId();
    expect((await openShift(w.a, { id })).statusCode).toBe(201);
    const replay = await openShift(w.a, { id });
    expect(replay.statusCode).toBe(200);
    expect(json(replay)).toMatchObject({ id, status: 'open' });
    expect(
      await env.handle.db.select().from(shifts).where(eq(shifts.outletId, w.seeded.outletId)),
    ).toHaveLength(1);
  });

  it('rejects a second open shift in the same outlet (SHIFT_ALREADY_OPEN), naming the open one', async () => {
    const w = await world();
    const first = json<{ id: string }>(await openShift(w.a));
    for (const cashier of [w.a, w.b]) {
      const res = await openShift(cashier);
      expect(res.statusCode).toBe(409);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const body = json<{ code: string; detail: string }>(res);
      expect(body.code).toBe('SHIFT_ALREADY_OPEN');
      expect(body.detail).toContain(first.id);
    }
    expect(
      await env.handle.db.select().from(shifts).where(eq(shifts.outletId, w.seeded.outletId)),
    ).toHaveLength(1);
  });

  it('lets only one of several concurrent opens win', async () => {
    const w = await world();
    const results = await Promise.all([
      openShift(w.a),
      openShift(w.b),
      openShift(w.a),
      openShift(w.b),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409]);
    expect(
      await env.handle.db.select().from(shifts).where(eq(shifts.outletId, w.seeded.outletId)),
    ).toHaveLength(1);
  });

  it('allows an open shift in each outlet independently', async () => {
    const w1 = await world();
    const w2 = await world();
    expect((await openShift(w1.a)).statusCode).toBe(201);
    expect((await openShift(w2.a)).statusCode).toBe(201);
  });

  it('validates the body', async () => {
    const w = await world();
    for (const bad of [
      { opening_cash: -1 },
      { opening_cash: 1.5 },
      { opening_cash: '1000' },
      { id: 'not-a-uuid' },
      { opened_at: 'yesterday' },
      { opened_at: '1775-08-07T21:39:24.272511Z' },
      { opened_at: '0001-01-01T00:00:00Z' },
      { opened_at: '9999-12-31T23:59:59Z' },
    ]) {
      const res = await openShift(w.a, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('accepts non-RFC 4122 UUIDs for the shift id, as the spec does', async () => {
    const w = await world();
    const id = 'e3e70682-c209-4cac-629f-6fbed82c07cd';
    expect((await openShift(w.a, { id })).statusCode).toBe(201);
    const current = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts/current',
      headers: w.a.headers,
    });
    expect(current.statusCode).toBe(200);
  });

  it('does not let one outlet replay another outlet’s shift id', async () => {
    const w1 = await world();
    const w2 = await world();
    const id = newShiftId();
    expect((await openShift(w1.a, { id })).statusCode).toBe(201);
    const res = await openShift(w2.a, { id });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'ID_CONFLICT' });
  });
});

describe('current shift', () => {
  it('is 204 with no open shift, and is shared by every device of the outlet', async () => {
    const w = await world();
    const none = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts/current',
      headers: w.b.headers,
    });
    expect(none.statusCode).toBe(204);
    const opened = json<{ id: string }>(await openShift(w.a));
    for (const cashier of [w.a, w.b]) {
      const res = await env.app.inject({
        method: 'GET',
        url: '/v1/shifts/current',
        headers: cashier.headers,
      });
      expect(res.statusCode).toBe(200);
      expect(json(res)).toMatchObject({
        id: opened.id,
        status: 'open',
        opened_by: { name: 'Ani' },
      });
    }
  });

  it('is 204 again after the shift is closed, and a new shift can be opened (handover)', async () => {
    const w = await world();
    const first = json<{ id: string }>(await openShift(w.a));
    expect((await closeShift(w.a, first.id, { actual_cash: 200_000 })).statusCode).toBe(200);
    expect(
      (await env.app.inject({ method: 'GET', url: '/v1/shifts/current', headers: w.b.headers }))
        .statusCode,
    ).toBe(204);
    const second = await openShift(w.b, { opening_cash: 100_000 });
    expect(second.statusCode).toBe(201);
    expect(json(second)).toMatchObject({ opened_by: { name: 'Budi' }, opening_cash: 100_000 });
  });
});

describe('shift summary and close', () => {
  async function busyShift() {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a, { opening_cash: 200_000 })).id;
    const base = { shiftId, outletId: w.seeded.outletId };
    const ani = { ...base, deviceId: w.a.deviceId, employeeId: w.a.employeeId };
    const budi = { ...base, deviceId: w.b.deviceId, employeeId: w.b.employeeId };
    await seedTransaction(env, { ...ani, total: 30_000 });
    await seedTransaction(env, { ...ani, total: 45_000, method: 'qris' });
    await seedTransaction(env, { ...budi, total: 20_000 });
    await seedTransaction(env, { ...budi, total: 15_000, status: 'void_requested' });
    await seedTransaction(env, { ...budi, total: 50_000, status: 'voided' });
    await seedTransaction(env, { ...ani, total: 99_000, status: 'cancelled', method: 'qris' });
    return { w, shiftId, ani, budi };
  }

  it('summarises an open shift: cash, QRIS, expected cash, pending voids and per-cashier breakdown', async () => {
    const { w, shiftId } = await busyShift();
    const res = await summary(w.b.headers, shiftId);
    expect(res.statusCode).toBe(200);
    const body = json<{
      by_employee: {
        employee: { name: string };
        transaction_count: number;
        total_cash_sales: number;
        total_qris_sales: number;
      }[];
    }>(res);
    expect(body).toMatchObject({
      total_cash_sales: 65_000, // 30k + 20k + 15k (void_requested still counts)
      total_qris_sales: 45_000,
      total_sales: 110_000,
      transaction_count: 4,
      expected_cash: 265_000, // 200k opening + 65k cash
      actual_cash: null,
      cash_difference: null,
      pending_void_count: 1,
      pending_void_amount: 15_000,
      voided_count: 1,
      voided_amount: 50_000,
      qris_manual_confirmed_count: 1,
      late_transaction_count: 0,
      late_cash_amount: 0,
    });
    expect(body.by_employee).toHaveLength(2);
    const ani = body.by_employee.find((e) => e.employee.name === 'Ani');
    const budi = body.by_employee.find((e) => e.employee.name === 'Budi');
    expect(ani).toMatchObject({
      transaction_count: 2,
      total_cash_sales: 30_000,
      total_qris_sales: 45_000,
    });
    expect(budi).toMatchObject({
      transaction_count: 2,
      total_cash_sales: 35_000,
      total_qris_sales: 0,
    });
  });

  it('closes with expected vs actual cash and a negative difference when cash is short', async () => {
    const { w, shiftId } = await busyShift();
    const res = await closeShift(w.b, shiftId, {
      actual_cash: 260_000,
      closing_note: 'kurang 5rb',
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      expected_cash: 265_000,
      actual_cash: 260_000,
      cash_difference: -5_000,
      total_cash_sales: 65_000,
      total_qris_sales: 45_000,
      shift: {
        status: 'closed',
        closed_by: { name: 'Budi' },
        closed_on_device_id: w.b.deviceId,
        opened_by: { name: 'Ani' },
        expected_cash: 265_000,
        actual_cash: 260_000,
        cash_difference: -5_000,
        closed_offline: false,
      },
    });
    const [row] = await env.handle.db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(row).toMatchObject({ status: 'closed', closingNote: 'kurang 5rb', transactionCount: 4 });
  });

  it('closes with a surplus (positive difference) and exact cash (zero)', async () => {
    const { w, shiftId } = await busyShift();
    const res = await closeShift(w.a, shiftId, { actual_cash: 270_000 });
    expect(json(res)).toMatchObject({ cash_difference: 5_000 });
    const w2 = await world();
    const id = json<{ id: string }>(await openShift(w2.a, { opening_cash: 100_000 })).id;
    expect(json(await closeShift(w2.a, id, { actual_cash: 100_000 }))).toMatchObject({
      cash_difference: 0,
      expected_cash: 100_000,
    });
  });

  it('only counts transactions created up to closed_at; later ones are late and reported separately', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a, { opening_cash: 100_000 })).id;
    const base = {
      shiftId,
      outletId: w.seeded.outletId,
      deviceId: w.b.deviceId,
      employeeId: w.b.employeeId,
    };
    const closeAt = new Date(env.clock.now.getTime() + 60_000);
    await seedTransaction(env, {
      ...base,
      total: 10_000,
      createdAt: new Date(closeAt.getTime() - 5_000),
    });
    const lateId = await seedTransaction(env, {
      ...base,
      total: 25_000,
      createdAt: new Date(closeAt.getTime() + 5_000),
    });

    env.clock.advance(2 * 60_000);
    const res = await closeShift(w.a, shiftId, {
      actual_cash: 110_000,
      closed_at: closeAt.toISOString(),
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      total_cash_sales: 10_000,
      expected_cash: 110_000,
      cash_difference: 0,
      transaction_count: 1,
      late_transaction_count: 1,
      late_cash_amount: 25_000,
    });
    const [late] = await env.handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, lateId));
    expect(late?.afterShiftClose).toBe(true);
  });

  it('refuses to close while a QRIS payment is still pending (PENDING_QRIS_EXISTS)', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a)).id;
    await seedTransaction(env, {
      shiftId,
      outletId: w.seeded.outletId,
      deviceId: w.a.deviceId,
      employeeId: w.a.employeeId,
      total: 20_000,
      method: 'qris',
      status: 'pending',
    });
    const res = await closeShift(w.a, shiftId, { actual_cash: 200_000 });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'PENDING_QRIS_EXISTS' });
    const [row] = await env.handle.db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(row?.status).toBe('open');
  });

  it('rejects closing twice (SHIFT_CLOSED) but treats an identical retry as idempotent', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a)).id;
    const body = { actual_cash: 200_000, closed_at: env.clock.now.toISOString() };
    expect((await closeShift(w.a, shiftId, body)).statusCode).toBe(200);
    const replay = await closeShift(w.a, shiftId, body);
    expect(replay.statusCode).toBe(200);
    const other = await closeShift(w.b, shiftId, body);
    expect(other.statusCode).toBe(409);
    expect(json(other)).toMatchObject({ code: 'SHIFT_CLOSED' });
    const different = await closeShift(w.a, shiftId, { ...body, actual_cash: 1 });
    expect(different.statusCode).toBe(409);
  });

  it('rejects invalid close requests and unknown shifts', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a)).id;
    expect((await closeShift(w.a, shiftId, { actual_cash: -5 })).statusCode).toBe(400);
    expect(
      (
        await closeShift(w.a, shiftId, {
          closed_at: new Date(env.clock.now.getTime() - 3600_000).toISOString(),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await closeShift(w.a, shiftId, {
          closed_at: new Date(env.clock.now.getTime() + 3600_000).toISOString(),
        })
      ).statusCode,
    ).toBe(400);
    expect((await closeShift(w.a, newShiftId())).statusCode).toBe(404);
    const other = await world();
    expect((await closeShift(other.a, shiftId)).statusCode).toBe(404);
  });

  it('records offline closes with the unsynced count, audited as shift.closed_offline', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a)).id;
    const res = await closeShift(w.b, shiftId, {
      actual_cash: 200_000,
      closed_offline: true,
      unsynced_count: 3,
    });
    expect(json(res)).toMatchObject({ unsynced_hint: true, shift: { closed_offline: true } });
    const [log] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, shiftId), eq(auditLogs.action, 'shift.closed_offline')));
    expect(log).toMatchObject({ actorType: 'employee', actorId: w.b.employeeId });
  });

  it('keeps the totals recorded at close for a closed shift', async () => {
    const { w, shiftId, ani } = await busyShift();
    await closeShift(w.a, shiftId, { actual_cash: 265_000 });
    // A sale from before the close that only reaches the server later does not rewrite the closed totals.
    await seedTransaction(env, {
      ...ani,
      total: 1_000,
      createdAt: new Date(env.clock.now.getTime() - 1000),
    });
    const after = json<{ expected_cash: number; total_cash_sales: number }>(
      await summary(w.a.headers, shiftId),
    );
    expect(after.expected_cash).toBe(265_000);
    expect(after.total_cash_sales).toBe(65_000);
  });
});

describe('who can read a shift summary', () => {
  it('employees see the open shift or a shift they closed; the owner sees any shift of the outlet', async () => {
    const w = await world();
    const shiftId = json<{ id: string }>(await openShift(w.a)).id;
    expect((await summary(w.b.headers, shiftId)).statusCode).toBe(200);
    expect((await closeShift(w.a, shiftId, { actual_cash: 200_000 })).statusCode).toBe(200);

    expect((await summary(w.a.headers, shiftId)).statusCode).toBe(200); // closed by Ani
    const forbidden = await summary(w.b.headers, shiftId); // closed by somebody else
    expect(forbidden.statusCode).toBe(403);
    expect(json(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    expect((await summary(bearer(w.ownerToken), shiftId)).statusCode).toBe(200);
  });
});

describe('shift history (owner)', () => {
  it('lists shifts newest first with cursor pagination and filters', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      env.clock.advance(60_000);
      const opened = await openShift(w.a, {
        opened_at: env.clock.now.toISOString(),
        opening_cash: 1000 * (i + 1),
      });
      const id = json<{ id: string }>(opened).id;
      ids.push(id);
      await closeShift(w.a, id, {
        actual_cash: 1000 * (i + 1),
        closed_at: env.clock.now.toISOString(),
      });
    }
    const page1 = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts?limit=2',
      headers: bearer(w.ownerToken),
    });
    const body1 = json<{ data: { id: string }[]; next_cursor: string | null }>(page1);
    expect(body1.data.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    expect(body1.next_cursor).toBeTruthy();
    const page2 = await env.app.inject({
      method: 'GET',
      url: `/v1/shifts?limit=2&cursor=${body1.next_cursor}`,
      headers: bearer(w.ownerToken),
    });
    const body2 = json<{ data: { id: string }[]; next_cursor: string | null }>(page2);
    expect(body2.data.map((s) => s.id)).toEqual([ids[0]]);
    expect(body2.next_cursor).toBeNull();

    const open = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts?status=open',
      headers: bearer(w.ownerToken),
    });
    expect(json<{ data: unknown[] }>(open).data).toHaveLength(0);
    const byEmployee = await env.app.inject({
      method: 'GET',
      url: `/v1/shifts?employee_id=${w.a.employeeId}`,
      headers: bearer(w.ownerToken),
    });
    expect(json<{ data: unknown[] }>(byEmployee).data).toHaveLength(3);
    const badCursor = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts?cursor=garbage',
      headers: bearer(w.ownerToken),
    });
    expect(badCursor.statusCode).toBe(400);
  });

  it('filters by WIB business date', async () => {
    const w = await world();
    // 2026-10-25 20:00 UTC is 2026-10-26 03:00 WIB.
    const openedAt = '2026-10-25T20:00:00.000Z';
    const res = await openShift(w.a, { opened_at: openedAt });
    expect(res.statusCode).toBe(201);
    const on = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts?date_from=2026-10-26&date_to=2026-10-26',
      headers: bearer(w.ownerToken),
    });
    expect(json<{ data: unknown[] }>(on).data).toHaveLength(1);
    const before = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts?date_from=2026-10-25&date_to=2026-10-25',
      headers: bearer(w.ownerToken),
    });
    expect(json<{ data: unknown[] }>(before).data).toHaveLength(0);
  });

  it('is scoped to the outlet', async () => {
    const w1 = await world();
    const w2 = await world();
    await openShift(w1.a);
    const res = await env.app.inject({
      method: 'GET',
      url: '/v1/shifts',
      headers: bearer(w2.ownerToken),
    });
    expect(json<{ data: unknown[] }>(res).data).toHaveLength(0);
  });
});
