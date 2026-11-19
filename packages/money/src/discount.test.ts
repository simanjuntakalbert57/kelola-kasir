import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  bestDiscount,
  discountApplies,
  discountForLine,
  discountPerUnit,
  isDiscountActive,
  localMoment,
  scheduleReason,
  type DiscountRule,
} from './index.ts';

const WIB = 420;

function rule(over: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    version: 1,
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
    utc_offset_minutes: WIB,
    ...over,
  };
}

/** Instant for a WIB wall-clock time. */
const wib = (iso: string): Date => new Date(`${iso}+07:00`);

describe('discountPerUnit', () => {
  it.each([
    [12000, 20, 2400],
    [10000, 15, 1500],
    [999, 10, 100], // 99.9 → 100
    [1005, 10, 101], // 100.5 → half up
    [1004, 10, 100], // 100.4 → down
    [1, 49, 0], // 0.49 → 0
    [1, 50, 1], // 0.5 → 1
    [0, 50, 0],
  ])('percent: Rp%i at %i%% takes off Rp%i', (price, value, off) => {
    expect(discountPerUnit(price, 'percent', value)).toBe(off);
  });

  it('100% makes the unit free, never negative', () => {
    expect(discountPerUnit(12000, 'percent', 100)).toBe(12000);
    expect(discountPerUnit(1, 'percent', 100)).toBe(1);
  });

  it('amount off is capped at the price (final price never below Rp0)', () => {
    expect(discountPerUnit(12000, 'amount', 2000)).toBe(2000);
    expect(discountPerUnit(12000, 'amount', 12000)).toBe(12000);
    expect(discountPerUnit(12000, 'amount', 50000)).toBe(12000);
    expect(discountPerUnit(0, 'amount', 1000)).toBe(0);
  });

  it('rejects values outside the model', () => {
    expect(() => discountPerUnit(1000, 'percent', 101)).toThrow(MoneyError);
    expect(() => discountPerUnit(1000, 'percent', 0)).toThrow(MoneyError);
    expect(() => discountPerUnit(1000, 'amount', 1.5)).toThrow(MoneyError);
    expect(() => discountPerUnit(-1, 'amount', 5)).toThrow(MoneyError);
  });
});

describe('discountForLine', () => {
  it('rounds per unit, then multiplies by the quantity', () => {
    expect(discountForLine(12000, 3, 'percent', 20)).toBe(7200);
    // 10% of Rp1.005 is Rp100.5 → Rp101 per unit, ×3 (not round(301.5) = 302)
    expect(discountForLine(1005, 3, 'percent', 10)).toBe(303);
  });

  it('a Rp amount larger than the price takes off the whole line, not more', () => {
    expect(discountForLine(8000, 4, 'amount', 20000)).toBe(32000);
  });

  it('rejects a bad quantity', () => {
    expect(() => discountForLine(1000, 0, 'amount', 1)).toThrow(MoneyError);
  });
});

describe('localMoment', () => {
  it('uses the outlet offset, not the host time zone', () => {
    expect(localMoment(new Date('2026-11-18T17:30:00Z'), WIB)).toEqual({
      date: '2026-11-19',
      isoWeekday: 4, // Thursday
      minutes: 30,
    });
    expect(localMoment(new Date('2026-11-18T17:30:00Z'), 480).date).toBe('2026-11-19');
    expect(localMoment(new Date('2026-11-18T16:59:59Z'), WIB).date).toBe('2026-11-18');
  });

  it('numbers Sunday as 7', () => {
    expect(localMoment(wib('2026-11-22T12:00:00'), WIB).isoWeekday).toBe(7);
    expect(localMoment(wib('2026-11-23T00:00:00'), WIB).isoWeekday).toBe(1);
  });
});

