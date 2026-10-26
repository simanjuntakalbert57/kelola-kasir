import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations';
import type { Db, SqlValue } from './types';

/** In-memory SQLite for unit tests (node:sqlite), same SQL dialect as the app's expo-sqlite. */
export async function createTestDb(): Promise<Db> {
  const native = new DatabaseSync(':memory:');
  let depth = 0;
  const db: Db = {
    exec: (sql) => Promise.resolve(void native.exec(sql)),
    run: (sql, params = []) =>
      Promise.resolve(void native.prepare(sql).run(...(params as SqlValue[]))),
    all: <T>(sql: string, params: readonly SqlValue[] = []) =>
      Promise.resolve(native.prepare(sql).all(...(params as SqlValue[])) as T[]),
    transaction: async <T>(fn: () => Promise<T>) => {
      if (depth++ === 0) native.exec('BEGIN');
      try {
        const out = await fn();
        if (--depth === 0) native.exec('COMMIT');
        return out;
      } catch (error) {
        if (--depth === 0) native.exec('ROLLBACK');
        throw error;
      }
    },
  };
  await migrate(db);
  return db;
}
