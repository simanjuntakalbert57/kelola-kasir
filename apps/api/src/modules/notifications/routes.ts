import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { isUniqueViolation, type DbOrTx } from '../../db/client.js';
import { notificationLog, notificationPrefs, pushSubscriptions } from '../../db/schema.js';
import { AppError, errors } from '../../errors.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { isAllowedPushEndpoint, isBase64UrlOfLength, MAX_ENDPOINT_LENGTH } from './endpoint.js';
import { renderTest } from './messages.js';
import { TEST_TTL_SEC, type Notifier } from './notifier.js';
import type { PushClient } from './push-client.js';

export const MAX_ACTIVE_SUBSCRIPTIONS = 10;
const REGISTER_LIMIT = 20;
const REGISTER_WINDOW_MS = 10 * 60 * 1000;
const TEST_INTERVAL_MS = 5000;

const idParams = z.object({ id: uuid });
const subscriptionBody = z.object({
  endpoint: z.string().max(MAX_ENDPOINT_LENGTH),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }).strict(),
  label: z.string().trim().min(1).max(60),
});
const prefsBody = z
  .object({ transaction: z.boolean().optional(), void: z.boolean().optional() })
  .strict()
  .refine((v) => v.transaction !== undefined || v.void !== undefined, 'At least one field');

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

const toDto = (row: SubscriptionRow) => ({
  id: row.id,
  label: row.label,
  status: row.revokedAt ? ('expired' as const) : ('active' as const),
  created_at: row.createdAt.toISOString(),
  last_delivered_at: row.lastDeliveredAt ? row.lastDeliveredAt.toISOString() : null,
});

const invalidSubscription = (detail: string) =>
  errors.badRequest('INVALID_PUSH_SUBSCRIPTION', 'Invalid push subscription', detail);

/** Sliding-window counter kept in memory (single API process). */
function createLimiter(windowMs: number, max: number, now: () => Date) {
  const hits = new Map<string, number[]>();
  return (key: string): number | undefined => {
    const t = now().getTime();
    const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      const first = recent[0] ?? t;
      return Math.max(1, Math.ceil((first + windowMs - t) / 1000));
    }
    recent.push(t);
    hits.set(key, recent);
    return undefined;
  };
}

function deriveUserAgent(header: string | string[] | undefined): string | null {
  const ua = Array.isArray(header) ? header[0] : header;
  return ua ? ua.slice(0, 300) : null;
}

