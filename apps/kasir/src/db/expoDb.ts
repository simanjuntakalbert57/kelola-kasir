import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';
import type { Db } from './types';

type Queryable = Pick<SQLite.SQLiteDatabase, 'execAsync' | 'runAsync' | 'getAllAsync'>;

const wrap = (native: Queryable, transaction: Db['transaction']): Db => ({
  exec: (sql) => native.execAsync(sql),
  run: async (sql, params = []) => {
    await native.runAsync(sql, [...params]);
  },
  all: (sql, params = []) => native.getAllAsync(sql, [...params]),
  transaction,
});

/** Local SQLite (`kasir.db`) on the device. Opened and migrated once per app start. */
export async function openDatabase(name = 'kasir.db'): Promise<Db> {
  const native = await SQLite.openDatabaseAsync(name);
  await native.execAsync('PRAGMA journal_mode = WAL');
  // Exclusive transactions run on their own connection and are queued by expo-sqlite, so a sync
  // push/pull in the middle of a sale waits instead of failing it with "Gagal menyimpan".
  const db: Db = wrap(native, async <T>(fn: (tx: Db) => Promise<T>) => {
    let out: T | undefined;
    await native.withExclusiveTransactionAsync(async (txn) => {
      // Not nested anywhere in the app: no savepoints on the exclusive connection.
      out = await fn(
        wrap(txn, () => {
          throw new Error('Nested transactions are not supported');
        }),
      );
    });
    return out as T;
  });
  await migrate(db);
  return db;
}
