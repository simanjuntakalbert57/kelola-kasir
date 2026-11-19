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
  // ADR-0023 §4: discount rules synced per outlet. An older APK already moved the cursor past discount rows it
  // ignored, so the cursor is cleared: the next pull is a full snapshot that fills this table.
  `
  CREATE TABLE discounts (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    product_ids TEXT NOT NULL,
    category_ids TEXT NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT,
    days_of_week TEXT,
    time_start TEXT,
    time_end TEXT,
    utc_offset_minutes INTEGER NOT NULL
  );
  ALTER TABLE transactions ADD COLUMN discount_names TEXT;
  DELETE FROM meta WHERE key = 'sync_cursor';
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
