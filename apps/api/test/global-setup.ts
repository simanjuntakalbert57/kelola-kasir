import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Integration tests run against real PostgreSQL 16. By default a Testcontainers instance is started;
 * set TEST_DATABASE_URL (a server where the user may CREATE DATABASE) to reuse an existing server,
 * e.g. when Docker is not available.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let adminUrl = process.env['TEST_DATABASE_URL'];
  if (!adminUrl) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    adminUrl = container.getConnectionUri();
  }

  const dbName = `kk_test_${Date.now()}_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const handle = createDb(url.toString());
  await runMigrations(handle.db);
  await handle.close();
  project.provide('databaseUrl', url.toString());

  return async () => {
    if (container) {
      await container.stop();
      return;
    }
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await cleanup.end();
  };
}