export function notificationRoutes(
  ctx: AppContext,
  guards: Guards,
  notifier: Notifier,
  client: PushClient | null,
) {
  const { db } = ctx;
  const registerLimiter = createLimiter(REGISTER_WINDOW_MS, REGISTER_LIMIT, ctx.now);
  const testLimiter = createLimiter(TEST_INTERVAL_MS, 1, ctx.now);

  const ownerRole: preHandlerAsyncHookHandler = async (req) => {
    if (req.principal?.type !== 'user' || req.principal.role !== 'owner') {
      throw errors.forbidden('Only the owner can manage notifications');
    }
  };
  const ownerOnly = [guards.owner, ownerRole];

  const requireConfigured = (): PushClient => {
    if (!ctx.config.webPush || !client) {
      throw errors.unavailable(
        'NOTIFICATIONS_NOT_CONFIGURED',
        'Notifications are not available',
        'Web Push (VAPID) is not configured on this server',
      );
    }
    return client;
  };

  async function revoke(
    sub: SubscriptionRow,
    reason: 'user' | 'replaced' | 'limit',
    actor: { type: 'user' | 'system'; id: string | null },
    tx: DbOrTx = db,
  ): Promise<void> {
    const at = ctx.now();
    await tx
      .update(pushSubscriptions)
      .set({ revokedAt: at, revokedReason: reason, updatedAt: at })
      .where(and(eq(pushSubscriptions.id, sub.id), isNull(pushSubscriptions.revokedAt)));
    await writeAudit(tx, {
      outletId: sub.outletId,
      actor,
      action: 'notification.subscription_revoked',
      entityType: 'push_subscription',
      entityId: sub.id,
      meta: { subscription_id: sub.id, label: sub.label, reason },
    });
  }

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/notifications/push/config', { preHandler: ownerOnly }, async () => ({
      configured: ctx.config.webPush !== null,
      vapid_public_key: ctx.config.webPush?.publicKey ?? null,
    }));

    app.get('/notifications/push/subscriptions', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      const rows = await db
        .select()
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.outletId, principal.outletId),
            eq(pushSubscriptions.userId, principal.id),
            or(isNull(pushSubscriptions.revokedAt), eq(pushSubscriptions.revokedReason, 'gone')),
          ),
        )
        .orderBy(desc(pushSubscriptions.createdAt));
      return { items: rows.map(toDto) };
    });

    app.post('/notifications/push/subscriptions', { preHandler: ownerOnly }, async (req, reply) => {
      const principal = requireUser(req);
      requireConfigured();
      const wait = registerLimiter(principal.id);
      if (wait !== undefined) {
        throw errors.tooManyRequests(
          'RATE_LIMITED',
          'Too many registrations, try again later',
          wait,
        );
      }
      const body = parse(subscriptionBody, req.body);
      if (!isAllowedPushEndpoint(body.endpoint)) {
        throw invalidSubscription('Endpoint is not an allowed push service');
      }
      if (!isBase64UrlOfLength(body.keys.p256dh, 65) || !isBase64UrlOfLength(body.keys.auth, 16)) {
        throw invalidSubscription('Invalid subscription keys');
      }
      const userAgent = deriveUserAgent(req.headers['user-agent']);

      const upsert = () =>
        db.transaction(async (tx) => {
          const at = ctx.now();
          const [existing] = await tx
            .select()
            .from(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.endpoint, body.endpoint),
                isNull(pushSubscriptions.revokedAt),
              ),
            )
            .for('update');
          if (
            existing &&
            existing.userId === principal.id &&
            existing.outletId === principal.outletId
          ) {
            const [updated] = await tx
              .update(pushSubscriptions)
              .set({
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                label: body.label,
                userAgent,
                lastSeenAt: at,
                updatedAt: at,
              })
              .where(eq(pushSubscriptions.id, existing.id))
              .returning();
            if (!updated) throw new Error('subscription update failed');
            return { row: updated, created: false };
          }
          if (existing) await revoke(existing, 'replaced', { type: 'user', id: principal.id }, tx);
          const [row] = await tx
            .insert(pushSubscriptions)
            .values({
              outletId: principal.outletId,
              userId: principal.id,
              endpoint: body.endpoint,
              p256dh: body.keys.p256dh,
              auth: body.keys.auth,
              label: body.label,
              userAgent,
              lastSeenAt: at,
            })
            .returning();
          if (!row) throw new Error('subscription insert failed');
          const active = await tx
            .select()
            .from(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.outletId, principal.outletId),
                eq(pushSubscriptions.userId, principal.id),
                isNull(pushSubscriptions.revokedAt),
              ),
            )
            .orderBy(asc(pushSubscriptions.lastSeenAt), asc(pushSubscriptions.createdAt));
          const overflow = active.filter((s) => s.id !== row.id);
          for (const old of overflow.slice(
            0,
            Math.max(0, active.length - MAX_ACTIVE_SUBSCRIPTIONS),
          )) {
            await revoke(old, 'limit', { type: 'system', id: null }, tx);
          }
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor: { type: 'user', id: principal.id },
            action: 'notification.subscription_added',
            entityType: 'push_subscription',
            entityId: row.id,
            meta: { subscription_id: row.id, label: row.label },
          });
          return { row, created: true };
        });

      let result: Awaited<ReturnType<typeof upsert>>;
      try {
        result = await upsert();
      } catch (err) {
        // Two registrations of one endpoint raced; the loser re-runs as an update.
        if (!isUniqueViolation(err, 'push_subscriptions_endpoint_active_unique')) throw err;
        result = await upsert();
      }
      return reply.status(result.created ? 201 : 200).send(toDto(result.row));
    });

    app.delete(
      '/notifications/push/subscriptions/:id',
      { preHandler: ownerOnly },
      async (req, reply) => {
        const principal = requireUser(req);
        const { id } = parse(idParams, req.params);
        const [sub] = await db
          .select()
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, id),
              eq(pushSubscriptions.userId, principal.id),
              eq(pushSubscriptions.outletId, principal.outletId),
            ),
          );
        if (!sub) throw errors.notFound('Subscription not found');
        if (!sub.revokedAt) await revoke(sub, 'user', { type: 'user', id: principal.id });
        return reply.status(204).send();
      },
    );

    app.post(
      '/notifications/push/subscriptions/:id/test',
      { preHandler: ownerOnly },
      async (req) => {
        const principal = requireUser(req);
        const push = requireConfigured();
        const { id } = parse(idParams, req.params);
        const [sub] = await db
          .select()
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, id),
              eq(pushSubscriptions.userId, principal.id),
              eq(pushSubscriptions.outletId, principal.outletId),
            ),
          );
        if (!sub || (sub.revokedAt && sub.revokedReason !== 'gone')) {
          throw errors.notFound('Subscription not found');
        }
        const gone = () =>
          new AppError(
            410,
            'NOTIFICATION_SUBSCRIPTION_GONE',
            'Gone',
            'The push service no longer knows this browser; register it again',
          );
        if (sub.revokedAt) throw gone();
        const wait = testLimiter(id);
        if (wait !== undefined) {
          throw errors.tooManyRequests('RATE_LIMITED', 'Wait a few seconds between tests', wait);
        }
        const payload = renderTest(sub.id, ctx.now());
        const result = await push.send(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          JSON.stringify(payload),
          { ttlSeconds: TEST_TTL_SEC, urgency: 'normal' },
        );
        const at = ctx.now();
        await db.insert(notificationLog).values({
          outletId: sub.outletId,
          subscriptionId: sub.id,
          event: 'subscription.test',
          entityId: randomUUID(),
          payload,
          ttlSeconds: TEST_TTL_SEC,
          status: result.ok ? 'sent' : 'failed',
          attempts: 1,
          lastError: result.ok ? null : result.error,
          sentAt: result.ok ? at : null,
        });
        if (result.ok) {
          await db
            .update(pushSubscriptions)
            .set({ lastDeliveredAt: at })
            .where(eq(pushSubscriptions.id, sub.id));
          return { result: 'sent' as const };
        }
        if (result.status === 404 || result.status === 410) {
          await notifier.markGone(sub.id);
          throw gone();
        }
        throw new AppError(
          502,
          'PUSH_DELIVERY_FAILED',
          'Bad gateway',
          'The push service did not accept the notification',
        );
      },
    );

    const loadPrefs = async (outletId: string, userId: string) => {
      const [row] = await db
        .select({ prefs: notificationPrefs.prefs })
        .from(notificationPrefs)
        .where(and(eq(notificationPrefs.outletId, outletId), eq(notificationPrefs.userId, userId)));
      const stored = (row?.prefs ?? {}) as Partial<Record<'transaction' | 'void', boolean>>;
      return { transaction: stored.transaction !== false, void: stored.void !== false };
    };

    app.get('/notifications/prefs', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      return loadPrefs(principal.outletId, principal.id);
    });

    app.patch('/notifications/prefs', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      const body = parse(prefsBody, req.body);
      return db.transaction(async (tx) => {
        const before = await loadPrefs(principal.outletId, principal.id);
        const after = {
          transaction: body.transaction ?? before.transaction,
          void: body.void ?? before.void,
        };
        await tx
          .insert(notificationPrefs)
          .values({ outletId: principal.outletId, userId: principal.id, prefs: after })
          .onConflictDoUpdate({
            target: [notificationPrefs.outletId, notificationPrefs.userId],
            set: { prefs: after, updatedAt: sql`now()` },
          });
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'notification.prefs_updated',
          entityType: 'notification_prefs',
          entityId: principal.id,
          before,
          after,
        });
        return after;
      });
    });
  };
}
