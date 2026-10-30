import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  employees,
  notificationLog,
  notificationPrefs,
  outletMembers,
  outlets,
  pushSubscriptions,
  transactionItems,
  transactions,
  users,
  voidRequests,
} from '../../db/schema.js';
import { writeAudit } from '../audit/audit.js';
import {
  renderBatch,
  renderTransaction,
  renderVoidApproved,
  renderVoidRequested,
  type PushPayload,
} from './messages.js';
import type { PushClient, PushResult } from './push-client.js';

export type NotificationEvent =
  | 'transaction.paid'
  | 'transaction.batch'
  | 'void.requested'
  | 'void.approved'
  | 'subscription.test';

export const EVENT_TTL_SEC = 4 * 60 * 60;
export const TEST_TTL_SEC = 60;
export const MAX_ATTEMPTS = 5;
/** Backoff after the n-th failed attempt (seconds). */
export const BACKOFF_SEC = [30, 120, 600, 1800];
const DEFAULT_RETRY_AFTER_SEC = 60;
const BATCH_SIZE = 50;
const CONCURRENCY = 5;
/** A claimed row is invisible to other runs for this long (covers a crash mid-send). */
const LEASE_SEC = 120;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const BATCH_THRESHOLD = 3;

export interface NotifierLog {
  error: (obj: unknown, msg: string) => void;
  info: (obj: unknown, msg: string) => void;
}

export interface NotifierDeps {
  db: Database;
  now: () => Date;
  /** `null` when VAPID is not configured: the notifier does nothing. */
  client: PushClient | null;
  log: NotifierLog;
  onError?: (err: unknown, where: string) => void;
}

export interface Notifier {
  readonly enabled: boolean;
  onTransactionPaid(transactionId: string): void;
  /** Transactions a `sync/push` applied as `paid`; >3 are summarised in one message. */
  onSyncApplied(transactionIds: string[]): void;
  onVoidRequested(voidRequestId: string): void;
  /** `excludeUserId`: the owner who decided from the dashboard does not need to be told. */
  onVoidApproved(input: {
    transactionId: string;
    voidRequestId?: string;
    approverUserId: string;
    excludeUserId?: string;
  }): void;
  /** Start a dispatcher round now (single-flight; never throws). */
  kick(): void;
  /** Resolves when no enqueue or dispatch is in flight (tests). */
  idle(): Promise<void>;
  /** Mark stale rows expired, send due ones. Resolves with the number of rows attempted. */
  dispatchDue(): Promise<number>;
  /** Delete old log rows and revoked subscriptions (once a day is enough). */
  cleanup(): Promise<void>;
  /** Revoke a subscription the push service reported gone. */
  markGone(subscriptionId: string): Promise<void>;
}

type Category = 'transaction' | 'void';
const categoryOf = (event: NotificationEvent): Category =>
  event === 'transaction.paid' || event === 'transaction.batch' ? 'transaction' : 'void';

const noopNotifier: Notifier = {
  enabled: false,
  onTransactionPaid: () => undefined,
  onSyncApplied: () => undefined,
  onVoidRequested: () => undefined,
  onVoidApproved: () => undefined,
  kick: () => undefined,
  idle: () => Promise.resolve(),
  dispatchDue: () => Promise.resolve(0),
  cleanup: () => Promise.resolve(),
  markGone: () => Promise.resolve(),
};

