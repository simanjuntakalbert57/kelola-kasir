-- Wipe the sales and catalog data of ONE outlet, keeping the outlet itself, in a single transaction
-- (docs/ops/runbook.md § Reset). Used on 30 Oct 2026 to start JUS1 from zero after go-live (DEAR-119, DEAR-120).
--
--   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir -v code=JUS1 < reset-outlet-data.sql
--
-- Deleted for the outlet: transactions + items, payments, void requests, shifts, products, categories.
-- Kept: users, outlet, settings, members, employees, devices, sessions, notifications, idempotency keys, audit log.
-- Every row that is not deleted (all tables, all outlets) is fingerprinted (row count + md5) before the delete and
-- compared afterwards; any difference or an unknown outlet code aborts the whole transaction. The guard triggers are
-- disabled only inside the transaction. Tables are locked first so the API cannot add rows between snapshot and delete.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
LOCK TABLE transactions, transaction_items, payments, void_requests, shifts, products, categories IN ACCESS EXCLUSIVE MODE;
SELECT set_config('kk.code', :'code', true);

CREATE TEMP TABLE d_outlet ON COMMIT DROP AS SELECT id FROM outlets WHERE code = current_setting('kk.code');
DO $$
BEGIN
  IF (SELECT count(*) FROM d_outlet) <> 1 THEN
    RAISE EXCEPTION 'outlet % not found', current_setting('kk.code');
  END IF;
END $$;
CREATE TEMP TABLE d_tx ON COMMIT DROP AS SELECT id FROM transactions WHERE outlet_id IN (SELECT id FROM d_outlet);

-- Rows that go, per table.
CREATE TEMP VIEW doomed AS
  SELECT 'transactions' AS tbl, count(*) AS n FROM transactions WHERE id IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'transaction_items', count(*) FROM transaction_items WHERE transaction_id IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'payments', count(*) FROM payments WHERE transaction_id IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'void_requests', count(*) FROM void_requests WHERE transaction_id IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'shifts', count(*) FROM shifts WHERE outlet_id IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'products', count(*) FROM products WHERE outlet_id IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'categories', count(*) FROM categories WHERE outlet_id IN (SELECT id FROM d_outlet);

-- Everything that must survive. Read again after the delete and compared with the snapshot.
CREATE TEMP VIEW kept AS
  SELECT 'users' AS tbl, count(*) AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS sum FROM users x
  UNION ALL SELECT 'refresh_tokens', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM refresh_tokens x
  UNION ALL SELECT 'outlets', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM outlets x
  UNION ALL SELECT 'outlet_settings', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM outlet_settings x
  UNION ALL SELECT 'outlet_members', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM outlet_members x
  UNION ALL SELECT 'employees', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM employees x
  UNION ALL SELECT 'employee_sessions', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM employee_sessions x
  UNION ALL SELECT 'employee_pin_attempts', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM employee_pin_attempts x
  UNION ALL SELECT 'devices', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM devices x
  UNION ALL SELECT 'device_pairing_codes', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM device_pairing_codes x
  UNION ALL SELECT 'idempotency_keys', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM idempotency_keys x
  UNION ALL SELECT 'push_subscriptions', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM push_subscriptions x
  UNION ALL SELECT 'notification_prefs', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM notification_prefs x
  UNION ALL SELECT 'notification_log', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM notification_log x
  UNION ALL SELECT 'audit_logs', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM audit_logs x
  UNION ALL SELECT 'transactions (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM transactions x WHERE id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'transaction_items (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM transaction_items x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'payments (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM payments x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'void_requests (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM void_requests x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'shifts (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM shifts x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'products (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM products x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'categories (other outlets)', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM categories x WHERE outlet_id NOT IN (SELECT id FROM d_outlet);
CREATE TEMP TABLE kept_before ON COMMIT DROP AS SELECT * FROM kept;
CREATE TEMP TABLE doomed_before ON COMMIT DROP AS SELECT * FROM doomed;

ALTER TABLE transactions DISABLE TRIGGER transactions_no_delete;
ALTER TABLE transaction_items DISABLE TRIGGER transaction_items_guard;

DELETE FROM void_requests WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM payments WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM transactions WHERE id IN (SELECT id FROM d_tx);
DELETE FROM shifts WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM products WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM categories WHERE outlet_id IN (SELECT id FROM d_outlet);

ALTER TABLE transactions ENABLE TRIGGER transactions_no_delete;
ALTER TABLE transaction_items ENABLE TRIGGER transaction_items_guard;

-- Report, then refuse to commit if anything else changed or an outlet row survived.
SELECT b.tbl, b.n AS deleted_rows, a.n AS remaining FROM doomed_before b JOIN doomed a USING (tbl) ORDER BY b.tbl;
SELECT b.tbl, b.n AS rows_before, a.n AS rows_after, (a.sum = b.sum) AS identical
  FROM kept_before b JOIN kept a USING (tbl) ORDER BY b.tbl;
DO $$
BEGIN
  IF EXISTS ((SELECT * FROM kept EXCEPT SELECT * FROM kept_before) UNION ALL (SELECT * FROM kept_before EXCEPT SELECT * FROM kept)) THEN
    RAISE EXCEPTION 'rows outside the reset scope of % changed, rolling back', current_setting('kk.code');
  END IF;
  IF EXISTS (SELECT 1 FROM doomed WHERE n <> 0) THEN
    RAISE EXCEPTION 'rows of % are still there, rolling back', current_setting('kk.code');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN
      ('transactions_no_delete', 'transaction_items_guard', 'audit_logs_append_only', 'audit_logs_no_truncate')
      AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'a guard trigger is still disabled, rolling back';
  END IF;
END $$;
DROP VIEW kept;
DROP VIEW doomed;
COMMIT;
\echo reset outlet :code
