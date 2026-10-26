import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';

export function healthRoutes(ctx: AppContext) {
  return async (app: FastifyInstance): Promise<void> => {
    // Liveness without touching the database: Render's health check polls this, and a DB query
    // here would keep Neon's compute from scaling to zero (ADR-0011).
    app.get('/livez', async () => ({ status: 'ok' }));

    // Readiness including the database: uptime monitors and post-deploy checks.
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
