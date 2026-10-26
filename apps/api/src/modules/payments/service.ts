import { and, eq, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import type { DbOrTx } from '../../db/client.js';
import { payments, transactions } from '../../db/schema.js';
import { errors } from '../../errors.js';
import type { ChangeTracker } from '../../lib/memory-cache.js';
import { writeAudit } from '../audit/audit.js';
import { loadTransactionDto } from '../transactions/serialize.js';
import { StaticQrisProvider, type PaymentProvider, type PaymentRow } from './provider.js';

type TransactionRow = typeof transactions.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Advisory lock key of the expiry job, so several API instances never expire concurrently. */
const EXPIRY_LOCK = 872_341_001;
const EXPIRY_BATCH = 100;

async function lockPayment(
  tx: Tx,
  outletId: string,
  paymentId: string,
): Promise<{ payment: PaymentRow; transaction: TransactionRow }> {
  const [row] = await tx
    .select({ payment: payments, transaction: transactions })
    .from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId))
    .where(and(eq(payments.id, paymentId), eq(transactions.outletId, outletId)))
    .for('update');
  if (!row) throw errors.notFound('Payment not found');
  return row;
}

/** Provider that created a payment (MVP: only the static QRIS provider exists). */
function providerOf(payment: PaymentRow): PaymentProvider {
  if (payment.provider === 'qris_static') {
    return new StaticQrisProvider({ payload: '', embedAmount: false });
  }
  throw errors.unavailable(
    'QRIS_PROVIDER_UNAVAILABLE',
    'QRIS is unavailable',
    `Provider ${payment.provider} is not available`,
  );
}

/** Pending QRIS past its deadline: payment `expired`, transaction `cancelled` (decision Q-1). */
async function expire(
  tx: DbOrTx,
  payment: PaymentRow,
  transaction: TransactionRow,
  now: Date,
): Promise<void> {
  await tx.update(payments).set({ status: 'expired' }).where(eq(payments.id, payment.id));
  await tx
    .update(transactions)
    .set({ status: 'cancelled' })
    .where(and(eq(transactions.id, transaction.id), eq(transactions.status, 'pending')));
  await writeAudit(tx, {
    outletId: transaction.outletId,
    actor: { type: 'system', id: null },
    action: 'payment.qris_expired',
    entityType: 'payment',
    entityId: payment.id,
    meta: { transaction_id: transaction.id, number: transaction.number, at: now.toISOString() },
  });
}

/** Expire this shift's pending QRIS payments that are past their deadline (used when closing). */
export async function expireOverdueInShift(tx: DbOrTx, shiftId: string, now: Date): Promise<void> {
  const due = await tx
    .select({ payment: payments, transaction: transactions })
    .from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId))
    .where(
      and(
        eq(transactions.shiftId, shiftId),
        eq(payments.status, 'pending'),
        eq(payments.method, 'qris'),
        lte(payments.expiresAt, now),
      ),
    )
    .for('update', { of: [payments, transactions] });
  for (const row of due) await expire(tx, row.payment, row.transaction, now);
}

async function markCancelled(
  tx: DbOrTx,
  payment: PaymentRow,
  transaction: TransactionRow,
  actor: { type: 'employee' | 'system'; id: string | null },
): Promise<void> {
  await tx.update(payments).set({ status: 'cancelled' }).where(eq(payments.id, payment.id));
  await tx
    .update(transactions)
    .set({ status: 'cancelled' })
    .where(eq(transactions.id, transaction.id));
  await writeAudit(tx, {
    outletId: transaction.outletId,
    actor,
    action: 'payment.qris_cancelled',
    entityType: 'payment',
    entityId: payment.id,
    meta: { transaction_id: transaction.id, number: transaction.number },
  });
}

async function markPaid(
  tx: DbOrTx,
  payment: PaymentRow,
  transaction: TransactionRow,
  paidAt: Date,
  confirmedBy: string | null,
): Promise<void> {
  await tx
    .update(payments)
    .set({
      status: 'paid',
      paidAt,
      confirmedBy,
      confirmationMode: confirmedBy ? 'manual' : 'auto',
    })
    .where(eq(payments.id, payment.id));
  await tx
    .update(transactions)
    .set({ status: 'paid', paidAt })
    .where(eq(transactions.id, transaction.id));
}

