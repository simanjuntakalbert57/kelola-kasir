import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import type { Database } from './db/client.js';
import { TokenService } from './lib/jwt.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { employeeRoutes } from './modules/employees/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { createPaymentService } from './modules/payments/service.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { shiftRoutes } from './modules/shifts/routes.js';
import { syncRoutes } from './modules/sync/routes.js';
import { transactionRoutes } from './modules/transactions/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { createGuards } from './plugins/auth.js';
import { registerProblemHandlers } from './plugins/problem.js';

export interface BuildAppOptions {
  config: Config;
  db: Database;
  /** Override the clock (tests). */
  now?: () => Date;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const ctx: AppContext = {
    config,
    db: options.db,
    tokens: new TokenService(config.jwtPrivateKeyPem),
    now: options.now ?? (() => new Date()),
  };

  const app = Fastify({
    trustProxy: config.trustProxy,
    genReqId: () => randomUUID(),
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Never log credentials: PINs, passwords and tokens are redacted wherever they appear.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-device-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
          },
  });

  registerProblemHandlers(app);
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, { global: false });

  const guards = createGuards(ctx);
  const payments = createPaymentService(ctx);
  app.decorate('payments', payments);
  await app.register(healthRoutes(ctx));
  await app.register(
    async (v1) => {
      await v1.register(authRoutes(ctx, guards));
      await v1.register(deviceRoutes(ctx, guards));
      await v1.register(employeeRoutes(ctx, guards));
      await v1.register(shiftRoutes(ctx, guards));
      await v1.register(catalogRoutes(ctx, guards));
      await v1.register(settingsRoutes(ctx, guards));
      await v1.register(uploadRoutes(ctx, guards));
      await v1.register(transactionRoutes(ctx, guards));
      await v1.register(paymentRoutes(ctx, guards, payments));
      await v1.register(syncRoutes(ctx, guards));
    },
    { prefix: '/v1' },
  );
  return app;
}
