import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EXPENSE_FUNDING_SOURCES,
  EXPENSE_GROUP_LABELS,
  EXPENSE_GROUPS,
  OUTLET_SCOPES,
  PAYMENT_METHODS,
  SHIFT_STATUSES,
  TRANSACTION_STATUSES,
  type Expense,
  type ExpenseFundingSource,
  type ExpenseGroup,
  type OutletScope,
  type OwnerSession,
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

  it('expense enums and owner multi-outlet session match the spec (ADR-0020, ADR-0021)', () => {
    expectTypeOf<(typeof EXPENSE_GROUPS)[number]>().toEqualTypeOf<ExpenseGroup>();
    expectTypeOf<(typeof EXPENSE_FUNDING_SOURCES)[number]>().toEqualTypeOf<ExpenseFundingSource>();
    expectTypeOf<(typeof OUTLET_SCOPES)[number]>().toEqualTypeOf<NonNullable<OutletScope>>();
    expectTypeOf<Expense>().toHaveProperty('amount').toEqualTypeOf<number>();
    expectTypeOf<OwnerSession>().toHaveProperty('active_outlet_id').toEqualTypeOf<string>();
    expectTypeOf<OwnerSession['user']['outlets'][number]>()
      .toHaveProperty('role')
      .toEqualTypeOf<'owner' | 'manager'>();
    expect(Object.keys(EXPENSE_GROUP_LABELS)).toEqual([...EXPENSE_GROUPS]);
    expect(EXPENSE_FUNDING_SOURCES).toEqual(['drawer', 'owner']);
    expect(OUTLET_SCOPES).toEqual(['current', 'all']);
  });
});
