import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './client.js';
import { createDb } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `drizzle/` sits at the package root, next to both `src/` and `dist/`. */
export const MIGRATIONS_FOLDER = path.resolve(here, '../../drizzle');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  runMigrations(handle.db)
    .then(() => handle.close())
    .then(() => console.error('Migrations applied'))
    .catch((err: unknown) => {
      console.error('Migration failed', err);
      process.exit(1);
    });
}
