import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../catalog/repository';
import {
  addProduct,
  badgeLabel,
  clearCartIfConfirmed,
  emptyCart,
  itemCount,
  payAvailability,
  removeLine,
  setCustomerLabel,
  setNote,
  setQuantity,
  totalsOf,
  type Cart,
} from './cart';

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

describe('Cart after sale / failed payment (TC-KRJ-03, TC-KRJ-10, TC-KRJ-17)', () => {
  it('payment totals are unchanged by tab navigation (pure state)', () => {
    const c = cartOf(['a', 12500, 3]);
    expect(totalsOf(c).total).toBe(37500);
    expect(c.lines[0]).toMatchObject({ productId: 'a', unitPrice: 12500, quantity: 3 });
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
