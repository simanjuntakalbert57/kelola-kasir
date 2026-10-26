import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
/** Either the database or a transaction handle: services accept both. */
export type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface DbOptions {
  /** Pool size. Neon free tier: keep it small (ADR-0011). */
  max?: number;
}

export function createDb(connectionString: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    // Neon scales to zero; waking a compute takes a few hundred milliseconds, sometimes seconds.
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 60_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Postgres error carried by pg errors, possibly wrapped by Drizzle in `cause`. */
export function pgError(err: unknown): { code?: string; constraint?: string } | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
