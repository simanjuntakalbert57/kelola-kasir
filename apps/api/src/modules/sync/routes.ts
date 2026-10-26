import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse } from '../../lib/validate.js';
import type { Guards } from '../../plugins/auth.js';
import { MAX_PULL, pullChanges } from './pull.js';
import { pushBodySchema, pushMutations } from './push.js';

const pullQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PULL).default(MAX_PULL),
});

export function syncRoutes(ctx: AppContext, guards: Guards) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/sync/pull', { preHandler: guards.device }, async (req) => {
      const device = req.device;
      if (!device) throw errors.unauthorized();
      const q = parse(pullQuery, req.query);
      return pullChanges(ctx.db, {
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
