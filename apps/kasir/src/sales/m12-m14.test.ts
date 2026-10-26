import type { TransactionSummary } from '@kelola-kasir/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { createCatalogRepository } from '../catalog/repository';
import { createTestDb } from '../db/testDb';
import type { Db } from '../db/types';
import { loadLocalReceipt } from '../printing/localReceipt';
import {
  cashDifference,
  closeShift,
  localShiftTotals,
  noteRequired,
  OfflineCloseNotConfirmed,
} from '../shift/close';
import { pendingCount, pushOutbox, resetDeferred } from '../sync/outbox';
import { addProduct, emptyCart } from './cart';
import { createCashSale, type SaleContext } from './checkout';
import {
  canReprint,
  filterByMethod,
  listLocalHistory,
  mergeRemote,
  storeRemoteStatuses,
} from './history';
import { requestVoid, VoidError } from './void';

const SHIFT = { id: '0190aaaa-0000-7000-8000-000000000001', opening_cash: 200000 };
const CTX: SaleContext = {
  outletCode: 'JUS1',
  deviceCode: 'K01',
  timeZone: 'Asia/Jakarta',
  shiftId: SHIFT.id,
  employee: { id: 'e1', name: 'Sari' },
};
const T = new Date('2026-10-26T07:32:00Z'); // 14:32 WIB

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function sell(price: number, qty: number, at = T, ctx = CTX) {
  const cart = addProduct(emptyCart, { id: `p${price}`, name: `Jus ${price}`, price } as never);
  const lines = cart.lines.map((l) => ({ ...l, quantity: qty }));
  return createCashSale(db, ctx, { ...cart, lines }, price * qty, at);
}

describe('local receipt (prints offline from SQLite + cached settings)', () => {
  it('builds the receipt with store header/footer and the unsynced mark', async () => {
    const sale = await sell(12000, 2);
    const receipt = await loadLocalReceipt(db, sale.id, {
      settings: {
        display_name: 'Jus Albert',
        receipt_header: 'IG @jusalbert',
        receipt_footer: 'Terima kasih!',
        address: 'Medan',
      } as never,
      outletName: 'Fallback',
      timeZone: 'Asia/Jakarta',
    });
    expect(receipt).toMatchObject({
      number: sale.number,
      cashierName: 'Sari',
      total: 24000,
      method: 'cash',
      cashTendered: 24000,
      change: 0,
      pendingSync: true,
      status: 'paid',
    });
    expect(receipt?.store).toMatchObject({ name: 'Jus Albert', footer: 'Terima kasih!' });
    expect(receipt?.items).toEqual([
      { name: 'Jus 12000', quantity: 2, unitPrice: 12000, lineTotal: 24000 },
    ]);
  });

  it('falls back to the outlet name before settings ever synced; unknown id is null', async () => {
    const sale = await sell(5000, 1);
    const ctx = { settings: null, outletName: 'Outlet Medan', timeZone: 'Asia/Jakarta' };
    expect((await loadLocalReceipt(db, sale.id, ctx))?.store.name).toBe('Outlet Medan');
    expect(await loadLocalReceipt(db, 'nope', ctx)).toBeNull();
  });
});

