import type { TransactionCreate } from '@kelola-kasir/contracts';
import { cashChange } from '@kelola-kasir/money';
import type { Db } from '../db/types';
import { get } from '../db/types';
import { uuidv7 } from '../lib/uuid';
import { totalsOf, type Cart } from './cart';
import { reserveNumber } from './number';

export interface SaleContext {
  outletCode: string;
  deviceCode: string;
  timeZone: string;
  shiftId: string;
  employee: { id: string; name: string };
}

export class EmptyCartError extends Error {
  override readonly name = 'EmptyCartError';
}

/** Snapshot of the cart as the API's `TransactionCreate` (without payment, added per method). */
function baseBody(cart: Cart, ctx: SaleContext, number: string, now: Date) {
  if (cart.lines.length === 0) throw new EmptyCartError('Keranjang kosong');
  const totals = totalsOf(cart);
  const body = {
    id: uuidv7(now.getTime()),
    shift_id: ctx.shiftId,
    number,
    client_created_at: now.toISOString(),
    ...(cart.customerLabel.trim() ? { customer_label: cart.customerLabel.trim() } : {}),
    items: cart.lines.map((l, i) => ({
      id: uuidv7(now.getTime()),
      product_id: l.productId,
      product_name: l.name,
      unit_price: l.unitPrice,
      quantity: l.quantity,
      line_total: totals.lineTotals[i] ?? 0,
      ...(l.note ? { note: l.note } : {}),
    })),
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    tax_amount: totals.taxAmount,
    total: totals.total,
  };
  return { body, total: totals.total };
}

async function insertLocal(
  db: Db,
  tx: TransactionCreate,
  ctx: SaleContext,
  extra: { status: 'paid' | 'pending'; cashChange: number | null; syncState: 'pending' | 'synced' },
) {
  const cash = tx.payment.method === 'cash' ? tx.payment.cash_tendered : null;
  await db.run(
    `INSERT INTO transactions (id, number, employee_id, employee_name, shift_id, method, status,
       total, cash_tendered, cash_change, customer_label, created_at, body, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.id,
      tx.number,
      ctx.employee.id,
      ctx.employee.name,
      tx.shift_id,
      tx.payment.method,
      extra.status,
      tx.total,
      cash,
      extra.cashChange,
      tx.customer_label ?? null,
      tx.client_created_at,
      JSON.stringify(tx),
      extra.syncState,
    ],
  );
  for (const item of tx.items) {
    await db.run(
      'INSERT INTO transaction_items (transaction_id, product_id, quantity, created_at) VALUES (?, ?, ?, ?)',
      [tx.id, item.product_id, item.quantity, tx.client_created_at],
    );
  }
}

export interface CashSale {
  id: string;
  number: string;
  total: number;
  cashTendered: number;
  change: number;
}

/**
 * Cash sale (M-9): written to SQLite and the outbox in one local transaction, so it survives airplane
 * mode and app restarts. `sync push` delivers it later. Throws MoneyError when the cash is short.
 */
export async function createCashSale(
  db: Db,
  ctx: SaleContext,
  cart: Cart,
  cashTendered: number,
  now: Date = new Date(),
): Promise<CashSale> {
  const total = totalsOf(cart).total;
  const change = cashChange(total, cashTendered);
  return db.transaction(async () => {
    const number = await reserveNumber(db, ctx, now);
    const { body } = baseBody(cart, ctx, number, now);
    const tx: TransactionCreate = {
      ...body,
      payment: { id: uuidv7(now.getTime()), method: 'cash', cash_tendered: cashTendered },
    };
    await insertLocal(db, tx, ctx, { status: 'paid', cashChange: change, syncState: 'pending' });
    const seq =
      (await get<{ n: number }>(db, 'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM outbox'))?.n ?? 1;
    await db.run(
      `INSERT INTO outbox (id, seq, type, employee_id, client_created_at, payload, state)
       VALUES (?, ?, 'transaction.create', ?, ?, ?, 'pending')`,
      [tx.id, seq, ctx.employee.id, tx.client_created_at, JSON.stringify(tx)],
    );
    return { id: tx.id, number, total, cashTendered, change };
  });
}

/** QRIS body: built online (never queued, ADR-0007) and sent straight to `POST /transactions`. */
export async function buildQrisTransaction(
  db: Db,
  ctx: SaleContext,
  cart: Cart,
  now: Date = new Date(),
): Promise<TransactionCreate> {
  return db.transaction(async () => {
    const number = await reserveNumber(db, ctx, now);
    const { body } = baseBody(cart, ctx, number, now);
    return { ...body, payment: { id: uuidv7(now.getTime()), method: 'qris' as const } };
  });
}

/** Keeps a paid QRIS sale in local history (already on the server, so nothing to push). */
export async function recordPaidQris(db: Db, ctx: SaleContext, tx: TransactionCreate) {
  await db.transaction(() =>
    insertLocal(db, tx, ctx, { status: 'paid', cashChange: null, syncState: 'synced' }),
  );
}
