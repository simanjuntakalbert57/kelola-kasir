import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { startExpiryJob } from './modules/payments/service.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const app = await buildApp({ config, db: handle.db });

  const stopExpiry = startExpiryJob(app.payments, app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    stopExpiry();
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
