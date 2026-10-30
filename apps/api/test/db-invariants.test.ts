import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  auditLogs,
  categories,
  products,
  shifts,
  transactionDeletions,
  transactionItems,
  transactions,
  users,
} from '../src/db/schema.js';
import { pgError } from '../src/db/client.js';
import { writeAudit } from '../src/modules/audit/audit.js';
import {
  cashierSession,
  createTestEnv,
  json,
  loginOwner,
  newShiftId,
  seedOutlet,
  seedTransaction,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

async function shiftWithTransaction(status: 'pending' | 'paid' = 'paid') {
  const seeded = await seedOutlet(env);
  const cashier = await cashierSession(env, seeded);
  const shiftId = newShiftId();
  const opened = await env.app.inject({
    method: 'POST',
    url: '/v1/shifts',
    headers: cashier.headers,
    payload: { id: shiftId, opening_cash: 0, opened_at: env.clock.now.toISOString() },
  });
  expect(json(opened)).toMatchObject({ id: shiftId });
  const txId = await seedTransaction(env, {
    shiftId,
    outletId: seeded.outletId,
    deviceId: cashier.deviceId,
    employeeId: cashier.employeeId,
    total: 25_000,
    status,
    ...(status === 'pending' ? { method: 'qris' as const } : {}),
  });
  return { seeded, cashier, shiftId, txId };
}

const violation = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (err) {
    return pgError(err);
  }
  return undefined;
};

describe('financial immutability (TDD §3.2)', () => {
  it('rejects edits of money columns once a transaction is paid', async () => {
    const { txId } = await shiftWithTransaction('paid');
    for (const change of [
      { total: 1, subtotal: 1 },
      { subtotal: 5 },
      { number: 'X-K01-261026-9999' },
    ]) {
      const err = await violation(() =>
        env.handle.db.update(transactions).set(change).where(eq(transactions.id, txId)),
      );
      expect(err?.code, JSON.stringify(change)).toBe('23514');
    }
    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, txId));
    expect(row?.total).toBe(25_000);
  });

  it('rejects edits and deletes of the items snapshot after payment', async () => {
    const { txId } = await shiftWithTransaction('paid');
    const upd = await violation(() =>
      env.handle.db
        .update(transactionItems)
        .set({ unitPrice: 1, lineTotal: 1 })
        .where(eq(transactionItems.transactionId, txId)),
    );
    expect(upd?.code).toBe('23514');
    const del = await violation(() =>
      env.handle.db.delete(transactionItems).where(eq(transactionItems.transactionId, txId)),
    );
    expect(del?.code).toBe('23514');
  });

  it('never allows deleting a transaction', async () => {
    const { txId } = await shiftWithTransaction('pending');
    const err = await violation(() =>
      env.handle.db.delete(transactions).where(eq(transactions.id, txId)),
    );
    expect(err?.code).toBe('23514');
  });

  it('follows the transaction state machine (TDD §3.3)', async () => {
    const { txId } = await shiftWithTransaction('pending');
    const set = (status: string) =>
      env.handle.db.update(transactions).set({ status }).where(eq(transactions.id, txId));
    expect((await violation(() => set('voided')))?.code).toBe('23514'); // pending -> voided
    await set('paid');
    expect((await violation(() => set('pending')))?.code).toBe('23514'); // paid -> pending
    expect((await violation(() => set('cancelled')))?.code).toBe('23514'); // paid -> cancelled
    await set('void_requested');
    await set('paid'); // owner rejects the void
    await set('voided');
    expect((await violation(() => set('paid')))?.code).toBe('23514'); // voided is terminal
  });

  it('still allows the after_shift_close flag to be set on a paid transaction', async () => {
    const { txId } = await shiftWithTransaction('paid');
    await env.handle.db
      .update(transactions)
      .set({ afterShiftClose: true })
      .where(eq(transactions.id, txId));
    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, txId));
    expect(row?.afterShiftClose).toBe(true);
  });

  it('keeps money integer and consistent', async () => {
    const { seeded, cashier, shiftId } = await shiftWithTransaction('paid');
    const base = {
      id: uuidv7(),
      outletId: seeded.outletId,
      shiftId,
      deviceId: cashier.deviceId,
      employeeId: cashier.employeeId,
      number: 'JUS1-K01-261026-0001',
      status: 'paid',
      paymentMethod: 'cash',
      clientCreatedAt: new Date(),
    };
    const negative = await violation(() =>
      env.handle.db.insert(transactions).values({ ...base, subtotal: -1, total: -1 }),
    );
    expect(negative?.code).toBe('23514');
    const mismatch = await violation(() =>
      env.handle.db.insert(transactions).values({ ...base, subtotal: 10_000, total: 12_000 }),
    );
    expect(mismatch?.code).toBe('23514');
  });

  it('enforces unique transaction numbers per outlet', async () => {
    const { seeded, cashier, shiftId } = await shiftWithTransaction('paid');
    const row = {
      outletId: seeded.outletId,
      shiftId,
      deviceId: cashier.deviceId,
      employeeId: cashier.employeeId,
      number: 'JUS1-K01-261026-0042',
      status: 'paid',
      paymentMethod: 'cash',
      subtotal: 1000,
      total: 1000,
      clientCreatedAt: new Date(),
    };
    await env.handle.db.insert(transactions).values({ ...row, id: uuidv7() });
    const err = await violation(() =>
      env.handle.db.insert(transactions).values({ ...row, id: uuidv7() }),
    );
    expect(err).toMatchObject({ code: '23505', constraint: 'transactions_outlet_number_unique' });
  });
});

