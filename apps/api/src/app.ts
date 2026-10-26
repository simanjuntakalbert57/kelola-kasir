import { randomUUID } from 'node:crypto';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import type { Database } from './db/client.js';
import { AppError } from './errors.js';
import { clientIp } from './lib/client-ip.js';
import type { ErrorReporter } from './lib/error-reporter.js';
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
import { reportRoutes } from './modules/reports/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { voidRoutes } from './modules/voids/routes.js';
import { createGuards } from './plugins/auth.js';
import { registerProblemHandlers } from './plugins/problem.js';

export interface BuildAppOptions {
  config: Config;
  db: Database;
  /** Override the clock (tests). */
  now?: () => Date;
  /** Receives unexpected errors (HTTP 5xx), e.g. the Sentry reporter. */
  reportError?: ErrorReporter;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const ctx: AppContext = {
    config,
    db: options.db,
    tokens: new TokenService(config.jwtPrivateKeyPem),
    now: options.now ?? (() => new Date()),
  };

  const { trustProxy } = config;
  const app = Fastify({
    // A hop count trusts that many proxies in front of the API (Render's edge: 1).
    trustProxy:
      typeof trustProxy === 'number'
        ? (_address: string, hop: number) => hop < trustProxy
        : trustProxy,
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
                'req.headers["x-proxy-secret"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
          },
  });

  registerProblemHandlers(app);
  const { reportError } = options;
  if (reportError) {
    app.addHook('onError', async (req, _reply, error: FastifyError) => {
      // Domain errors (AppError) and client errors are expected; only report real failures.
      if (error instanceof AppError || (error.statusCode !== undefined && error.statusCode < 500)) {
        return;
      }
      void reportError(error, {
        method: req.method,
        route: req.routeOptions.url,
        requestId: req.id,
      });
    });
  }
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  // Render Free counts outbound bandwidth (ADR-0011): gzip JSON and CSV/XLSX exports.
  await app.register(compress, { global: true, threshold: 1024, encodings: ['gzip'] });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => clientIp(config, req),
  });

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
      await v1.register(voidRoutes(ctx, guards));
      await v1.register(reportRoutes(ctx, guards));
      await v1.register(paymentRoutes(ctx, guards, payments));
      await v1.register(syncRoutes(ctx, guards));
    },
    { prefix: '/v1' },
  );
  return app;
}
