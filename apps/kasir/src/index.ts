import type { TransactionItemInput } from '@kelola-kasir/contracts';
import { cartTotals, type CartTotals } from '@kelola-kasir/money';

/** Placeholder until M-1. Cart math comes from @kelola-kasir/money so totals match the API. */
export function totalsFor(items: readonly TransactionItemInput[]): CartTotals {
  return cartTotals(items.map((i) => ({ unitPrice: i.unit_price, quantity: i.quantity })));
}
