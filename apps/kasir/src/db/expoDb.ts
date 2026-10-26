import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';
import type { Db } from './types';

/** Local SQLite (`kasir.db`) on the device. Opened and migrated once per app start. */
export async function openDatabase(name = 'kasir.db'): Promise<Db> {
  const native = await SQLite.openDatabaseAsync(name);
  await native.execAsync('PRAGMA journal_mode = WAL');
  const db: Db = {
    exec: (sql) => native.execAsync(sql),
    run: async (sql, params = []) => {
      await native.runAsync(sql, [...params]);
    },
    all: (sql, params = []) => native.getAllAsync(sql, [...params]),
    // Not nested anywhere in the app: expo-sqlite has no savepoints in withTransactionAsync.
    transaction: async <T>(fn: () => Promise<T>) => {
      let out: T | undefined;
      await native.withTransactionAsync(async () => {
        out = await fn();
      });
      return out as T;
    },
  };
  await migrate(db);
  return db;
}
