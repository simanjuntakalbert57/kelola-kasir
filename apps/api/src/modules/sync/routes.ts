import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { devices } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { parse } from '../../lib/validate.js';
import type { Guards } from '../../plugins/auth.js';
import { MAX_PULL, pullChanges } from './pull.js';
import { pushBodySchema, pushMutations } from './push.js';

const pullQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PULL).default(MAX_PULL),
});

const APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;

export function syncRoutes(ctx: AppContext, guards: Guards) {
  /**
   * The app announces its version in `X-App-Version` (ADR-0023 §3); the owner's dashboard lists devices that are too
   * old for discounts. A malformed value is ignored, never an error: the sync itself must not fail over it.
   */
  const recordAppVersion = async (req: FastifyRequest, deviceId: string): Promise<void> => {
    const raw = req.headers['x-app-version'];
    const version = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!version || !APP_VERSION_PATTERN.test(version)) return;
    await ctx.db
      .update(devices)
      .set({ appVersion: version })
      // Every pull (once a minute per phone) comes through here: only write when the version changed.
      .where(and(eq(devices.id, deviceId), sql`${devices.appVersion} is distinct from ${version}`));
  };

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/sync/pull', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const q = parse(pullQuery, req.query);
      await recordAppVersion(req, device.id);
      return pullChanges(ctx.db, {
        now: ctx.now(),
        outletId: device.outletId,
        deviceId: device.id,
        cursor: q.cursor,
        limit: q.limit,
      });
    });

    app.post('/sync/push', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const body = parse(pushBodySchema, req.body);
      await recordAppVersion(req, device.id);
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
