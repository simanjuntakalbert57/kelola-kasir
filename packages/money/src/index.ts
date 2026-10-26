/**
 * Integer Rupiah helpers. Money is always a whole number of Rupiah (no decimals)
 * across DB, API and apps (TDD §3.2). 15000 means Rp15.000.
 */
export type Rupiah = number;

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function isRupiah(value: unknown): value is Rupiah {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function assertRupiah(value: unknown, label = 'amount'): asserts value is Rupiah {
  if (!isRupiah(value)) {
    throw new MoneyError(
      `${label} must be a non-negative safe integer Rupiah, got ${String(value)}`,
    );
  }
}

function checked(value: number, label: string): Rupiah {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} overflowed the safe integer range`);
  }
  return value;
}

/** Formats as Indonesian Rupiah, e.g. 15000 → "Rp15.000", -5000 → "-Rp5.000". */
export function formatRupiah(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`cannot format non-integer Rupiah ${String(value)}`);
  }
  const digits = Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}Rp${digits}`;
}

/**
 * Parses user input such as "Rp 15.000", "15000" or "15,000" into integer Rupiah.
 * Any decimal part is rejected because Rupiah amounts are whole numbers.
 */
export function parseRupiah(input: string): Rupiah {
  const cleaned = input.trim().replace(/^rp\.?\s*/i, '');
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(cleaned)) {
    throw new MoneyError(`invalid Rupiah amount: "${input}"`);
  }
  return checked(Number(cleaned.replace(/[.,]/g, '')), 'parsed amount');
}

export function sum(values: readonly Rupiah[]): Rupiah {
  let total = 0;
  for (const v of values) {
    assertRupiah(v, 'value');
    total = checked(total + v, 'sum');
  }
  return total;
}

export function lineTotal(unitPrice: Rupiah, quantity: number): Rupiah {
  assertRupiah(unitPrice, 'unit_price');
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new MoneyError(`quantity must be a positive integer, got ${String(quantity)}`);
  }
  return checked(unitPrice * quantity, 'line_total');
}

export interface CartLine {
  readonly unitPrice: Rupiah;
  readonly quantity: number;
}

export interface CartTotals {
  readonly lineTotals: readonly Rupiah[];
  readonly subtotal: Rupiah;
  readonly discountAmount: Rupiah;
  readonly taxAmount: Rupiah;
  readonly total: Rupiah;
}

/**
 * Cart math shared by the cashier app and the API (the server recomputes and compares, TDD §3.2):
 * line_total = unit_price × quantity, subtotal = Σ line_total, total = subtotal − discount + tax.
 */
export function cartTotals(
  lines: readonly CartLine[],
  options: { discountAmount?: Rupiah; taxAmount?: Rupiah } = {},
): CartTotals {
  const discountAmount = options.discountAmount ?? 0;
  const taxAmount = options.taxAmount ?? 0;
  assertRupiah(discountAmount, 'discount_amount');
  assertRupiah(taxAmount, 'tax_amount');
  const lineTotals = lines.map((l) => lineTotal(l.unitPrice, l.quantity));
  const subtotal = sum(lineTotals);
  if (discountAmount > subtotal) {
    throw new MoneyError('discount_amount cannot exceed subtotal');
  }
  return {
    lineTotals,
    subtotal,
    discountAmount,
    taxAmount,
    total: checked(subtotal - discountAmount + taxAmount, 'total'),
  };
}

/** Change for a cash payment; throws when the tendered cash is less than the total (CASH_INSUFFICIENT). */
export function cashChange(total: Rupiah, cashTendered: Rupiah): Rupiah {
  assertRupiah(total, 'total');
  assertRupiah(cashTendered, 'cash_tendered');
  if (cashTendered < total) {
    throw new MoneyError('cash_tendered is less than total');
  }
  return cashTendered - total;
}
