import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';

export function healthRoutes(ctx: AppContext) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/healthz', async (_req, reply) => {
      try {
        await ctx.db.execute(sql`select 1`);
        return { status: 'ok', db: 'up' };
      } catch {
        return reply.status(503).send({ status: 'degraded', db: 'down' });
      }
    });
  };
}