describe('audit log is append-only', () => {
  it('allows inserts but rejects update, delete and truncate', async () => {
    const seeded = await seedOutlet(env);
    await writeAudit(env.handle.db, {
      outletId: seeded.outletId,
      actor: { type: 'system', id: null },
      action: 'test.event',
      entityType: 'test',
    });
    const [row] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outletId, seeded.outletId));
    expect(row?.action).toBe('test.event');
    expect(
      (
        await violation(() =>
          env.handle.db
            .update(auditLogs)
            .set({ action: 'x' })
            .where(eq(auditLogs.id, row?.id ?? '')),
        )
      )?.code,
    ).toBe('23514');
    expect(
      (
        await violation(() =>
          env.handle.db.delete(auditLogs).where(eq(auditLogs.id, row?.id ?? '')),
        )
      )?.code,
    ).toBe('23514');
    expect((await violation(() => env.handle.db.execute(sql`truncate audit_logs`)))?.code).toBe(
      '23514',
    );
  });
});

describe('one open shift per outlet is enforced by the database itself', () => {
  it('rejects a second open row even when inserted directly', async () => {
    const seeded = await seedOutlet(env);
    const cashier = await cashierSession(env, seeded);
    const row = {
      outletId: seeded.outletId,
      openedDeviceId: cashier.deviceId,
      openedBy: cashier.employeeId,
      status: 'open',
      openingCash: 0,
      openedAt: new Date(),
    };
    await env.handle.db.insert(shifts).values({ ...row, id: uuidv7() });
    const err = await violation(() =>
      env.handle.db.insert(shifts).values({ ...row, id: uuidv7() }),
    );
    expect(err).toMatchObject({ code: '23505', constraint: 'shifts_one_open_per_outlet' });
  });

  it('refuses a closed shift without close data', async () => {
    const seeded = await seedOutlet(env);
    const cashier = await cashierSession(env, seeded);
    const err = await violation(() =>
      env.handle.db.insert(shifts).values({
        id: uuidv7(),
        outletId: seeded.outletId,
        openedDeviceId: cashier.deviceId,
        openedBy: cashier.employeeId,
        status: 'closed',
        openingCash: 0,
        openedAt: new Date(),
      }),
    );
    expect(err?.code).toBe('23514');
  });
});

describe('sync cursor', () => {
  it('stamps a strictly increasing updated_seq on every catalog insert and update', async () => {
    const seeded = await seedOutlet(env);
    await loginOwner(env, seeded);
    const [cat] = await env.handle.db
      .insert(categories)
      .values({ outletId: seeded.outletId, name: 'Jus' })
      .returning();
    const [prod] = await env.handle.db
      .insert(products)
      .values({
        outletId: seeded.outletId,
        categoryId: cat?.id ?? '',
        name: 'Alpukat',
        price: 15_000,
      })
      .returning();
    expect(prod?.updatedSeq).toBeGreaterThan(cat?.updatedSeq ?? Infinity);
    const [again] = await env.handle.db
      .update(products)
      .set({ price: 16_000 })
      .where(eq(products.id, prod?.id ?? ''))
      .returning();
    expect(again?.updatedSeq).toBeGreaterThan(prod?.updatedSeq ?? Infinity);
    const bad = await violation(() =>
      env.handle.db
        .insert(products)
        .values({ outletId: seeded.outletId, categoryId: cat?.id ?? '', name: 'Neg', price: -1 }),
    );
    expect(bad?.code).toBe('23514');
  });
});

