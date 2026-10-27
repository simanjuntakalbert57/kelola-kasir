import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/testDb';
import type { CatalogProduct } from '../catalog/repository';
import {
  addProduct,
  badgeLabel,
  cartAfterPayment,
  clearCartIfConfirmed,
  emptyCart,
  itemCount,
  NOTE_MAX,
  payAvailability,
  removeLine,
  setCustomerLabel,
  setNote,
  setQuantity,
  totalsOf,
  type Cart,
} from './cart';
import { createCashSale, type SaleContext } from './checkout';

const p = (id: string, price: number) => ({ id, name: id, price }) as unknown as CatalogProduct;

function cartOf(...entries: [string, number, number][]): Cart {
  let c = emptyCart;
  for (const [id, price, qty] of entries) {
    c = addProduct(c, p(id, price));
    c = setQuantity(c, id, qty);
  }
  return c;
}

describe('Keranjang badge (TC-KRJ-01/02)', () => {
  it('counts items, not lines, and hides when empty', () => {
    const c = cartOf(['a', 13000, 6], ['b', 12000, 6]);
    expect(badgeLabel(itemCount(c))).toBe('12');
    expect(badgeLabel(itemCount(removeLine(c, 'a')))).toBe('6');
    expect(badgeLabel(itemCount(emptyCart))).toBeNull();
  });
  it('caps at 99+', () => {
    expect(badgeLabel(99)).toBe('99');
    expect(badgeLabel(100)).toBe('99+');
  });
});

describe('Keranjang content (TC-KRJ-07)', () => {
  it('subtotal = price x qty and total = sum of subtotals', () => {
    const c = cartOf(['a', 12500, 3], ['b', 7000, 2]);
    expect(totalsOf({ ...c, lines: c.lines.slice(0, 1) }).total).toBe(37500);
    expect(totalsOf(c).total).toBe(51500);
    expect(itemCount(c)).toBe(5);
  });
});

describe('Jual <-> Keranjang sync (TC-KRJ-04)', () => {
  it('one cart state: stepper change is reflected everywhere; qty 0 removes the line', () => {
    let c = cartOf(['a', 10000, 2]);
    c = setQuantity(c, 'a', 3);
    expect(itemCount(c)).toBe(3);
    expect(totalsOf(c).total).toBe(30000);
    c = setQuantity(c, 'a', 0);
    expect(c.lines).toHaveLength(0);
  });
});

describe('Pay button rules (TC-KRJ-09)', () => {
  const full = cartOf(['a', 10000, 1]);
  it('matrix of total x QRIS availability', () => {
    expect(payAvailability(emptyCart, true)).toEqual({ cash: false, qris: false });
    expect(payAvailability(emptyCart, false)).toEqual({ cash: false, qris: false });
    expect(payAvailability(full, true)).toEqual({ cash: true, qris: true });
    expect(payAvailability(full, false)).toEqual({ cash: true, qris: false });
  });
  it('zero-priced items cannot be paid in cash', () => {
    expect(payAvailability(cartOf(['free', 0, 2]), true).cash).toBe(false);
  });
});

describe('Notes keep spaces until checkout (review fix)', () => {
  it('setNote stores raw text, capped at NOTE_MAX', () => {
    const c = setNote(cartOf(['a', 5000, 1]), 'a', 'less ');
    expect(c.lines[0]?.note).toBe('less ');
    expect(setNote(c, 'a', 'x'.repeat(NOTE_MAX + 10)).lines[0]?.note).toHaveLength(NOTE_MAX);
    expect(setNote(c, 'a', '').lines[0]?.note).toBeUndefined();
  });
});

describe('Cash sale payload + cart reset (TC-KRJ-03, TC-KRJ-17)', () => {
  const CTX: SaleContext = {
    outletCode: 'JUS1',
    deviceCode: 'K01',
    timeZone: 'Asia/Jakarta',
    shiftId: '0190aaaa-0000-7000-8000-000000000001',
    employee: { id: 'e1', name: 'Sari' },
  };
  const T = new Date('2026-10-26T07:32:00Z');

  it('outbox body keeps price snapshot, qty, line_total, total, trimmed note and customer_label', async () => {
    const db = await createTestDb();
    let c = cartOf(['a', 12500, 3], ['b', 7000, 2]);
    c = setNote(c, 'a', '  less sugar ');
    c = setNote(c, 'b', '   ');
    c = setCustomerLabel(c, ' Budi ');
    await createCashSale(db, CTX, c, 100000, T);
    const rows = await db.all<{ payload: string }>('SELECT payload FROM outbox');
    expect(rows).toHaveLength(1);
    const body = JSON.parse(rows[0]?.payload ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ customer_label: 'Budi', total: 51500, subtotal: 51500 });
    const items = body.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      product_id: 'a',
      unit_price: 12500,
      quantity: 3,
      line_total: 37500,
      note: 'less sugar',
    });
    expect(items[1]).toMatchObject({ unit_price: 7000, quantity: 2, line_total: 14000 });
    expect(items[1]).not.toHaveProperty('note');
  });

  it('cart is empty with no badge after a successful sale; failed payment leaves it intact', () => {
    const c = cartOf(['a', 12500, 3]);
    const failed = cartAfterPayment(c, false);
    expect(failed).toBe(c);
    expect(badgeLabel(itemCount(failed))).toBe('3');
    const paid = cartAfterPayment(c, true);
    expect(paid).toEqual(emptyCart);
    expect(badgeLabel(itemCount(paid))).toBeNull();
  });
});

describe('Kosongkan confirmation (TC-KRJ-11/12)', () => {
  const filled = setCustomerLabel(setNote(cartOf(['a', 5000, 2]), 'a', 'less sugar'), 'Budi');
  it('keeps everything when cancelled', async () => {
    const next = await clearCartIfConfirmed(filled, async () => false);
    expect(next).toBe(filled);
  });
  it('clears items, notes and buyer name when confirmed', async () => {
    const next = await clearCartIfConfirmed(filled, async () => true);
    expect(next).toEqual(emptyCart);
  });
});
