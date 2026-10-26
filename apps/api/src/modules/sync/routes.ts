import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { PullCache } from '../../lib/memory-cache.js';
import { parse } from '../../lib/validate.js';
import type { Guards } from '../../plugins/auth.js';
import { MAX_PULL, pullChanges } from './pull.js';
import { pushBodySchema, pushMutations } from './push.js';

const pullQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PULL).default(MAX_PULL),
});

export function syncRoutes(ctx: AppContext, guards: Guards) {
  // An idle cashier polls with the cursor it was just given: answer without touching the database
  // until something is written (ADR-0011). Only answers without changes are cached.
  const idleAnswers = new PullCache<Awaited<ReturnType<typeof pullChanges>>>();

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/sync/pull', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const q = parse(pullQuery, req.query);
      const key = `${q.cursor ?? ''}|${q.limit}`;
      const epoch = ctx.changes.epoch(); // read before the queries: a racing write bumps it later
      const nowMs = ctx.now().getTime();
      const cached = idleAnswers.get(device.id, key, epoch, nowMs);
      if (cached) return cached;
      const body = await pullChanges(ctx.db, {
        outletId: device.outletId,
        deviceId: device.id,
        cursor: q.cursor,
        limit: q.limit,
      });
      const { changes } = body;
      const idle =
        q.cursor !== undefined &&
        !body.has_more &&
        body.next_cursor === q.cursor &&
        changes.categories.length + changes.products.length + changes.employees.length === 0 &&
        changes.settings === null &&
        changes.deleted.length === 0;
      if (idle) idleAnswers.set(device.id, key, epoch, nowMs, body);
      return body;
    });

    app.post('/sync/push', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const body = parse(pushBodySchema, req.body);
      const results = await pushMutations(
        ctx,
        { id: device.id, code: device.code, outletId: device.outletId },
        body.mutations,
        req.ip,
      );
      return { results };
    });
  };
}