describe('owner soft delete (ADR-0019)', () => {
  async function ownerId(email: string) {
    const [row] = await env.handle.db.select().from(users).where(eq(users.email, email));
    if (!row) throw new Error('owner not seeded');
    return row.id;
  }

  it('sets and clears deleted_at, deleted_by and delete_reason together', async () => {
    const { seeded, txId } = await shiftWithTransaction('paid');
    const userId = await ownerId(seeded.ownerEmail);
    const partial = await violation(() =>
      env.handle.db
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(eq(transactions.id, txId)),
    );
    expect(partial).toMatchObject({
      code: '23514',
      constraint: 'transactions_deleted_fields_check',
    });
    const deleted = {
      deletedAt: new Date(),
      deletedBy: userId,
      deleteReason: 'transaksi uji coba',
    };
    await env.handle.db.update(transactions).set(deleted).where(eq(transactions.id, txId));
    await env.handle.db
      .update(transactions)
      .set({ deletedAt: null, deletedBy: null, deleteReason: null })
      .where(eq(transactions.id, txId));
    const [row] = await env.handle.db.select().from(transactions).where(eq(transactions.id, txId));
    expect(row?.deletedAt).toBeNull();
  });

  it('rejects deleting a pending transaction', async () => {
    const { seeded, txId } = await shiftWithTransaction('pending');
    const userId = await ownerId(seeded.ownerEmail);
    const err = await violation(() =>
      env.handle.db
        .update(transactions)
        .set({ deletedAt: new Date(), deletedBy: userId, deleteReason: 'dobel input' })
        .where(eq(transactions.id, txId)),
    );
    expect(err).toMatchObject({ code: '23514', constraint: 'transactions_deleted_status_check' });
  });

  it('freezes the status of a deleted transaction until it is restored', async () => {
    const { seeded, txId } = await shiftWithTransaction('paid');
    const userId = await ownerId(seeded.ownerEmail);
    await env.handle.db
      .update(transactions)
      .set({ deletedAt: new Date(), deletedBy: userId, deleteReason: 'dobel input' })
      .where(eq(transactions.id, txId));
    for (const status of ['void_requested', 'voided']) {
      const err = await violation(() =>
        env.handle.db.update(transactions).set({ status }).where(eq(transactions.id, txId)),
      );
      expect(err?.code, status).toBe('23514');
    }
    await env.handle.db
      .update(transactions)
      .set({ deletedAt: null, deletedBy: null, deleteReason: null })
      .where(eq(transactions.id, txId));
    await env.handle.db
      .update(transactions)
      .set({ status: 'voided' })
      .where(eq(transactions.id, txId));
  });

  it('keeps transaction_deletions append-only', async () => {
    const { seeded, txId } = await shiftWithTransaction('paid');
    const userId = await ownerId(seeded.ownerEmail);
    const [row] = await env.handle.db
      .insert(transactionDeletions)
      .values({
        outletId: seeded.outletId,
        transactionId: txId,
        action: 'delete',
        reason: 'transaksi uji coba',
        actorUserId: userId,
      })
      .returning();
    const noReason = await violation(() =>
      env.handle.db.insert(transactionDeletions).values({
        outletId: seeded.outletId,
        transactionId: txId,
        action: 'delete',
        actorUserId: userId,
      }),
    );
    expect(noReason?.code).toBe('23514');
    const upd = await violation(() =>
      env.handle.db
        .update(transactionDeletions)
        .set({ reason: 'x' })
        .where(eq(transactionDeletions.id, row?.id ?? '')),
    );
    expect(upd?.code).toBe('23514');
    const del = await violation(() =>
      env.handle.db.delete(transactionDeletions).where(eq(transactionDeletions.id, row?.id ?? '')),
    );
    expect(del?.code).toBe('23514');
  });
});