describe('history (M-12)', () => {
  it('lists this shift newest first with unsynced badge, and filters by method', async () => {
    await sell(10000, 1, new Date('2026-10-26T07:00:00Z'));
    await sell(20000, 1, new Date('2026-10-26T07:30:00Z'));
    await sell(5000, 1, new Date('2026-10-26T07:40:00Z'), { ...CTX, shiftId: 'other-shift' });
    const rows = await listLocalHistory(db, {
      scope: 'shift',
      shiftId: SHIFT.id,
      timeZone: 'Asia/Jakarta',
    });
    expect(rows.map((r) => r.total)).toEqual([20000, 10000]);
    expect(rows[0]).toMatchObject({ sync: 'pending', local: true, itemCount: 1, method: 'cash' });
    expect(filterByMethod(rows, 'qris')).toEqual([]);
    expect(filterByMethod(rows, 'cash')).toHaveLength(2);
  });

  it('"today" uses the outlet-local day, not UTC', async () => {
    const now = new Date('2026-10-26T17:30:00Z'); // 00:30 on the 27th in WIB
    await sell(10000, 1, new Date('2026-10-26T16:00:00Z'), CTX); // 26th 23:00 WIB
    await sell(20000, 1, new Date('2026-10-26T17:10:00Z'), CTX); // 27th 00:10 WIB
    const rows = await listLocalHistory(db, {
      scope: 'today',
      shiftId: SHIFT.id,
      timeZone: 'Asia/Jakarta',
      now,
    });
    expect(rows.map((r) => r.total)).toEqual([20000]);
  });

  it('merges other devices and server status changes, but not over unsynced rows', async () => {
    const a = await sell(10000, 1);
    await pushOutbox(
      { syncPush: async () => ({ results: [{ id: a.id, status: 'applied' }] }) },
      db,
    );
    const b = await sell(20000, 1, new Date('2026-10-26T07:40:00Z'));
    const local = await listLocalHistory(db, {
      scope: 'shift',
      shiftId: SHIFT.id,
      timeZone: 'Asia/Jakarta',
    });
    const remote = [
      { id: a.id, status: 'void_requested', number: a.number },
      { id: b.id, status: 'voided', number: b.number },
      {
        id: 'other',
        number: 'JUS1-K02-261026-0001',
        status: 'paid',
        payment_method: 'qris',
        total: 18000,
        item_count: 2,
        employee: { id: 'e2', name: 'Budi' },
        client_created_at: '2026-10-26T07:50:00Z',
      },
    ] as unknown as TransactionSummary[];
    const merged = mergeRemote(local, remote);
    expect(merged.map((r) => [r.total, r.status, r.local])).toEqual([
      [18000, 'paid', false],
      [20000, 'paid', true], // still queued: local status wins
      [10000, 'void_requested', true], // synced: server wins
    ]);
    await storeRemoteStatuses(db, remote);
    const [row] = await db.all<{ status: string }>('SELECT status FROM transactions WHERE id = ?', [
      a.id,
    ]);
    expect(row?.status).toBe('void_requested');
  });

  it('allows reprint in every status but cancelled', () => {
    expect(['paid', 'void_requested', 'voided'].every(canReprint)).toBe(true);
    expect(canReprint('cancelled')).toBe(false);
  });
});

