export type SqlValue = string | number | null;

/** Thin async SQLite surface so repositories run on expo-sqlite in the app and node:sqlite in tests. */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /**
   * Runs `fn` atomically: commit when it resolves, roll back when it throws. `fn` must do all its
   * queries on the `tx` it receives: on the device that is a separate exclusive connection, so a
   * background sync write can never interleave with (or fail) a sale being saved.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export async function get<T>(
  db: Db,
  sql: string,
  params?: readonly SqlValue[],
): Promise<T | undefined> {
  return (await db.all<T>(sql, params))[0];
}
