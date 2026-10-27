import type { Category, Product, SyncMutation, Transaction } from '@kelola-kasir/contracts';
import { MoneyError } from '@kelola-kasir/money';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../api/client';
import { createCatalogRepository, type CatalogRepository } from '../catalog/repository';
import { pullCatalog } from '../catalog/sync';
import type { Db } from '../db/types';
import { createTestDb } from '../db/testDb';
import { pendingCount, pushOutbox } from '../sync/outbox';
import { addProduct, emptyCart, quickCashAmounts, summaryLabel, totalsOf, type Cart } from './cart';
import { createCashSale, EmptyCartError, type SaleContext } from './checkout';
import { formatNumber, localDay } from './number';
import {
  cancelQris,
  confirmQris,
  formatCountdown,
  qrisAvailability,
  remainingMs,
  startQris,
} from './qris';

const CTX: SaleContext = {
  outletCode: 'JUS1',
  deviceCode: 'K01',
  timeZone: 'Asia/Jakarta',
  shiftId: '0190aaaa-0000-7000-8000-000000000001',
  employee: { id: 'e1', name: 'Sari' },
};
const T = new Date('2026-10-26T03:00:00Z'); // 10:00 WIB

const cat = (id: string, name: string, sort_order = 0): Category => ({ id, name, sort_order });
const prod = (id: string, name: string, price: number, extra: Partial<Product> = {}): Product => ({
  id,
  category_id: 'c1',
  name,
  price,
  is_active: true,
  is_sold_out: false,
  sort_order: 0,
  ...extra,
});

let db: Db;
let catalog: CatalogRepository;
beforeEach(async () => {
  db = await createTestDb();
  catalog = createCatalogRepository(db, () => T.getTime());
  await catalog.applyChanges({
    categories: [cat('c1', 'Jus', 1), cat('c2', 'Smoothies', 2), cat('c3', 'Kosong', 3)],
    products: [
      prod('p1', 'Jus Jeruk', 13000),
      prod('p2', 'Jus Alpukat', 18000),
      prod('p3', 'Jus Habis', 12000, { is_sold_out: true }),
      prod('p4', 'Mangga', 15000, { category_id: 'c2' }),
      prod('p5', 'Mati', 9000, { is_active: false, category_id: 'c3' }),
    ],
  });
});

