import type { Payment, Transaction, TransactionCreate } from '@kelola-kasir/contracts';
import { ApiError, type ApiClient } from '../api/client';
import type { Db } from '../db/types';
import type { Cart } from './cart';
import { discountNamesOf } from './pricing';
import { buildQrisTransaction, recordPaidQris, type SaleContext } from './checkout';

/** A pending static-QRIS payment lives 15 minutes (TDD §5.3). */
export const QRIS_TTL_MS = 15 * 60 * 1000;

export interface QrisSession {
  body: TransactionCreate;
  transaction: Transaction;
  payment: Payment;
  /** Epoch ms when the QR stops being valid. */
  expiresAt: number;
  /** `discount_id → promo name`, kept with the local history row for the receipt. */
  discountNames: Record<string, string>;
}

type QrisApi = Pick<ApiClient, 'createTransaction' | 'confirmPayment' | 'cancelPayment'>;

export function qrisExpiry(payment: Pick<Payment, 'expires_at'>, startedAt: number): number {
  const parsed = payment.expires_at ? Date.parse(payment.expires_at) : NaN;
  return Number.isNaN(parsed) ? startedAt + QRIS_TTL_MS : parsed;
}

export function remainingMs(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now);
}

/** `mm:ss` countdown label. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** QRIS needs the server (charge + confirmation), so it is disabled while offline (TDD §2.4). */
export function qrisAvailability(online: boolean): { enabled: boolean; hint: string | null } {
  return online
    ? { enabled: true, hint: null }
    : { enabled: false, hint: 'QRIS butuh internet. Gunakan Cash.' };
}

/** The server refused the QRIS sale because a promo changed (`DISCOUNT_STALE`): refresh the catalog and re-price. */
export class DiscountStaleError extends Error {
  override readonly name = 'DiscountStaleError';
}

export async function startQris(
  api: QrisApi,
  db: Db,
  ctx: SaleContext,
  cart: Cart,
  now: Date = new Date(),
): Promise<QrisSession> {
  const body = await buildQrisTransaction(db, ctx, cart, now);
  let transaction: Transaction;
  try {
    transaction = await api.createTransaction(body);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'DISCOUNT_STALE') {
      throw new DiscountStaleError(error.message);
    }
    throw error;
  }
  const payment =
    transaction.payments.find((p) => p.id === body.payment.id) ?? transaction.payments[0];
  if (!payment) throw new Error('Respons transaksi QRIS tanpa pembayaran');
  return {
    body,
    transaction,
    payment,
    expiresAt: qrisExpiry(payment, now.getTime()),
    discountNames: discountNamesOf(cart),
  };
}

/** Cashier checked the bank notification: mark paid on the server, then keep it in local history. */
export async function confirmQris(
  api: QrisApi,
  db: Db,
  ctx: SaleContext,
  session: QrisSession,
): Promise<Transaction> {
  const paid = await api.confirmPayment(session.payment.id);
  await recordPaidQris(db, ctx, session.body, session.discountNames);
  return paid;
}

export function cancelQris(api: QrisApi, session: QrisSession): Promise<Transaction> {
  return api.cancelPayment(session.payment.id);
}
