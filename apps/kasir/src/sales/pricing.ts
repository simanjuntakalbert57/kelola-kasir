import {
  bestDiscount,
  type DiscountProduct,
  type DiscountQuote,
  type DiscountRule,
} from '@kelola-kasir/money';
import type { Cart, CartLine } from './cart';

/**
 * Automatic item discounts (ADR-0023 §2). The cashier never types a discount: every line is priced from the
 * synced rules with the shared `bestDiscount`, at an instant (cart change, the minute tick, or the moment of Bayar).
 */

/** Best discount for a catalog product at `at`, or `null`. */
export function quoteProduct(
  rules: readonly DiscountRule[],
  product: DiscountProduct,
  at: Date | number,
): DiscountQuote | null {
  if (rules.length === 0) return null;
  return bestDiscount(rules, product, at);
}

function sameDiscount(a: CartLine['discount'], b: CartLine['discount']): boolean {
  return a?.id === b?.id && a?.version === b?.version && a?.perUnit === b?.perUnit;
}

/**
 * Re-prices every line of the cart. Lines whose discount did not change keep their identity, and the same cart is
 * returned when nothing changed, so a per-minute tick does not re-render the screens.
 */
export function priceCart(cart: Cart, rules: readonly DiscountRule[], at: Date | number): Cart {
  let changed = false;
  const lines = cart.lines.map((line) => {
    const quote = quoteProduct(
      rules,
      { id: line.productId, categoryId: line.categoryId ?? null, price: line.unitPrice },
      at,
    );
    const next: CartLine['discount'] = quote
      ? {
          id: quote.rule.id,
          version: quote.rule.version,
          name: quote.rule.name,
          type: quote.rule.type,
          value: quote.rule.value,
          perUnit: quote.perUnit,
        }
      : undefined;
    if (sameDiscount(line.discount, next)) return line;
    changed = true;
    const { discount: _old, ...rest } = line;
    void _old;
    return next ? { ...rest, discount: next } : rest;
  });
  return changed ? { ...cart, lines } : cart;
}

/** Badge on a product card / cart line: `−20%` or `−Rp3.000`. */
export function discountBadge(
  discount: Pick<NonNullable<CartLine['discount']>, 'type' | 'value'>,
  perUnit: number,
  format: (n: number) => string,
): string {
  return discount.type === 'percent' ? `−${discount.value}%` : `−${format(perUnit)}`;
}

/** `discount_id → promo name` of a priced cart, kept with the local sale so the receipt can be reprinted offline. */
export function discountNamesOf(cart: Cart): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of cart.lines) if (l.discount) out[l.discount.id] = l.discount.name;
  return out;
}
