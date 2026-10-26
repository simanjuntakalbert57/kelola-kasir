import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  assertRupiah,
  cartTotals,
  cashChange,
  formatRupiah,
  isRupiah,
  lineTotal,
  parseRupiah,
  sum,
} from './index.js';

describe('isRupiah / assertRupiah', () => {
  it('accepts non-negative safe integers only', () => {
    expect(isRupiah(0)).toBe(true);
    expect(isRupiah(15000)).toBe(true);
    expect(isRupiah(-1)).toBe(false);
    expect(isRupiah(1.5)).toBe(false);
    expect(isRupiah(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isRupiah('15000')).toBe(false);
    expect(() => assertRupiah(0.1)).toThrow(MoneyError);
  });
});

describe('formatRupiah', () => {
  it.each([
    [0, 'Rp0'],
    [500, 'Rp500'],
    [15000, 'Rp15.000'],
    [1234567, 'Rp1.234.567'],
    [-5000, '-Rp5.000'],
  ])('%i → %s', (value, expected) => {
    expect(formatRupiah(value)).toBe(expected);
  });

  it('rejects decimals', () => {
    expect(() => formatRupiah(10.5)).toThrow(MoneyError);
  });
});

describe('parseRupiah', () => {
  it.each([
    ['15000', 15000],
    ['15.000', 15000],
    ['Rp 15.000', 15000],
    ['rp1.234.567', 1234567],
    ['20,000', 20000],
  ])('%s → %i', (input, expected) => {
    expect(parseRupiah(input)).toBe(expected);
  });

  it.each(['', 'abc', '15.5', '1.50', '-5000', '15.000,00'])('rejects %s', (input) => {
    expect(() => parseRupiah(input)).toThrow(MoneyError);
  });
});

describe('sum and lineTotal', () => {
  it('adds integer amounts', () => {
    expect(sum([])).toBe(0);
    expect(sum([15000, 18000, 12000])).toBe(45000);
  });

  it('multiplies price by quantity', () => {
    expect(lineTotal(18000, 3)).toBe(54000);
    expect(() => lineTotal(18000, 0)).toThrow(MoneyError);
    expect(() => lineTotal(18000, 1.5)).toThrow(MoneyError);
  });

  it('detects overflow', () => {
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError);
  });
});

describe('cartTotals', () => {
  it('computes subtotal and total without discount/tax (MVP)', () => {
    const totals = cartTotals([
      { unitPrice: 18000, quantity: 2 },
      { unitPrice: 16000, quantity: 1 },
    ]);
    expect(totals).toEqual({
      lineTotals: [36000, 16000],
      subtotal: 52000,
      discountAmount: 0,
      taxAmount: 0,
      total: 52000,
    });
  });

  it('applies discount and tax', () => {
    const totals = cartTotals([{ unitPrice: 10000, quantity: 3 }], {
      discountAmount: 5000,
      taxAmount: 2500,
    });
    expect(totals.total).toBe(27500);
  });

  it('rejects discount larger than subtotal', () => {
    expect(() => cartTotals([{ unitPrice: 1000, quantity: 1 }], { discountAmount: 2000 })).toThrow(
      MoneyError,
    );
  });
});

describe('cashChange', () => {
  it('returns change, including exact cash ("Uang Pas")', () => {
    expect(cashChange(52000, 100000)).toBe(48000);
    expect(cashChange(52000, 52000)).toBe(0);
  });

  it('throws when cash is insufficient', () => {
    expect(() => cashChange(52000, 50000)).toThrow(MoneyError);
  });
});
