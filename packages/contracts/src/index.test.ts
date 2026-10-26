import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PAYMENT_METHODS,
  SHIFT_STATUSES,
  TRANSACTION_STATUSES,
  type PaymentMethod,
  type Product,
  type ResponseBody,
  type Shift,
  type ShiftStatus,
  type TransactionItemInput,
  type TransactionStatus,
} from './index.js';

describe('contracts', () => {
  it('runtime status lists cover every enum value in the spec', () => {
    expectTypeOf<(typeof TRANSACTION_STATUSES)[number]>().toEqualTypeOf<TransactionStatus>();
    expectTypeOf<(typeof PAYMENT_METHODS)[number]>().toEqualTypeOf<PaymentMethod>();
    expectTypeOf<(typeof SHIFT_STATUSES)[number]>().toEqualTypeOf<ShiftStatus>();
    expect(TRANSACTION_STATUSES).toContain('cancelled');
    expect(PAYMENT_METHODS).toEqual(['cash', 'qris']);
    expect(SHIFT_STATUSES).toEqual(['open', 'closed']);
  });

  it('products have a single price and no option groups (TDD v1.1)', () => {
    expectTypeOf<Product>().toHaveProperty('price').toEqualTypeOf<number>();
    expectTypeOf<Product>().not.toHaveProperty('option_group_ids');
    expectTypeOf<TransactionItemInput>().toHaveProperty('unit_price');
    expectTypeOf<TransactionItemInput>().not.toHaveProperty('options');
  });

  it('shifts belong to the outlet, not a single device', () => {
    expectTypeOf<Shift>().toHaveProperty('opened_on_device_id');
    expectTypeOf<Shift>().not.toHaveProperty('device_id');
  });

  it('resolves response bodies by path and method', () => {
    expectTypeOf<ResponseBody<'/shifts/current', 'get'>>().toEqualTypeOf<Shift>();
  });
});
