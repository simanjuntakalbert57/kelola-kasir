import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, shifts, transactionDeletions, transactions } from '../src/db/schema.js';
import { TokenService } from '../src/lib/jwt.js';
import { OwnerAuthService } from '../src/modules/auth/owner-service.js';
import { computeShiftTotals } from '../src/modules/shifts/summary.js';
import {
  bearer,
  createShop,
  createTestEnv,
  first,
  get,
  json,
  OWNER_PASSWORD,
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

interface TxDto {
  id: string;
  number: string;
  status: string;
  total: number;
  deleted: { deleted_at: string; deleted_by: { id: string; name: string }; reason: string } | null;
  deletion_history?: { action: string; reason: string | null; actor: { name: string } }[];
}
interface Summary {
  revenue: number;
  transaction_count: number;
}

const owner = (shop: Shop) => bearer(shop.ownerToken);
const REASON = 'transaksi uji coba';

const sale = async (shop: Shop, o: Parameters<typeof txBody>[2] = {}): Promise<TxDto> => {
  const res = await post(env, '/v1/transactions', shop.cashier.headers, txBody(env, shop, o));
  expect(res.statusCode, res.body).toBe(201);
  return json<TxDto>(res);
};

const del = (
  shop: Shop,
  id: string,
  reason: unknown = REASON,
  headers: Record<string, string> = owner(shop),
) =>
  env.app.inject({
    method: 'DELETE',
    url: `/v1/transactions/${id}`,
    headers,
    payload: { reason },
  });
const restore = (
  shop: Shop,
  id: string,
  payload: unknown = {},
  headers: Record<string, string> = owner(shop),
) => post(env, `/v1/transactions/${id}/restore`, headers, payload);

async function manager(shop: Shop): Promise<string> {
  const email = `manager-${Math.random().toString(36).slice(2)}@example.test`;
  await new OwnerAuthService({
    config: env.config,
    db: env.handle.db,
    tokens: new TokenService(env.config.jwtPrivateKeyPem),
    now: () => new Date(),
  }).createOwner({
    email,
    password: OWNER_PASSWORD,
    name: 'Manajer',
    outletId: shop.seeded.outletId,
    role: 'manager',
  });
  const res = await post(env, '/v1/auth/login', {}, { email, password: OWNER_PASSWORD });
  return json<{ access_token: string }>(res).access_token;
}

const today = () => env.clock.now.toISOString().slice(0, 10);
const summary = async (shop: Shop): Promise<Summary> => {
  const res = await get(
    env,
    `/v1/dashboard/summary?date_from=${today()}&date_to=${today()}`,
    owner(shop),
  );
  expect(res.statusCode, res.body).toBe(200);
  return json<Summary>(res);
};
const historyRows = (id: string) =>
  env.handle.db
    .select()
    .from(transactionDeletions)
    .where(eq(transactionDeletions.transactionId, id));
const audits = (shop: Shop, action: string, id: string) =>
  env.handle.db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.outletId, shop.seeded.outletId),
        eq(auditLogs.action, action),
        eq(auditLogs.entityId, id),
      ),
    );

