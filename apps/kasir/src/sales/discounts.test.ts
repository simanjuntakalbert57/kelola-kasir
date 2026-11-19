import type { Category, DiscountRule, Product, Transaction } from '@kelola-kasir/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createCatalogRepository, type CatalogRepository } from '../catalog/repository';
import { pullCatalog } from '../catalog/sync';
import { resetCatalog } from '../catalog/reset';
import { getMeta, META, setMeta } from '../db/meta';
import { migrate } from '../db/migrations';
import { createTestDb } from '../db/testDb';
import type { Db } from '../db/types';
import { buildReceiptLines, receiptText } from '../printing/layout';
import { loadLocalReceipt } from '../printing/localReceipt';
import { addProduct, emptyCart, setQuantity, summaryLabel, totalsOf, type Cart } from './cart';
import { createCashSale, type SaleContext } from './checkout';
import { discountBadge, priceCart, quoteProduct } from './pricing';
import { confirmQris, DiscountStaleError, startQris } from './qris';

const CTX: SaleContext = {
  outletCode: 'JUS1',
  deviceCode: 'K01',
  timeZone: 'Asia/Jakarta',
  shiftId: '0190aaaa-0000-7000-8000-000000000001',
  employee: { id: 'e1', name: 'Sari' },
};
// Thursday 14:30 WIB
const HAPPY = new Date('2026-11-19T07:30:00Z');
// Thursday 18:30 WIB, outside the happy hour
const EVENING = new Date('2026-11-19T11:30:00Z');

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  id: '00000000-0000-4000-8000-000000000001',
  version: 3,
  name: 'Promo Mangga',
  type: 'percent',
  value: 20,
  target_type: 'product',
  product_ids: ['p1'],
  category_ids: [],
  starts_on: '2026-11-01',
  ends_on: null,
  days_of_week: null,
  time_start: null,
  time_end: null,
  utc_offset_minutes: 420,
  ...over,
});
const happyHour = rule({
  id: '00000000-0000-4000-8000-000000000002',
  version: 1,
  name: 'Happy Hour Sore',
  type: 'amount',
  value: 3000,
  target_type: 'category',
  product_ids: [],
  category_ids: ['c1'],
  time_start: '14:00',
  time_end: '16:00',
});

const cat = (id: string, name: string): Category => ({ id, name, sort_order: 0 });
const prod = (id: string, name: string, price: number): Product => ({
  id,
  category_id: 'c1',
  name,
  price,
  is_active: true,
  is_sold_out: false,
  sort_order: 0,
});

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value');
  return value;
}

let db: Db;
let catalog: CatalogRepository;
beforeEach(async () => {
  db = await createTestDb();
  catalog = createCatalogRepository(db);
  await catalog.applyChanges({
    categories: [cat('c1', 'Jus')],
    products: [prod('p1', 'Jus Mangga', 15000), prod('p2', 'Jus Alpukat', 18000)],
    discounts: [rule(), happyHour],
  });
});

async function cartOf(rules: readonly DiscountRule[], at: Date, ...items: [string, number][]) {
  const list = await catalog.listProducts();
  let cart: Cart = emptyCart;
  for (const [id, qty] of items) {
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error(id);
    cart = setQuantity(addProduct(cart, p), id, qty);
  }
  return priceCart(cart, rules, at);
}