export function createNotifier(deps: NotifierDeps): Notifier {
  const { db, now, log } = deps;
  if (!deps.client) return noopNotifier;
  const client: PushClient = deps.client;

  const inflight = new Set<Promise<unknown>>();
  const track = (work: Promise<unknown>): void => {
    const p = work.finally(() => inflight.delete(p));
    inflight.add(p);
  };
  const fail = (where: string) => (err: unknown) => {
    log.error({ err, where }, 'notification failed');
    deps.onError?.(err, where);
  };

  /** Fire and forget: runs enqueue work off the request path and never rejects. */
  const background = (where: string, work: () => Promise<void>): void => {
    track(
      Promise.resolve()
        .then(work)
        .then(() => kick())
        .catch(fail(where)),
    );
  };

  async function recipients(
    outletId: string,
    category: Category,
    excludeUserId?: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ id: pushSubscriptions.id, prefs: notificationPrefs.prefs })
      .from(pushSubscriptions)
      .innerJoin(
        outletMembers,
        and(
          eq(outletMembers.outletId, pushSubscriptions.outletId),
          eq(outletMembers.userId, pushSubscriptions.userId),
          eq(outletMembers.role, 'owner'),
        ),
      )
      .innerJoin(users, and(eq(users.id, pushSubscriptions.userId), eq(users.isActive, true)))
      .leftJoin(
        notificationPrefs,
        and(
          eq(notificationPrefs.outletId, pushSubscriptions.outletId),
          eq(notificationPrefs.userId, pushSubscriptions.userId),
        ),
      )
      .where(
        and(
          eq(pushSubscriptions.outletId, outletId),
          isNull(pushSubscriptions.revokedAt),
          excludeUserId ? ne(pushSubscriptions.userId, excludeUserId) : undefined,
        ),
      );
    return rows
      .filter((r) => (r.prefs as Partial<Record<Category, boolean>> | null)?.[category] !== false)
      .map((r) => r.id);
  }

  async function enqueue(
    outletId: string,
    event: NotificationEvent,
    entityId: string,
    payload: PushPayload,
    excludeUserId?: string,
  ): Promise<void> {
    const subscriptionIds = await recipients(outletId, categoryOf(event), excludeUserId);
    if (subscriptionIds.length === 0) return;
    await db
      .insert(notificationLog)
      .values(
        subscriptionIds.map((subscriptionId) => ({
          outletId,
          subscriptionId,
          event,
          entityId,
          payload,
          ttlSeconds: EVENT_TTL_SEC,
          nextAttemptAt: now(),
        })),
      )
      .onConflictDoNothing();
  }

  async function loadTransactions(ids: string[]) {
    return db
      .select({
        id: transactions.id,
        outletId: transactions.outletId,
        number: transactions.number,
        total: transactions.total,
        method: transactions.paymentMethod,
        status: transactions.status,
        paidAt: transactions.paidAt,
        clientCreatedAt: transactions.clientCreatedAt,
        cashier: employees.name,
        timeZone: outlets.timezone,
        items: sql<number>`coalesce((select sum(${transactionItems.quantity}) from ${transactionItems} where ${transactionItems.transactionId} = ${transactions.id}), 0)::int`,
      })
      .from(transactions)
      .innerJoin(employees, eq(employees.id, transactions.employeeId))
      .innerJoin(outlets, eq(outlets.id, transactions.outletId))
      .where(inArray(transactions.id, ids));
  }

  async function enqueueSingle(id: string, offline: boolean): Promise<void> {
    const [t] = await loadTransactions([id]);
    if (!t || t.status === 'pending' || t.status === 'cancelled') return;
    const payload = renderTransaction(
      {
        transactionId: t.id,
        number: t.number,
        total: t.total,
        method: t.method,
        itemCount: t.items,
        cashierName: t.cashier,
        at: offline ? t.clientCreatedAt : (t.paidAt ?? t.clientCreatedAt),
        timeZone: t.timeZone,
      },
      offline,
      now(),
    );
    await enqueue(t.outletId, 'transaction.paid', t.id, payload);
  }

  async function dispatchRound(): Promise<number> {
    const at = now();
    await db
      .update(notificationLog)
      .set({ status: 'expired' })
      .where(
        and(
          eq(notificationLog.status, 'pending'),
          sql`${notificationLog.createdAt} + make_interval(secs => ${notificationLog.ttlSeconds}) <= ${at}`,
        ),
      );
    const claimed = await db.transaction(async (tx) => {
      const due = await tx
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(and(eq(notificationLog.status, 'pending'), lte(notificationLog.nextAttemptAt, at)))
        .orderBy(notificationLog.createdAt)
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (due.length === 0) return [];
      const ids = due.map((d) => d.id);
      await tx
        .update(notificationLog)
        .set({ nextAttemptAt: new Date(at.getTime() + LEASE_SEC * 1000) })
        .where(inArray(notificationLog.id, ids));
      return ids;
    });
    if (claimed.length === 0) return 0;

    const rows = await db
      .select({
        log: notificationLog,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        revokedAt: pushSubscriptions.revokedAt,
      })
      .from(notificationLog)
      .innerJoin(pushSubscriptions, eq(pushSubscriptions.id, notificationLog.subscriptionId))
      .where(inArray(notificationLog.id, claimed));

    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const row = rows[cursor++];
        if (!row) return;
        try {
          if (row.revokedAt) {
            await settleFailed(row.log.id, 'subscription revoked');
            continue;
          }
          const result = await client.send(
            { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
            JSON.stringify(row.log.payload),
            { ttlSeconds: row.log.ttlSeconds, urgency: 'high' },
          );
          await settle(row.log.id, row.log.subscriptionId, row.log.attempts, result);
        } catch (err) {
          fail('notification dispatch')(err);
          // Release the lease so the row is retried on the next round.
          await db
            .update(notificationLog)
            .set({ nextAttemptAt: now() })
            .where(eq(notificationLog.id, row.log.id))
            .catch(() => undefined);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    return rows.length;
  }

  async function settleFailed(logId: string, error: string): Promise<void> {
    await db
      .update(notificationLog)
      .set({ status: 'failed', lastError: error })
      .where(eq(notificationLog.id, logId));
  }

  async function markGone(subscriptionId: string): Promise<void> {
    const at = now();
    const revoked = await db
      .update(pushSubscriptions)
      .set({ revokedAt: at, revokedReason: 'gone', updatedAt: at })
      .where(and(eq(pushSubscriptions.id, subscriptionId), isNull(pushSubscriptions.revokedAt)))
      .returning({ outletId: pushSubscriptions.outletId, label: pushSubscriptions.label });
    await db
      .update(notificationLog)
      .set({ status: 'failed', lastError: 'subscription gone' })
      .where(
        and(
          eq(notificationLog.subscriptionId, subscriptionId),
          eq(notificationLog.status, 'pending'),
        ),
      );
    const [row] = revoked;
    if (row) {
      await writeAudit(db, {
        outletId: row.outletId,
        actor: { type: 'system', id: null },
        action: 'notification.subscription_revoked',
        entityType: 'push_subscription',
        entityId: subscriptionId,
        meta: { subscription_id: subscriptionId, label: row.label, reason: 'gone' },
      });
    }
  }

  async function settle(
    logId: string,
    subscriptionId: string,
    attempts: number,
    result: PushResult,
  ): Promise<void> {
    const at = now();
    if (result.ok) {
      await db
        .update(notificationLog)
        .set({ status: 'sent', sentAt: at, lastError: null })
        .where(eq(notificationLog.id, logId));
      await db
        .update(pushSubscriptions)
        .set({ lastDeliveredAt: at })
        .where(eq(pushSubscriptions.id, subscriptionId));
      return;
    }
    const { status } = result;
    if (status === 404 || status === 410) {
      await settleFailed(logId, result.error);
      await markGone(subscriptionId);
      return;
    }
    if (status === 429) {
      const wait = result.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC;
      await db
        .update(notificationLog)
        .set({ nextAttemptAt: new Date(at.getTime() + wait * 1000), lastError: result.error })
        .where(eq(notificationLog.id, logId));
      return;
    }
    if (status === 400 || status === 401 || status === 403 || status === 413) {
      // Payload or VAPID key is wrong: retrying cannot help.
      log.error({ status, logId }, 'push service rejected the message');
      await settleFailed(logId, result.error);
      return;
    }
    const next = attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await db
        .update(notificationLog)
        .set({ status: 'failed', attempts: next, lastError: result.error })
        .where(eq(notificationLog.id, logId));
      return;
    }
    const wait = BACKOFF_SEC[Math.min(next - 1, BACKOFF_SEC.length - 1)] ?? 1800;
    await db
      .update(notificationLog)
      .set({
        attempts: next,
        nextAttemptAt: new Date(at.getTime() + wait * 1000),
        lastError: result.error,
      })
      .where(eq(notificationLog.id, logId));
  }

  let running: Promise<void> | undefined;
  let again = false;
  function kick(): void {
    if (running) {
      again = true;
      return;
    }
    const run = (async () => {
      do {
        again = false;
        for (;;) {
          const n = await dispatchRound();
          if (n < BATCH_SIZE) break;
        }
      } while (again);
    })()
      .catch(fail('notification dispatcher'))
      .finally(() => {
        running = undefined;
      });
    running = run;
    track(run);
  }

  return {
    enabled: true,

    onTransactionPaid(transactionId) {
      background('notify transaction', () => enqueueSingle(transactionId, false));
    },

    onSyncApplied(transactionIds) {
      if (transactionIds.length === 0) return;
      background('notify sync', async () => {
        if (transactionIds.length <= BATCH_THRESHOLD) {
          for (const id of transactionIds) await enqueueSingle(id, true);
          return;
        }
        const rows = (await loadTransactions(transactionIds)).filter((t) => t.status !== 'pending');
        const [first] = rows;
        if (!first) return;
        const sorted = rows.map((r) => r.id).sort();
        const entityId = sorted[0] ?? first.id;
        const cashiers = [...new Set(rows.map((r) => r.cashier))];
        const payload = renderBatch(
          {
            entityId,
            count: rows.length,
            total: rows.reduce((sum, r) => sum + r.total, 0),
            cashCount: rows.filter((r) => r.method === 'cash').length,
            qrisCount: rows.filter((r) => r.method === 'qris').length,
            cashierNames: cashiers,
            syncedAt: now(),
            timeZone: first.timeZone,
          },
          now(),
        );
        await enqueue(first.outletId, 'transaction.batch', entityId, payload);
      });
    },

    onVoidRequested(voidRequestId) {
      background('notify void requested', async () => {
        const [v] = await db
          .select({
            requestedAt: voidRequests.requestedAt,
            transactionId: voidRequests.transactionId,
          })
          .from(voidRequests)
          .where(eq(voidRequests.id, voidRequestId));
        if (!v) return;
        const [t] = await loadTransactions([v.transactionId]);
        if (!t) return;
        await enqueue(
          t.outletId,
          'void.requested',
          voidRequestId,
          renderVoidRequested(
            {
              entityId: voidRequestId,
              number: t.number,
              total: t.total,
              method: t.method,
              personName: t.cashier,
              at: v.requestedAt,
              transactionAt: t.clientCreatedAt,
              timeZone: t.timeZone,
            },
            now(),
          ),
        );
      });
    },

    onVoidApproved(input) {
      background('notify void approved', async () => {
        const [t] = await loadTransactions([input.transactionId]);
        const [approver] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, input.approverUserId));
        if (!t || !approver) return;
        const entityId = input.voidRequestId ?? input.transactionId;
        await enqueue(
          t.outletId,
          'void.approved',
          entityId,
          renderVoidApproved(
            {
              entityId,
              number: t.number,
              total: t.total,
              method: t.method,
              personName: approver.name,
              at: now(),
              transactionAt: t.clientCreatedAt,
              timeZone: t.timeZone,
            },
            now(),
          ),
          input.excludeUserId,
        );
      });
    },

    kick,

    async idle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },

    async dispatchDue() {
      if (running) await running;
      return dispatchRound();
    },

    async cleanup() {
      const cutoff = new Date(now().getTime() - RETENTION_MS);
      await db
        .delete(notificationLog)
        .where(and(ne(notificationLog.status, 'pending'), lte(notificationLog.createdAt, cutoff)));
      // Log rows of a deleted subscription cascade.
      await db.delete(pushSubscriptions).where(lte(pushSubscriptions.revokedAt, cutoff));
    },

    markGone,
  };
}

/** Periodic dispatcher (retry after restarts/failures) and daily cleanup. Returns a stop function. */
export function startNotificationJob(
  notifier: Notifier,
  log: NotifierLog,
  intervalMs = 30_000,
): () => void {
  if (!notifier.enabled) return () => undefined;
  let lastCleanup = 0;
  const timer = setInterval(() => {
    notifier.kick();
    if (Date.now() - lastCleanup > 24 * 60 * 60 * 1000) {
      lastCleanup = Date.now();
      notifier.cleanup().catch((err: unknown) => log.error({ err }, 'notification cleanup failed'));
    }
  }, intervalMs);
  timer.unref();
  // Pick up rows left pending by a previous process.
  notifier.kick();
  return () => clearInterval(timer);
}

export const newTestEntityId = (): string => randomUUID();