describe('access control and validation', () => {
  it('is owner only: manager, cashier and device get 403', async () => {
    const shop = await createShop(env);
    const tx = await sale(shop);
    const mgr = bearer(await manager(shop));
    for (const headers of [mgr, shop.cashier.headers]) {
      expect((await del(shop, tx.id, REASON, headers)).statusCode).toBe(403);
      expect((await restore(shop, tx.id, {}, headers)).statusCode).toBe(403);
      expect((await get(env, '/v1/transactions/deleted', headers)).statusCode).toBe(403);
    }
    // A device token alone is not an owner session at all.
    const deviceOnly = { 'x-device-token': shop.device.token };
    expect(
      (
        await env.app.inject({
          method: 'DELETE',
          url: `/v1/transactions/${tx.id}`,
          headers: deviceOnly,
          payload: { reason: REASON },
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(401);
    expect((await historyRows(tx.id)).length).toBe(0);
  });

  it('requires 5-200 characters after trimming (400), and 404 for an unknown or foreign id', async () => {
    const shop = await createShop(env);
    const other = await createShop(env);
    const tx = await sale(shop);
    for (const reason of ['abcd', '    abcd   ', '', 'x'.repeat(201), null, 42]) {
      expect((await del(shop, tx.id, reason)).statusCode).toBe(400);
    }
    const ok = await del(shop, tx.id, '  alasan sah  ');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json<TxDto>(ok).deleted?.reason).toBe('alasan sah');
    expect((await del(shop, '0192e0a0-0000-7000-8000-000000000000')).statusCode).toBe(404);
    expect((await del(other, tx.id)).statusCode).toBe(404);
    expect((await restore(other, tx.id)).statusCode).toBe(404);
  });

  it('refuses pending and void_requested transactions with 409', async () => {
    const shop = await createShop(env, { qris: true });
    const pending = json<TxDto>(
      await post(
        env,
        '/v1/transactions',
        shop.cashier.headers,
        txBody(env, shop, { method: 'qris' }),
      ),
    );
    expect(pending.status).toBe('pending');
    const requested = await sale(shop);
    const voidRes = await post(
      env,
      `/v1/transactions/${requested.id}/void-requests`,
      shop.cashier.headers,
      { id: first([crypto.randomUUID()]), reason: 'salah input' },
    );
    expect(voidRes.statusCode, voidRes.body).toBeLessThan(300);
    for (const id of [pending.id, requested.id]) {
      const res = await del(shop, id);
      expect(res.statusCode).toBe(409);
      expect(json<{ code: string }>(res).code).toBe('TRANSACTION_NOT_DELETABLE');
      expect((await historyRows(id)).length).toBe(0);
    }
  });
});

describe('delete, restore and history', () => {
  it('lowers revenue on delete and raises it again on restore', async () => {
    const shop = await createShop(env);
    const keep = await sale(shop, { qty: 1 });
    const gone = await sale(shop, { qty: 3 });
    const before = await summary(shop);
    expect(before.transaction_count).toBe(2);

    const res = await del(shop, gone.id);
    expect(res.statusCode, res.body).toBe(200);
    const dto = json<TxDto>(res);
    expect(dto.deleted).toMatchObject({ reason: REASON, deleted_by: { name: 'Test Owner' } });
    const after = await summary(shop);
    expect(after.transaction_count).toBe(1);
    expect(after.revenue).toBe(before.revenue - gone.total);

    const sales = json<{ data: { revenue: number }[] }>(
      await get(
        env,
        `/v1/reports/sales?group_by=payment_method&date_from=${today()}&date_to=${today()}`,
        owner(shop),
      ),
    );
    expect(sales.data.reduce((a, r) => a + r.revenue, 0)).toBe(keep.total);
    const list = json<{ data: { id: string }[] }>(await get(env, '/v1/transactions', owner(shop)));
    expect(list.data.map((t) => t.id)).toEqual([keep.id]);
    const exported = await get(env, '/v1/transactions/export?format=csv', owner(shop));
    expect(exported.body).toContain(keep.number);
    expect(exported.body).not.toContain(gone.number);

    const restored = await restore(shop, gone.id, { note: 'salah hapus' });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(json<TxDto>(restored).deleted).toBeNull();
    const back = await summary(shop);
    expect(back).toMatchObject({ revenue: before.revenue, transaction_count: 2 });
    const relisted = json<{ data: { id: string }[] }>(
      await get(env, '/v1/transactions', owner(shop)),
    );
    expect(relisted.data.map((t) => t.id).sort()).toEqual([keep.id, gone.id].sort());
  });

  it('is idempotent: deleting twice keeps one history row, restoring a live one adds none', async () => {
    const shop = await createShop(env);
    const tx = await sale(shop);
    expect((await restore(shop, tx.id)).statusCode).toBe(200);
    expect((await historyRows(tx.id)).length).toBe(0);
    expect((await del(shop, tx.id)).statusCode).toBe(200);
    const again = await del(shop, tx.id, 'alasan lain lagi');
    expect(again.statusCode).toBe(200);
    expect(json<TxDto>(again).deleted?.reason).toBe(REASON);
    expect((await historyRows(tx.id)).length).toBe(1);
    expect((await audits(shop, 'transaction.deleted', tx.id)).length).toBe(1);
  });

  it('delete → restore → delete leaves 3 history rows and 3 audit records, oldest first', async () => {
    const shop = await createShop(env);
    const tx = await sale(shop);
    await del(shop, tx.id, 'pertama kali');
    await restore(shop, tx.id, { note: 'ternyata benar' });
    await del(shop, tx.id, 'kedua kali');
    expect((await historyRows(tx.id)).length).toBe(3);
    const deletedAudit = await audits(shop, 'transaction.deleted', tx.id);
    const restoredAudit = await audits(shop, 'transaction.restored', tx.id);
    expect(deletedAudit.length + restoredAudit.length).toBe(3);
    expect(first(deletedAudit)).toMatchObject({
      actorType: 'user',
      before: { deleted_at: null },
      after: { delete_reason: expect.any(String) },
    });

    const detail = json<TxDto>(await get(env, `/v1/transactions/${tx.id}`, owner(shop)));
    expect(detail.deleted?.reason).toBe('kedua kali');
    expect(detail.deletion_history?.map((e) => [e.action, e.reason])).toEqual([
      ['delete', 'pertama kali'],
      ['restore', 'ternyata benar'],
      ['delete', 'kedua kali'],
    ]);
  });

  it('writes nothing when the audit insert fails (single database transaction)', async () => {
    const shop = await createShop(env);
    const tx = await sale(shop);
    await env.handle.db.execute(
      `create or replace function kk_test_block_audit() returns trigger as $$ begin raise exception 'blocked'; end; $$ language plpgsql` as never,
    );
    await env.handle.db.execute(
      `create trigger kk_test_block_audit before insert on audit_logs for each row when (new.action = 'transaction.deleted') execute function kk_test_block_audit()` as never,
    );
    try {
      expect((await del(shop, tx.id)).statusCode).toBe(500);
    } finally {
      await env.handle.db.execute('drop trigger kk_test_block_audit on audit_logs' as never);
    }
    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, tx.id));
    expect(row?.deletedAt).toBeNull();
    expect((await historyRows(tx.id)).length).toBe(0);
  });

  it('lists only currently deleted transactions with cursor, date_field and q', async () => {
    const shop = await createShop(env);
    const a = await sale(shop);
    const b = await sale(shop);
    const c = await sale(shop);
    await del(shop, a.id);
    env.clock.advance(1000);
    await del(shop, b.id);
    env.clock.advance(1000);
    await del(shop, c.id);
    await restore(shop, c.id);

    const page1 = json<{ data: TxDto[]; next_cursor: string | null }>(
      await get(env, '/v1/transactions/deleted?limit=1', owner(shop)),
    );
    expect(page1.data.map((t) => t.id)).toEqual([b.id]);
    expect(page1.data[0]?.deleted?.reason).toBe(REASON);
    const page2 = json<{ data: TxDto[]; next_cursor: string | null }>(
      await get(env, `/v1/transactions/deleted?limit=1&cursor=${page1.next_cursor}`, owner(shop)),
    );
    expect(page2.data.map((t) => t.id)).toEqual([a.id]);
    expect(page2.next_cursor).toBeNull();

    const byNumber = json<{ data: TxDto[] }>(
      await get(env, `/v1/transactions/deleted?q=${encodeURIComponent(a.number)}`, owner(shop)),
    );
    expect(byNumber.data.map((t) => t.id)).toEqual([a.id]);
    const none = json<{ data: TxDto[] }>(
      await get(
        env,
        '/v1/transactions/deleted?date_from=2020-01-01&date_to=2020-01-02&date_field=client_created_at',
        owner(shop),
      ),
    );
    expect(none.data).toEqual([]);
    expect(
      (
        await get(
          env,
          '/v1/transactions/deleted?date_from=2026-02-02&date_to=2026-02-01',
          owner(shop),
        )
      ).statusCode,
    ).toBe(400);
  });
});

describe('a deleted transaction elsewhere', () => {
  it('is 404 for the cashier (detail, receipt, void request) but open for the owner', async () => {
    const shop = await createShop(env);
    const tx = await sale(shop);
    await del(shop, tx.id);
    expect((await get(env, `/v1/transactions/${tx.id}`, shop.cashier.headers)).statusCode).toBe(
      404,
    );
    expect((await get(env, `/v1/transactions/${tx.id}/receipt`, owner(shop))).statusCode).toBe(404);
    const voidRes = await post(
      env,
      `/v1/transactions/${tx.id}/void-requests`,
      shop.cashier.headers,
      {
        id: crypto.randomUUID(),
        reason: 'salah input',
      },
    );
    expect(voidRes.statusCode).toBe(404);
    expect(
      (await post(env, `/v1/transactions/${tx.id}/void`, owner(shop), { reason: 'salah input' }))
        .statusCode,
    ).toBe(404);
    const detail = await get(env, `/v1/transactions/${tx.id}`, owner(shop));
    expect(detail.statusCode).toBe(200);
    expect(json<TxDto>(detail).deleted).not.toBeNull();
  });

  it('stays deleted when the device re-sends it, with no notification and no new row', async () => {
    const shop = await createShop(env);
    const body = txBody(env, shop);
    const created = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(created.statusCode).toBe(201);
    const id = json<TxDto>(created).id;
    await del(shop, id);

    const replay = await post(env, '/v1/transactions', shop.cashier.headers, body);
    expect(replay.statusCode).toBe(200);
    expect(json<TxDto>(replay).deleted).toBeNull();

    const push = await post(
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
    expect(json<{ results: { status: string }[] }>(push).results[0]?.status).toBe('duplicate');

    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deleteReason).toBe(REASON);
    expect((await historyRows(id)).length).toBe(1);
    expect((await summary(shop)).transaction_count).toBe(0);
  });
});

describe('shift totals', () => {
  const shiftRow = async (id: string) => {
    const [row] = await env.handle.db.select().from(shifts).where(eq(shifts.id, id));
    if (!row) throw new Error('shift missing');
    return row;
  };

  it('counts deleted sales out of an open shift and reports deleted_count / deleted_amount', async () => {
    const shop = await createShop(env);
    await sale(shop, { qty: 1 });
    const gone = await sale(shop, { qty: 2 });
    await del(shop, gone.id);
    const res = await get(env, `/v1/shifts/${shop.shiftId}/summary`, owner(shop));
    expect(res.statusCode, res.body).toBe(200);
    const s = json<{
      transaction_count: number;
      deleted_count: number;
      deleted_amount: number;
      total_sales: number;
    }>(res);
    expect(s).toMatchObject({ transaction_count: 1, deleted_count: 1, deleted_amount: gone.total });
    await restore(shop, gone.id);
    const back = json<{ transaction_count: number; deleted_count: number }>(
      await get(env, `/v1/shifts/${shop.shiftId}/summary`, owner(shop)),
    );
    expect(back).toMatchObject({ transaction_count: 2, deleted_count: 0 });
  });

  it('keeps the closed-shift figures when a sale is deleted or restored later', async () => {
    const shop = await createShop(env);
    const keep = await sale(shop, { qty: 1 });
    const early = await sale(shop, { qty: 2 });
    const late = await sale(shop, { qty: 3 });
    // `early` is deleted before the close, `late` after it.
    await del(shop, early.id);
    const closed = await post(env, `/v1/shifts/${shop.shiftId}/close`, shop.cashier.headers, {
      actual_cash: 0,
      closed_at: env.clock.now.toISOString(),
    });
    expect(closed.statusCode, closed.body).toBe(200);
    const stored = await shiftRow(shop.shiftId);
    expect(stored.transactionCount).toBe(2);
    expect(stored.totalCashSales).toBe(keep.total + late.total);

    const recompute = async () => computeShiftTotals(env.handle.db, stored, stored.closedAt);
    const baseline = await recompute();
    expect(baseline.totalCashSales).toBe(keep.total + late.total);

    env.clock.advance(60_000);
    await del(shop, late.id); // after the close: still counted at close
    expect((await recompute()).totalCashSales).toBe(baseline.totalCashSales);
    await restore(shop, early.id); // restored after the close: still excluded
    expect((await recompute()).totalCashSales).toBe(baseline.totalCashSales);
    await restore(shop, late.id);
    expect((await recompute()).totalCashSales).toBe(baseline.totalCashSales);

    const summaryRes = json<{
      total_cash_sales: number;
      transaction_count: number;
      deleted_count: number;
    }>(await get(env, `/v1/shifts/${shop.shiftId}/summary`, owner(shop)));
    expect(summaryRes).toMatchObject({
      total_cash_sales: keep.total + late.total,
      transaction_count: 2,
      deleted_count: 0,
    });
    await del(shop, keep.id);
    const afterDelete = json<{
      total_cash_sales: number;
      deleted_count: number;
      deleted_amount: number;
    }>(await get(env, `/v1/shifts/${shop.shiftId}/summary`, owner(shop)));
    expect(afterDelete).toMatchObject({
      total_cash_sales: keep.total + late.total,
      deleted_count: 1,
      deleted_amount: keep.total,
    });
  });
});
