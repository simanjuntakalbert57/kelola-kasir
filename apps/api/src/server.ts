import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createErrorReporter } from './lib/error-reporter.js';
import { startNotificationJob } from './modules/notifications/notifier.js';
import { startExpiryJob } from './modules/payments/service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: config.dbPoolMax });
  const reportError = config.sentry
    ? createErrorReporter({
        ...config.sentry,
        // Render exposes the deployed commit; it becomes the Sentry release.
        ...(process.env['RENDER_GIT_COMMIT'] ? { release: process.env['RENDER_GIT_COMMIT'] } : {}),
      })
    : undefined;
  const app = await buildApp({ config, db: handle.db, ...(reportError ? { reportError } : {}) });

  const stopExpiry = startExpiryJob(app.payments, app.log);
  const stopNotifications = startNotificationJob(app.notifier, app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    stopExpiry();
    stopNotifications();
    await app.notifier.idle();
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error('Failed to start', err);
  process.exit(1);
});