export interface PaymentService {
  get(outletId: string, paymentId: string): Promise<PaymentRow>;
  confirm(outletId: string, paymentId: string, employeeId: string, ip?: string): Promise<string>;
  cancel(outletId: string, paymentId: string, employeeId: string): Promise<string>;
  /** Expire every pending QRIS payment past its deadline; returns how many were expired. */
  expireDue(): Promise<number>;
  /** Earliest deadline among pending QRIS payments, or null when none is pending. */
  nextExpiry(): Promise<Date | null>;
}

export function createPaymentService(ctx: AppContext): PaymentService {
  const { db } = ctx;

  return {
    async get(outletId, paymentId) {
      return db.transaction(async (tx) => {
        const { payment, transaction } = await lockPayment(tx, outletId, paymentId);
        if (payment.status !== 'pending' || payment.method !== 'qris') return payment;
        const now = ctx.now();
        if (payment.expiresAt && payment.expiresAt <= now) {
          await expire(tx, payment, transaction, now);
        } else if (payment.confirmationMode === 'auto') {
          // Auto mode: ask the provider (poll fallback next to the webhook).
          const status = await providerOf(payment).getStatus(payment);
          if (status === 'paid') await markPaid(tx, payment, transaction, now, null);
          else if (status === 'expired' || status === 'failed') {
            await expire(tx, payment, transaction, now);
          }
        } else {
          return payment;
        }
        ctx.changes.bump(); // reads here can settle the payment (cancelled transaction, shift totals)
        const [fresh] = await tx.select().from(payments).where(eq(payments.id, paymentId));
        return fresh ?? payment;
      });
    },

    async confirm(outletId, paymentId, employeeId, ip) {
      let notPending: string | undefined;
      const transactionId = await db.transaction(async (tx) => {
        const { payment, transaction } = await lockPayment(tx, outletId, paymentId);
        if (payment.method !== 'qris' || payment.confirmationMode !== 'manual') {
          throw errors.conflict(
            'CONFIRMATION_NOT_ALLOWED',
            'Manual confirmation is not allowed',
            'This payment is confirmed automatically by the provider',
          );
        }
        if (payment.status === 'paid') return transaction.id; // idempotent replay
        const now = ctx.now();
        if (payment.status !== 'pending') {
          notPending = `Payment is ${payment.status}`;
          return transaction.id;
        }
        if (payment.expiresAt && payment.expiresAt <= now) {
          await expire(tx, payment, transaction, now);
          notPending = 'Payment has expired; create a new transaction';
          return transaction.id;
        }
        await markPaid(tx, payment, transaction, now, employeeId);
        await writeAudit(tx, {
          outletId,
          actor: { type: 'employee', id: employeeId },
          action: 'payment.qris_manual_confirmed',
          entityType: 'payment',
          entityId: payment.id,
          after: { amount: payment.amount },
          meta: { transaction_id: transaction.id, number: transaction.number, ip },
        });
        return transaction.id;
      });
      if (notPending) {
        throw errors.conflict('PAYMENT_NOT_PENDING', 'Payment is not pending', notPending);
      }
      return transactionId;
    },

    async cancel(outletId, paymentId, employeeId) {
      let notPending: string | undefined;
      const transactionId = await db.transaction(async (tx) => {
        const { payment, transaction } = await lockPayment(tx, outletId, paymentId);
        if (payment.method !== 'qris') {
          throw errors.conflict(
            'PAYMENT_NOT_PENDING',
            'Payment is not pending',
            'Only QRIS payments can be cancelled',
          );
        }
        if (payment.status === 'cancelled' || payment.status === 'expired') {
          return transaction.id; // idempotent replay
        }
        if (payment.status !== 'pending') {
          notPending = `Payment is ${payment.status}`;
          return transaction.id;
        }
        await providerOf(payment).cancel(payment);
        await markCancelled(tx, payment, transaction, { type: 'employee', id: employeeId });
        return transaction.id;
      });
      if (notPending) {
        throw errors.conflict('PAYMENT_NOT_PENDING', 'Payment is not pending', notPending);
      }
      return transactionId;
    },

    async expireDue() {
      let total = 0;
      for (;;) {
        const batch = await db.transaction(async (tx) => {
          const [lock] = (
            await tx.execute<{ locked: boolean }>(
              sql`select pg_try_advisory_xact_lock(${EXPIRY_LOCK}) as locked`,
            )
          ).rows;
          if (!lock?.locked) return 0;
          const now = ctx.now();
          const due = await tx
            .select({ payment: payments, transaction: transactions })
            .from(payments)
            .innerJoin(transactions, eq(transactions.id, payments.transactionId))
            .where(
              and(
                eq(payments.status, 'pending'),
                eq(payments.method, 'qris'),
                lte(payments.expiresAt, now),
              ),
            )
            .limit(EXPIRY_BATCH)
            .for('update', { skipLocked: true });
          for (const row of due) await expire(tx, row.payment, row.transaction, now);
          return due.length;
        });
        total += batch;
        if (batch > 0) ctx.changes.bump();
        if (batch < EXPIRY_BATCH) return total;
      }
    },

    async nextExpiry() {
      const [row] = await db
        .select({ at: sql<Date | null>`min(${payments.expiresAt})` })
        .from(payments)
        .where(and(eq(payments.status, 'pending'), eq(payments.method, 'qris')));
      return row?.at ? new Date(row.at) : null;
    },
  };
}