describe('pricing the cart', () => {
  it('picks the best discount per line and sums them into the transaction discount', async () => {
    const rules = await catalog.listDiscountRules();
    // Mangga: 20% = 3.000 vs Rp3.000 happy hour: tie → smallest id (Promo Mangga). Alpukat: only the happy hour.
    const cart = await cartOf(rules, HAPPY, ['p1', 2], ['p2', 1]);
    expect(cart.lines[0]?.discount).toMatchObject({ name: 'Promo Mangga', perUnit: 3000 });
    expect(cart.lines[1]?.discount).toMatchObject({ name: 'Happy Hour Sore', perUnit: 3000 });
    const totals = totalsOf(cart);
    expect(totals.subtotal).toBe(48000);
    expect(totals.discountAmount).toBe(9000);
    expect(totals.total).toBe(39000);
    expect(summaryLabel(cart, (n) => `Rp${n}`)).toBe('3 item · Hemat Rp9000 · Rp39000');
  });

  it('re-prices when the clock leaves the happy hour, without a tap', async () => {
    const rules = await catalog.listDiscountRules();
    const during = await cartOf(rules, HAPPY, ['p2', 1]);
    expect(totalsOf(during).total).toBe(15000);
    const after = priceCart(during, rules, EVENING);
    expect(after.lines[0]?.discount).toBeUndefined();
    expect(totalsOf(after).total).toBe(18000);
    // Nothing changed: the same object, so a minute tick does not re-render.
    expect(priceCart(after, rules, EVENING)).toBe(after);
  });

  it('keeps quantity changes in step and never lets the price go below Rp0', async () => {
    const big = rule({ type: 'amount', value: 50000, product_ids: ['p1'] });
    const cart = await cartOf([big], HAPPY, ['p1', 3]);
    expect(totalsOf(cart).total).toBe(0);
    expect(totalsOf(cart).discountAmount).toBe(45000);
  });

  it('shows the card badge as % or Rp', () => {
    const quote = quoteProduct([rule()], { id: 'p1', categoryId: 'c1', price: 15000 }, HAPPY);
    expect(quote?.finalUnitPrice).toBe(12000);
    expect(discountBadge(rule(), 3000, (n) => `Rp${n}`)).toBe('−20%');
    expect(discountBadge(happyHour, 3000, (n) => `Rp${n}`)).toBe('−Rp3000');
  });
});

describe('discount rules offline', () => {
  it('survives a restart: rules come from SQLite, no network needed', async () => {
    const rules = await catalog.listDiscountRules();
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.id === happyHour.id)).toEqual(happyHour);
  });

  it('upserts a new version and drops a tombstoned rule', async () => {
    await catalog.applyChanges({ discounts: [rule({ version: 4, value: 30 })] });
    await catalog.applyChanges({ deleted: [{ entity: 'discount', id: happyHour.id }] });
    const rules = await catalog.listDiscountRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ version: 4, value: 30 });
  });

  it('pull stores changes.discounts and reports a change', async () => {
    const fresh = await createTestDb();
    const repo = createCatalogRepository(fresh);
    const api = {
      syncPull: vi.fn(async () => ({
        next_cursor: 'c1',
        has_more: false,
        changes: { discounts: [rule()] },
      })),
    };
    const res = await pullCatalog(api as never, fresh, repo);
    expect(res.changed).toBe(true);
    expect(await repo.listDiscountRules()).toHaveLength(1);
  });

  it('migration clears the sync cursor so the next pull is a full snapshot', async () => {
    const old = await createTestDb();
    await old.exec('DROP TABLE discounts');
    await old.exec('ALTER TABLE transactions DROP COLUMN discount_names');
    await old.exec('PRAGMA user_version = 2');
    await setMeta(old, META.cursor, 'moved-past-discounts');
    await migrate(old);
    expect(await getMeta(old, META.cursor)).toBeNull();
    expect(await old.all('SELECT * FROM discounts')).toEqual([]);
  });

  it('re-pairing wipes the rules with the catalog', async () => {
    await resetCatalog(db);
    expect(await catalog.listDiscountRules()).toEqual([]);
  });
});

describe('checkout with discounts', () => {
  it('sends discount_id, version and amount per item; transaction discount = Σ; unit_price stays normal', async () => {
    const rules = await catalog.listDiscountRules();
    const cart = await cartOf(rules, HAPPY, ['p1', 2], ['p2', 1]);
    await createCashSale(db, CTX, cart, 50000, HAPPY);
    const row = (await db.all<{ payload: string }>('SELECT payload FROM outbox'))[0];
    const body = JSON.parse(row?.payload ?? '{}');
    expect(body.items[0]).toMatchObject({
      unit_price: 15000,
      quantity: 2,
      line_total: 30000,
      discount_id: rule().id,
      discount_version: 3,
      discount_amount: 6000,
    });
    expect(body.items[1]).toMatchObject({ discount_id: happyHour.id, discount_amount: 3000 });
    expect(body).toMatchObject({
      client_created_at: HAPPY.toISOString(),
      subtotal: 48000,
      discount_amount: 9000,
      total: 39000,
    });
  });

  it('a cart without a discount sends no discount fields (old shape)', async () => {
    const cart = await cartOf([], HAPPY, ['p1', 1]);
    await createCashSale(db, CTX, cart, 15000, HAPPY);
    const row = (await db.all<{ payload: string }>('SELECT payload FROM outbox'))[0];
    const body = JSON.parse(row?.payload ?? '{}');
    expect(body.items[0]).not.toHaveProperty('discount_id');
    expect(body.discount_amount).toBe(0);
  });

  it('prints the promo line per item and "Hemat Rp X" from SQLite alone', async () => {
    const rules = await catalog.listDiscountRules();
    const cart = await cartOf(rules, HAPPY, ['p1', 2], ['p2', 1]);
    const sale = await createCashSale(db, CTX, cart, 50000, HAPPY);
    const receipt = await loadLocalReceipt(db, sale.id, {
      settings: null,
      outletName: 'Jus Bu Rini',
      timeZone: 'Asia/Jakarta',
    });
    const text = receiptText(must(receipt));
    expect(text).toContain('Promo Mangga');
    expect(text).toContain('-6.000');
    expect(text).toContain('Happy Hour Sore');
    expect(text).toContain('Subtotal');
    expect(text).toContain('Diskon');
    expect(text).toContain('Hemat Rp9.000');
    expect(buildReceiptLines(must(receipt)).every((l) => l.text.length <= 32)).toBe(true);
  });

  it('a receipt without discount has no promo or Hemat line', async () => {
    const cart = await cartOf([], HAPPY, ['p1', 1]);
    const sale = await createCashSale(db, CTX, cart, 15000, HAPPY);
    const receipt = await loadLocalReceipt(db, sale.id, {
      settings: null,
      outletName: 'X',
      timeZone: 'Asia/Jakarta',
    });
    expect(receiptText(must(receipt))).not.toContain('Hemat');
  });
});