describe('void request (M-14)', () => {
  it('marks the sale "Menunggu void" at once and queues the request behind the sale', async () => {
    const sale = await sell(10000, 1);
    await requestVoid(db, {
      transactionId: sale.id,
      reason: '  Salah pesan menu ',
      employeeId: 'e1',
    });
    const [row] = await db.all<{ status: string; void_reason: string }>(
      'SELECT status, void_reason FROM transactions WHERE id = ?',
      [sale.id],
    );
    expect(row).toEqual({ status: 'void_requested', void_reason: 'Salah pesan menu' });
    const queue = await db.all<{ type: string; payload: string }>(
      'SELECT type, payload FROM outbox ORDER BY seq',
    );
    expect(queue.map((q) => q.type)).toEqual(['transaction.create', 'void_request.create']);
    expect(JSON.parse(queue[1]?.payload ?? '{}')).toMatchObject({
      transaction_id: sale.id,
      reason: 'Salah pesan menu',
    });
    expect(JSON.parse(queue[1]?.payload ?? '{}')).not.toHaveProperty('id');
  });

  it('needs a reason and a paid transaction', async () => {
    const sale = await sell(10000, 1);
    await expect(
      requestVoid(db, { transactionId: sale.id, reason: 'ab', employeeId: 'e1' }),
    ).rejects.toThrow(VoidError);
    await requestVoid(db, { transactionId: sale.id, reason: 'salah input', employeeId: 'e1' });
    await expect(
      requestVoid(db, { transactionId: sale.id, reason: 'sekali lagi', employeeId: 'e1' }),
    ).rejects.toThrow('lunas');
  });

  it('keeps the request queued while the server does not support it yet', async () => {
    const sale = await sell(10000, 1);
    await requestVoid(db, { transactionId: sale.id, reason: 'salah input', employeeId: 'e1' });
    const syncPush = vi.fn(
      async ({ mutations }: { mutations: { id: string; type: string }[] }) => ({
        results: mutations.map((m) =>
          m.type === 'void_request.create'
            ? { id: m.id, status: 'rejected' as const, code: 'UNSUPPORTED_MUTATION' }
            : { id: m.id, status: 'applied' as const },
        ),
      }),
    );
    const api = { syncPush: (mutations: never) => syncPush({ mutations }) };
    await pushOutbox(api as never, db);
    expect(await pendingCount(db)).toBe(1); // the void request is still waiting
    const again = await pushOutbox(api as never, db);
    expect(again.sent).toBe(0); // not hammered every tick
    await resetDeferred(db);
    expect((await pushOutbox(api as never, db)).sent).toBe(1); // retried after restart
  });
});

describe('sold-out (M-14)', () => {
  it('hides the item at once, queues the mutation, and a stale pull cannot undo it', async () => {
    const catalog = createCatalogRepository(db);
    const product = {
      id: 'p1',
      category_id: 'c1',
      name: 'Jeruk',
      price: 12000,
      is_active: true,
      is_sold_out: false,
      sort_order: 0,
    } as never;
    await catalog.applyChanges({
      categories: [{ id: 'c1', name: 'Jus', sort_order: 0 }],
      products: [product],
    });
    await catalog.setSoldOut('p1', true, 'e1');
    expect(await catalog.listProducts()).toHaveLength(0);
    expect((await catalog.listSoldOut()).map((p) => p.id)).toEqual(['p1']);
    await catalog.applyChanges({ products: [product] }); // server still says available
    expect(await catalog.listProducts()).toHaveLength(0);
    const [m] = await db.all<{ type: string; payload: string }>('SELECT type, payload FROM outbox');
    expect(m?.type).toBe('product.mark_sold_out');
    expect(JSON.parse(m?.payload ?? '{}')).toEqual({ product_id: 'p1', is_sold_out: true });
    await catalog.setSoldOut('p1', false, 'e1');
    expect(await catalog.listProducts()).toHaveLength(1);
  });
});