const product = async (id: string) => {
  const p = (await catalog.listProducts()).find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
async function cartOf(...entries: [string, number][]): Promise<Cart> {
  let cart = emptyCart;
  for (const [id, qty] of entries)
    for (let i = 0; i < qty; i++) cart = addProduct(cart, await product(id));
  return cart;
}

describe('catalog repository (M-2, M-6)', () => {
  it('hides sold-out and inactive products, and categories with nothing visible', async () => {
    expect((await catalog.listProducts()).map((p) => p.name)).toEqual([
      'Jus Alpukat',
      'Jus Jeruk',
      'Mangga',
    ]);
    expect((await catalog.listCategories()).map((c) => c.name)).toEqual(['Jus', 'Smoothies']);
  });

  it('filters by category and searches by name', async () => {
    expect((await catalog.listProducts({ category: 'c2' })).map((p) => p.id)).toEqual(['p4']);
    expect((await catalog.listProducts({ search: 'alp' })).map((p) => p.id)).toEqual(['p2']);
    expect(await catalog.listProducts({ search: '%' })).toEqual([]);
  });

  it('applies updates and tombstones; a product marked sold out disappears', async () => {
    await catalog.applyChanges({
      products: [prod('p1', 'Jus Jeruk', 14000, { is_sold_out: true })],
      deleted: [{ entity: 'product', id: 'p4' }],
    });
    expect((await catalog.listProducts()).map((p) => p.id)).toEqual(['p2']);
  });

  it('Favorit ranks by units sold on this device, falling back to catalog order', async () => {
    expect((await catalog.listProducts({ category: 'favorit' })).map((p) => p.id)[0]).toBe('p2');
    await createCashSale(db, CTX, await cartOf(['p4', 3], ['p1', 1]), 100000, T);
    expect((await catalog.listProducts({ category: 'favorit' })).map((p) => p.id)).toEqual([
      'p4',
      'p1',
      'p2',
    ]);
  });
});

describe('pullCatalog', () => {
  it('pages through changes, stores the cursor, and reports the open shift', async () => {
    const syncPull = vi
      .fn()
      .mockResolvedValueOnce({
        next_cursor: 'c-1',
        has_more: true,
        changes: { categories: [cat('x', 'Baru')] },
      })
      .mockResolvedValueOnce({
        next_cursor: 'c-2',
        has_more: false,
        changes: { products: [prod('px', 'Baru', 1000, { category_id: 'x' })], settings: null },
        current_shift: null,
      });
    const res = await pullCatalog({ syncPull }, db, catalog);
    expect(syncPull.mock.calls.map((c) => c[0])).toEqual([undefined, 'c-1']);
    expect(res).toMatchObject({ deviceRevoked: false, currentShift: null, changed: true });
    await pullCatalog(
      { syncPull: vi.fn().mockResolvedValue({ next_cursor: 'c-2', has_more: false, changes: {} }) },
      db,
      catalog,
    );
    const again = vi.fn().mockResolvedValue({ next_cursor: 'c-2', has_more: false, changes: {} });
    await pullCatalog({ syncPull: again }, db, catalog);
    expect(again).toHaveBeenCalledWith('c-2');
  });

  it('stops and flags a revoked device without touching local data', async () => {
    const syncPull = vi
      .fn()
      .mockResolvedValue({ next_cursor: 'z', has_more: false, changes: {}, device_revoked: true });
    expect((await pullCatalog({ syncPull }, db, catalog)).deviceRevoked).toBe(true);
  });
});

describe('cart (M-8)', () => {
  it('tap adds +1 and sums with packages/money', async () => {
    const cart = await cartOf(['p1', 2], ['p2', 1]);
    expect(cart.lines.map((l) => [l.name, l.quantity])).toEqual([
      ['Jus Jeruk', 2],
      ['Jus Alpukat', 1],
    ]);
    expect(totalsOf(cart).total).toBe(44000);
    expect(summaryLabel(cart, (n) => `Rp${n}`)).toBe('3 item · Rp44000');
  });

  it('quick cash amounts start above the total', () => {
    expect(quickCashAmounts(42000)).toEqual([45000, 50000, 100000]);
    expect(quickCashAmounts(42000).every((n) => n > 42000)).toBe(true);
  });
});

describe('cash sale + outbox (M-9)', () => {
  it('stores the sale offline with a client number and one outbox row', async () => {
    const sale = await createCashSale(db, CTX, await cartOf(['p1', 3]), 50000, T);
    expect(sale).toMatchObject({ total: 39000, change: 11000, number: 'JUS1-K01-261026-0001' });
    expect(sale.number).toMatch(/^[A-Z0-9]{2,6}-[A-Z0-9]{3}-[0-9]{6}-[0-9]{4}$/);
    const second = await createCashSale(db, CTX, await cartOf(['p2', 1]), 18000, T);
    expect(second.number).toBe('JUS1-K01-261026-0002');
    expect(await pendingCount(db)).toBe(2);
  });

  it('rejects short cash and empty carts without writing anything', async () => {
    await expect(createCashSale(db, CTX, await cartOf(['p1', 1]), 5000, T)).rejects.toBeInstanceOf(
      MoneyError,
    );
    await expect(createCashSale(db, CTX, emptyCart, 5000, T)).rejects.toBeInstanceOf(
      EmptyCartError,
    );
    expect(await pendingCount(db)).toBe(0);
    expect(await db.all('SELECT 1 FROM transactions')).toHaveLength(0);
  });

  it('numbers reset per local day (WIB) and follow the contract pattern', () => {
    expect(localDay(new Date('2026-10-25T18:00:00Z'), 'Asia/Jakarta')).toBe('261026');
    expect(formatNumber('jus1', 'k01', '261026', 42)).toBe('JUS1-K01-261026-0042');
  });

  it('push: airplane mode keeps the queue, back online it syncs and empties the banner', async () => {
    await createCashSale(db, CTX, await cartOf(['p1', 1]), 13000, T);
    await createCashSale(db, CTX, await cartOf(['p2', 1]), 18000, T);
    const offline = { syncPush: vi.fn().mockRejectedValue(new NetworkError()) };
    await expect(pushOutbox(offline, db)).rejects.toBeInstanceOf(NetworkError);
    expect(await pendingCount(db)).toBe(2);

    const online = {
      syncPush: vi.fn(async (ms: SyncMutation[]) => ({
        results: ms.map((m, i) => ({
          id: m.id,
          status: i === 0 ? ('applied' as const) : ('duplicate' as const),
        })),
      })),
    };
    const res = await pushOutbox(online, db);
    const sent = online.syncPush.mock.calls[0]?.[0] ?? [];
    expect(sent.map((m) => m.type)).toEqual(['transaction.create', 'transaction.create']);
    expect(sent[0]).toMatchObject({
      employee_id: 'e1',
      payload: { number: 'JUS1-K01-261026-0001' },
    });
    expect(res).toMatchObject({ sent: 2, applied: 2, remaining: 0 });
    expect(await pendingCount(db)).toBe(0);
    expect(
      (await db.all<{ sync_state: string }>('SELECT sync_state FROM transactions')).every(
        (r) => r.sync_state === 'synced',
      ),
    ).toBe(true);
  });

  it('push: a rejected mutation is parked and does not block later ones', async () => {
    await createCashSale(db, CTX, await cartOf(['p1', 1]), 13000, T);
    const api = {
      syncPush: vi.fn(async (ms: SyncMutation[]) => ({
        results: ms.map((m) => ({
          id: m.id,
          status: 'rejected' as const,
          code: 'SHIFT_NOT_FOUND',
        })),
      })),
    };
    expect(await pushOutbox(api, db)).toMatchObject({ rejected: 1, remaining: 0 });
    expect(await pushOutbox(api, db)).toMatchObject({ sent: 0 });
    expect(api.syncPush).toHaveBeenCalledTimes(1);
  });
});

describe('QRIS (M-10)', () => {
  const serverTx = (body: { payment: { id: string } }): Transaction =>
    ({
      id: 't',
      status: 'pending',
      payments: [
        {
          id: body.payment.id,
          method: 'qris',
          confirmation_mode: 'manual',
          qr_payload: 'QR',
          expires_at: '2026-10-26T03:15:00.000Z',
        },
      ],
    }) as unknown as Transaction;

  it('creates a pending charge online, confirms it, and records it locally (never in the outbox)', async () => {
    const api = {
      createTransaction: vi.fn(async (b: { payment: { id: string } }) => serverTx(b)),
      confirmPayment: vi.fn(async () => ({ id: 't', status: 'paid' }) as Transaction),
      cancelPayment: vi.fn(),
    };
    const session = await startQris(api, db, CTX, await cartOf(['p2', 2]), T);
    expect(api.createTransaction.mock.calls[0]?.[0]).toMatchObject({
      total: 36000,
      payment: { method: 'qris' },
    });
    expect(session.expiresAt).toBe(Date.parse('2026-10-26T03:15:00.000Z'));
    expect(remainingMs(session.expiresAt, T.getTime())).toBe(15 * 60_000);
    expect(formatCountdown(remainingMs(session.expiresAt, T.getTime() + 61_000))).toBe('13:59');
    await confirmQris(api, db, CTX, session);
    expect(await pendingCount(db)).toBe(0);
    expect(
      await db.all("SELECT 1 FROM transactions WHERE method = 'qris' AND status = 'paid'"),
    ).toHaveLength(1);
  });

  it('cancel calls the API and leaves no local sale', async () => {
    const api = {
      createTransaction: vi.fn(async (b: { payment: { id: string } }) => serverTx(b)),
      confirmPayment: vi.fn(),
      cancelPayment: vi.fn(async () => ({ id: 't', status: 'cancelled' }) as Transaction),
    };
    const session = await startQris(api, db, CTX, await cartOf(['p1', 1]), T);
    await cancelQris(api, session);
    expect(api.cancelPayment).toHaveBeenCalledWith(session.payment.id);
    expect(await db.all('SELECT 1 FROM transactions')).toHaveLength(0);
  });

  it('is disabled offline with a hint', () => {
    expect(qrisAvailability(false)).toMatchObject({ enabled: false });
    expect(qrisAvailability(true).enabled).toBe(true);
  });
});

describe('cart editing', () => {
  it('sets quantity, note, label, removal; quantity 0 drops the line; cap at 999', async () => {
    const { setNote, setQuantity, removeLine, setCustomerLabel } = await import('./cart');
    let cart = await cartOf(['p1', 1], ['p2', 1]);
    cart = setQuantity(cart, 'p1', 5000);
    expect(cart.lines[0]?.quantity).toBe(999);
    cart = setNote(cart, 'p1', '  less ice  ');
    expect(cart.lines[0]?.note).toBe('  less ice  '); // trimmed at checkout, not while typing
    cart = setNote(cart, 'p1', '');
    expect(cart.lines[0]).not.toHaveProperty('note');
    cart = setQuantity(cart, 'p2', 0);
    expect(cart.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(setCustomerLabel(cart, 'x'.repeat(60)).customerLabel).toHaveLength(40);
    expect(removeLine(cart, 'p1').lines).toEqual([]);
  });
});