describe('schedule', () => {
  it('date range is inclusive on both ends in outlet local time', () => {
    const r = rule({ starts_on: '2026-11-10', ends_on: '2026-11-12' });
    expect(scheduleReason(r, wib('2026-11-09T23:59:59'))).toBe('not_started');
    expect(isDiscountActive(r, wib('2026-11-10T00:00:00'))).toBe(true);
    expect(isDiscountActive(r, wib('2026-11-12T23:59:59'))).toBe(true);
    expect(scheduleReason(r, wib('2026-11-13T00:00:00'))).toBe('ended');
  });

  it('a late-night sale belongs to the local day even when UTC is already the next day', () => {
    const r = rule({ starts_on: '2026-11-10', ends_on: '2026-11-10' });
    expect(isDiscountActive(r, new Date('2026-11-10T16:59:00Z'))).toBe(true); // 23:59 WIB
    expect(isDiscountActive(r, new Date('2026-11-10T17:00:00Z'))).toBe(false); // 00:00 WIB 11th
  });

  it('weekday filter uses ISO days', () => {
    const r = rule({ days_of_week: [6, 7] });
    expect(isDiscountActive(r, wib('2026-11-21T10:00:00'))).toBe(true); // Saturday
    expect(scheduleReason(r, wib('2026-11-20T10:00:00'))).toBe('weekday'); // Friday
  });

  it('hour window: start inclusive, end exclusive', () => {
    const r = rule({ time_start: '14:00', time_end: '16:00' });
    expect(scheduleReason(r, wib('2026-11-18T13:59:59'))).toBe('time');
    expect(isDiscountActive(r, wib('2026-11-18T14:00:00'))).toBe(true);
    expect(isDiscountActive(r, wib('2026-11-18T15:59:59'))).toBe(true);
    expect(scheduleReason(r, wib('2026-11-18T16:00:00'))).toBe('time');
  });

  it('an inactive rule never applies', () => {
    expect(scheduleReason(rule({ is_active: false }), wib('2026-11-18T10:00:00'))).toBe('inactive');
  });
});

describe('targets', () => {
  const product = { id: 'p1', categoryId: 'c1', price: 10000 };
  const at = wib('2026-11-18T10:00:00');

  it('matches a product directly or through its category', () => {
    expect(discountApplies(rule({ product_ids: ['p1'] }), product, at)).toBe(true);
    expect(discountApplies(rule({ product_ids: ['p2'] }), product, at)).toBe(false);
    const byCategory = rule({ target_type: 'category', product_ids: [], category_ids: ['c1'] });
    expect(discountApplies(byCategory, product, at)).toBe(true);
    expect(discountApplies(byCategory, { ...product, categoryId: null }, at)).toBe(false);
    expect(discountApplies(byCategory, { ...product, categoryId: 'c2' }, at)).toBe(false);
  });
});

describe('bestDiscount', () => {
  const product = { id: 'p1', categoryId: 'c1', price: 12000 };
  const at = wib('2026-11-18T10:00:00');

  it('returns null without an applicable rule', () => {
    expect(bestDiscount([], product, at)).toBeNull();
    expect(bestDiscount([rule({ product_ids: ['zzz'] })], product, at)).toBeNull();
  });

  it('does not stack: the biggest Rupiah cut wins', () => {
    const pct = rule({ id: 'a', type: 'percent', value: 10 }); // 1.200
    const amt = rule({ id: 'b', type: 'amount', value: 2500 }); // 2.500
    const cat = rule({
      id: 'c',
      target_type: 'category',
      product_ids: [],
      category_ids: ['c1'],
      value: 15,
    }); // 1.800
    const best = bestDiscount([pct, amt, cat], product, at);
    expect(best?.rule.id).toBe('b');
    expect(best?.perUnit).toBe(2500);
    expect(best?.finalUnitPrice).toBe(9500);
  });

  it('breaks a tie with the smallest id, whatever the input order', () => {
    const x = rule({ id: 'b', type: 'amount', value: 2000 });
    const y = rule({ id: 'a', type: 'percent', value: 20 }); // 2.400 → not a tie
    const z = rule({ id: 'a', type: 'amount', value: 2000 });
    expect(bestDiscount([x, z], product, at)?.rule.id).toBe('a');
    expect(bestDiscount([z, x], product, at)?.rule.id).toBe('a');
    expect(bestDiscount([x, y], product, at)?.rule.id).toBe('a');
  });

  it('skips rules outside their schedule', () => {
    const happy = rule({ id: 'a', value: 50, time_start: '14:00', time_end: '16:00' });
    const always = rule({ id: 'b', value: 10 });
    expect(bestDiscount([happy, always], product, at)?.rule.id).toBe('b');
    expect(bestDiscount([happy, always], product, wib('2026-11-18T14:30:00'))?.rule.id).toBe('a');
  });

  it('100% off gives a free unit', () => {
    const best = bestDiscount([rule({ value: 100 })], product, at);
    expect(best?.perUnit).toBe(12000);
    expect(best?.finalUnitPrice).toBe(0);
  });

  it('a Rp cut larger than the price is capped, final price Rp0', () => {
    const best = bestDiscount([rule({ type: 'amount', value: 50000 })], product, at);
    expect(best?.perUnit).toBe(12000);
    expect(best?.finalUnitPrice).toBe(0);
  });

  it('a Rp0 product has no discount to give', () => {
    expect(bestDiscount([rule()], { ...product, price: 0 }, at)).toBeNull();
  });
});