describe('close shift (M-13)', () => {
  it('computes expected cash locally like the server (paid + void_requested)', async () => {
    const a = await sell(10000, 1);
    await sell(20000, 1);
    await requestVoid(db, { transactionId: a.id, reason: 'salah input', employeeId: 'e1' });
    const t = await localShiftTotals(db, SHIFT);
    expect(t).toMatchObject({
      cashSales: 30000,
      expectedCash: 230000,
      transactionCount: 2,
      pendingVoidCount: 1,
      pendingVoidAmount: 10000,
    });
    expect(cashDifference(225000, 230000)).toBe(-5000);
    expect(noteRequired(-5000)).toBe(true);
    expect(noteRequired(0)).toBe(false);
  });

  const summary = {
    shift: { id: SHIFT.id, opening_cash: 200000 },
    total_cash_sales: 30000,
    total_qris_sales: 0,
    transaction_count: 2,
    expected_cash: 230000,
    pending_void_count: 0,
    pending_void_amount: 0,
    voided_count: 0,
    voided_amount: 0,
  };

  it('closes online when nothing is queued', async () => {
    const api = { closeShift: vi.fn(async () => summary as never) };
    const out = await closeShift(
      { api, db },
      { shift: SHIFT, employeeId: 'e1', actualCash: 230000, allowOffline: false },
    );
    expect(out.mode).toBe('online');
    expect(api.closeShift).toHaveBeenCalledWith(
      SHIFT.id,
      expect.objectContaining({ actual_cash: 230000 }),
    );
    expect(await pendingCount(db)).toBe(0);
  });

  it('offline: needs the strong-warning confirmation, then queues shift.close behind the sales', async () => {
    await sell(10000, 1);
    const api = { closeShift: vi.fn(async () => Promise.reject(new NetworkError())) };
    const input = {
      shift: SHIFT,
      employeeId: 'e1',
      actualCash: 205000,
      note: ' kurang ',
      allowOffline: false,
    };
    await expect(closeShift({ api, db }, input)).rejects.toThrow(OfflineCloseNotConfirmed);
    expect(await pendingCount(db)).toBe(1);
    const out = await closeShift({ api, db }, { ...input, allowOffline: true });
    expect(out).toMatchObject({ mode: 'queued', unsynced: 1 });
    const queue = await db.all<{ type: string; payload: string }>(
      'SELECT type, payload FROM outbox ORDER BY seq',
    );
    expect(queue.map((q) => q.type)).toEqual(['transaction.create', 'shift.close']);
    expect(JSON.parse(queue[1]?.payload ?? '{}')).toMatchObject({
      shift_id: SHIFT.id,
      actual_cash: 205000,
      closing_note: 'kurang',
      closed_offline: true,
      unsynced_count: 1,
    });
  });

  it('a deferred void request does not push an online close onto the offline path', async () => {
    const sale = await sell(10000, 1);
    await pushOutbox(
      { syncPush: async () => ({ results: [{ id: sale.id, status: 'applied' }] }) },
      db,
    );
    await requestVoid(db, { transactionId: sale.id, reason: 'salah input', employeeId: 'e1' });
    await pushOutbox(
      {
        syncPush: async (mutations: { id: string }[]) => ({
          results: mutations.map((m) => ({
            id: m.id,
            status: 'rejected' as const,
            code: 'UNSUPPORTED_MUTATION',
          })),
        }),
      } as never,
      db,
    );
    expect(await pendingCount(db)).toBe(1); // the void is still pending
    const api = {
      closeShift: vi.fn(async () => {
        throw new ApiError(409, 'PENDING_QRIS_EXISTS', 'pending qris');
      }),
    };
    await expect(
      closeShift(
        { api, db },
        { shift: SHIFT, employeeId: 'e1', actualCash: 1, allowOffline: false },
      ),
    ).rejects.toMatchObject({ code: 'PENDING_QRIS_EXISTS' });
    expect(api.closeShift).toHaveBeenCalledTimes(1); // online path was taken and its check ran
    expect((await db.all("SELECT id FROM outbox WHERE type = 'shift.close'")).length).toBe(0);
  });

  it('with sales still queued it does not close online ahead of them', async () => {
    await sell(10000, 1);
    const api = { closeShift: vi.fn() };
    await expect(
      closeShift(
        { api, db },
        { shift: SHIFT, employeeId: 'e1', actualCash: 1, allowOffline: false },
      ),
    ).rejects.toThrow(OfflineCloseNotConfirmed);
    expect(api.closeShift).not.toHaveBeenCalled();
  });

  it('surfaces PENDING_QRIS_EXISTS instead of queuing', async () => {
    const api = {
      closeShift: vi.fn(async () => {
        throw new ApiError(409, 'PENDING_QRIS_EXISTS', 'pending qris');
      }),
    };
    await expect(
      closeShift(
        { api, db },
        { shift: SHIFT, employeeId: 'e1', actualCash: 1, allowOffline: true },
      ),
    ).rejects.toMatchObject({ code: 'PENDING_QRIS_EXISTS' });
    expect(await pendingCount(db)).toBe(0);
  });
});