describe('QRIS DISCOUNT_STALE', () => {
  const stale = new ApiError(422, 'DISCOUNT_STALE', 'Harga promo berubah');

  it('is surfaced as DiscountStaleError so the screen can refresh and re-price', async () => {
    const rules = await catalog.listDiscountRules();
    const cart = await cartOf(rules, HAPPY, ['p1', 1]);
    const api = {
      createTransaction: vi.fn().mockRejectedValue(stale),
      confirmPayment: vi.fn(),
      cancelPayment: vi.fn(),
    };
    await expect(startQris(api, db, CTX, cart, HAPPY)).rejects.toBeInstanceOf(DiscountStaleError);
    expect(await db.all('SELECT 1 FROM transactions')).toHaveLength(0);
  });

  it('after the catalog pull removes the promo, the retry carries the new total and no discount', async () => {
    const rules = await catalog.listDiscountRules();
    const first = await cartOf(rules, HAPPY, ['p1', 1]);
    expect(totalsOf(first).total).toBe(12000);
    const sent: { total: number; items: Record<string, unknown>[] }[] = [];
    const serverTx = (b: { payment: { id: string } }) =>
      ({ id: 't', status: 'pending', payments: [{ id: b.payment.id }] }) as unknown as Transaction;
    const api = {
      createTransaction: vi
        .fn()
        .mockRejectedValueOnce(stale)
        .mockImplementation(
          async (b: {
            total: number;
            items: Record<string, unknown>[];
            payment: { id: string };
          }) => {
            sent.push(b);
            return serverTx(b);
          },
        ),
      confirmPayment: vi.fn(async () => ({ id: 't', status: 'paid' }) as Transaction),
      cancelPayment: vi.fn(),
    };
    await expect(startQris(api, db, CTX, first, HAPPY)).rejects.toBeInstanceOf(DiscountStaleError);
    // refreshPricing: the pull delivers a tombstone, rules reload, the cart is re-priced.
    await catalog.applyChanges({
      deleted: [
        { entity: 'discount', id: rule().id },
        { entity: 'discount', id: happyHour.id },
      ],
    });
    const repriced = priceCart(first, await catalog.listDiscountRules(), HAPPY);
    expect(totalsOf(repriced).total).toBe(15000);
    const session = await startQris(api, db, CTX, repriced, HAPPY);
    expect(sent[0]?.total).toBe(15000);
    expect(sent[0]?.items[0]).not.toHaveProperty('discount_id');
    await confirmQris(api, db, CTX, session);
    expect(await db.all("SELECT 1 FROM transactions WHERE method = 'qris'")).toHaveLength(1);
  });

  it('other API errors are not mistaken for a stale promo', async () => {
    const api = {
      createTransaction: vi.fn().mockRejectedValue(new ApiError(422, 'DISCOUNT_INVALID', 'x')),
      confirmPayment: vi.fn(),
      cancelPayment: vi.fn(),
    };
    const cart = await cartOf([], HAPPY, ['p1', 1]);
    await expect(startQris(api, db, CTX, cart, HAPPY)).rejects.toBeInstanceOf(ApiError);
  });
});
