import { cartTotals, type CartTotals } from '@kelola-kasir/money';
import type { CatalogProduct } from '../catalog/repository';

export const MAX_QTY = 999;
export const NOTE_MAX = 60;

export interface CartLine {
  productId: string;
  name: string;
  /** Price snapshot taken when the product was tapped. */
  unitPrice: number;
  quantity: number;
  note?: string;
}

export interface Cart {
  lines: readonly CartLine[];
  customerLabel: string;
}

export const emptyCart: Cart = { lines: [], customerLabel: '' };

/** Tap on a product card = +1 (M-8). */
export function addProduct(cart: Cart, product: CatalogProduct): Cart {
  const existing = cart.lines.find((l) => l.productId === product.id);
  if (!existing) {
    const line: CartLine = {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: 1,
    };
    return { ...cart, lines: [...cart.lines, line] };
  }
  return setQuantity(cart, product.id, existing.quantity + 1);
}

/** Quantity 0 (or less) removes the line; capped at the API maximum. */
export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, productId);
  const q = Math.min(quantity, MAX_QTY);
  return {
    ...cart,
    lines: cart.lines.map((l) => (l.productId === productId ? { ...l, quantity: q } : l)),
  };
}

export function removeLine(cart: Cart, productId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.productId !== productId) };
}

export function setNote(cart: Cart, productId: string, note: string): Cart {
  // Stored raw so spaces can be typed; trimmed when the sale is created (checkout.ts).
  const value = note.slice(0, NOTE_MAX);
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.productId !== productId) return l;
      const withoutNote: CartLine = { ...l };
      delete withoutNote.note;
      return value ? { ...withoutNote, note: value } : withoutNote;
    }),
  };
}

export function setCustomerLabel(cart: Cart, label: string): Cart {
  return { ...cart, customerLabel: label.slice(0, 40) };
}

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

export function totalsOf(cart: Cart): CartTotals {
  return cartTotals(cart.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })));
}

/** Pay-bar label, e.g. "3 item · Rp42.000". */
export function summaryLabel(cart: Cart, format: (n: number) => string): string {
  return `${itemCount(cart)} item · ${format(totalsOf(cart).total)}`;
}

/** Quick cash amounts: exact total, then the next round bills above it (M-9 "nominal cepat"). */
export function quickCashAmounts(total: number): number[] {
  const bills = [5_000, 10_000, 50_000, 100_000];
  const out = new Set<number>();
  for (const bill of bills) {
    const rounded = Math.ceil(total / bill) * bill;
    if (rounded > total) out.add(rounded);
  }
  for (const bill of [50_000, 100_000]) {
    if (bill > total) out.add(bill);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

/** Tab badge text: hidden (null) when empty, "99+" above 99 (K-3). */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/**
 * Cash/QRIS enabled rules shared by Jual and Keranjang so both screens stay identical (K-3):
 * Cash needs a total > 0; QRIS needs items and an available QRIS channel.
 */
export function payAvailability(
  cart: Cart,
  qrisEnabled: boolean,
): { cash: boolean; qris: boolean } {
  const hasItems = itemCount(cart) > 0;
  return {
    cash: hasItems && totalsOf(cart).total > 0,
    qris: hasItems && qrisEnabled,
  };
}

/** Cart after a payment attempt: emptied on success, untouched otherwise (K-3 KP-5). */
export function cartAfterPayment(cart: Cart, succeeded: boolean): Cart {
  return succeeded ? emptyCart : cart;
}

/** "Kosongkan": only clears (items, notes, buyer name) after the cashier confirms. */
export async function clearCartIfConfirmed(
  cart: Cart,
  confirm: () => Promise<boolean>,
): Promise<Cart> {
  return (await confirm()) ? emptyCart : cart;
}