type JobLog = {
  error: (obj: unknown, msg: string) => void;
  info: (obj: unknown, msg: string) => void;
};

/** Longest `setTimeout` delay Node accepts. */
const MAX_TIMER_MS = 2_147_483_647;
/** Pause before re-checking after a sweep that left an overdue payment (e.g. another instance holds the lock). */
const RETRY_MS = 5_000;

/**
 * On-demand expiry of pending QRIS payments (15 min, TDD §5.3). Instead of polling the database it
 * keeps one timer aimed at the earliest pending deadline: one sweep at start, a re-arm whenever a
 * QRIS payment is created, and a re-arm after each sweep. With no pending payment nothing is
 * scheduled, so an idle API sends no queries (ADR-0011). Returns a stop function.
 */
export function startExpiryScheduler(
  service: PaymentService,
  changes: Pick<ChangeTracker, 'onPendingPayment'>,
  log: JobLog,
  clock: () => number = Date.now,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let armedFor = Number.POSITIVE_INFINITY;
  let running = false;
  let rerun = false;
  let stopped = false;

  const arm = (atMs: number, minDelayMs = 0): void => {
    if (stopped || atMs >= armedFor) return;
    if (timer) clearTimeout(timer);
    armedFor = atMs;
    const delay = Math.min(Math.max(atMs - clock() + 50, minDelayMs), MAX_TIMER_MS);
    timer = setTimeout(() => {
      timer = undefined;
      armedFor = Number.POSITIVE_INFINITY;
      sweep();
    }, delay);
    timer.unref();
  };

  const sweep = (): void => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    void (async () => {
      try {
        const n = await service.expireDue();
        if (n > 0) log.info({ expired: n }, 'expired pending QRIS payments');
        const next = await service.nextExpiry();
        if (next) arm(next.getTime(), next.getTime() <= clock() ? RETRY_MS : 0);
      } catch (err: unknown) {
        log.error({ err }, 'QRIS expiry sweep failed');
        arm(clock() + RETRY_MS, RETRY_MS);
      } finally {
        running = false;
        if (rerun) {
          rerun = false;
          sweep();
        }
      }
    })();
  };

  changes.onPendingPayment((expiresAt) => arm(expiresAt.getTime()));
  sweep();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function loadTransactionOf(db: DbOrTx, transactionId: string) {
  const dto = await loadTransactionDto(db, transactionId);
  if (!dto) throw errors.notFound('Transaction not found');
  return dto;
}
