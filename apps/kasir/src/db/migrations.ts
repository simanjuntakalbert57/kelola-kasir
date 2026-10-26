import { get, type Db } from './types';

/** Append-only list: index + 1 is the `user_version` after the step ran. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_url TEXT,
    price INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    is_sold_out INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX products_category ON products (category_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE day_counters (day TEXT PRIMARY KEY, seq INTEGER NOT NULL);
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL,
    cash_tendered INTEGER,
    cash_change INTEGER,
    customer_label TEXT,
    created_at TEXT NOT NULL,
    body TEXT NOT NULL,
    sync_state TEXT NOT NULL
  );
  CREATE TABLE transaction_items (
    transaction_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX transaction_items_product ON transaction_items (product_id, created_at);
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    employee_id TEXT,
    client_created_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT
  );
  CREATE INDEX outbox_state ON outbox (state, seq);
  `,
  `
  ALTER TABLE transactions ADD COLUMN void_reason TEXT;
  CREATE INDEX transactions_shift ON transactions (shift_id, created_at);
  `,
];

export async function migrate(db: Db): Promise<void> {
  const row = await get<{ user_version: number }>(db, 'PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[v] ?? '');
      await tx.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
