-- Targeted delete of ONE outlet and (optionally) its test owner, in a single transaction (docs/ops/runbook.md § Reset).
-- Used on 29 Oct 2026 to remove the QA outlet QAUJI from production without touching JUS1 (DEAR-19, DEAR-86).
--
--   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir -v code=QAUJI -v email=qa@example.com < delete-outlet.sql
--
-- email = the owner account to delete along with the outlet; pass -v email= (empty) to keep all users.
-- Every row that does not belong to the outlet or that user is fingerprinted (row count + md5) before the delete and
-- compared afterwards. Any difference, an unknown outlet code, or a user who is still a member of another outlet
-- aborts the whole transaction. The no-delete / append-only triggers are disabled only inside the transaction.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('kk.code', :'code', true), set_config('kk.email', :'email', true);

CREATE TEMP TABLE d_outlet ON COMMIT DROP AS SELECT id FROM outlets WHERE code = current_setting('kk.code');
CREATE TEMP TABLE d_user ON COMMIT DROP AS SELECT id FROM users WHERE email = current_setting('kk.email');
DO $$
BEGIN
  IF (SELECT count(*) FROM d_outlet) <> 1 THEN
    RAISE EXCEPTION 'outlet % not found', current_setting('kk.code');
  END IF;
  IF current_setting('kk.email') <> '' AND NOT EXISTS (SELECT 1 FROM d_user) THEN
    RAISE EXCEPTION 'user % not found', current_setting('kk.email');
  END IF;
  IF EXISTS (SELECT 1 FROM outlet_members WHERE user_id IN (SELECT id FROM d_user)
             AND outlet_id NOT IN (SELECT id FROM d_outlet)) THEN
    RAISE EXCEPTION 'user % is also a member of another outlet, refusing to delete it', current_setting('kk.email');
  END IF;
END $$;
CREATE TEMP TABLE d_tx ON COMMIT DROP AS SELECT id FROM transactions WHERE outlet_id IN (SELECT id FROM d_outlet);
CREATE TEMP TABLE d_device ON COMMIT DROP AS SELECT id FROM devices WHERE outlet_id IN (SELECT id FROM d_outlet);
CREATE TEMP TABLE d_employee ON COMMIT DROP AS SELECT id FROM employees WHERE outlet_id IN (SELECT id FROM d_outlet);

-- Everything that must survive. Read again after the delete and compared with the snapshot.
CREATE TEMP VIEW kept AS
  SELECT 'users' AS tbl, count(*) AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) AS sum
    FROM users x WHERE id NOT IN (SELECT id FROM d_user)
  UNION ALL SELECT 'refresh_tokens', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM refresh_tokens x WHERE user_id NOT IN (SELECT id FROM d_user)
  UNION ALL SELECT 'outlets', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM outlets x WHERE id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'outlet_settings', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.outlet_id), ''))
    FROM outlet_settings x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'outlet_members', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM outlet_members x WHERE outlet_id NOT IN (SELECT id FROM d_outlet) AND user_id NOT IN (SELECT id FROM d_user)
  UNION ALL SELECT 'categories', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM categories x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'products', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM products x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'employees', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM employees x WHERE id NOT IN (SELECT id FROM d_employee)
  UNION ALL SELECT 'employee_sessions', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM employee_sessions x
    WHERE employee_id NOT IN (SELECT id FROM d_employee) AND device_id NOT IN (SELECT id FROM d_device)
  UNION ALL SELECT 'employee_pin_attempts', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
    FROM employee_pin_attempts x
    WHERE employee_id NOT IN (SELECT id FROM d_employee) AND device_id NOT IN (SELECT id FROM d_device)
  UNION ALL SELECT 'devices', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM devices x WHERE id NOT IN (SELECT id FROM d_device)
  UNION ALL SELECT 'device_pairing_codes', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM device_pairing_codes x WHERE device_id NOT IN (SELECT id FROM d_device)
  UNION ALL SELECT 'shifts', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM shifts x WHERE outlet_id NOT IN (SELECT id FROM d_outlet)
  UNION ALL SELECT 'transactions', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM transactions x WHERE id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'transaction_items', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM transaction_items x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'payments', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM payments x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'void_requests', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM void_requests x WHERE transaction_id NOT IN (SELECT id FROM d_tx)
  UNION ALL SELECT 'audit_logs', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
    FROM audit_logs x
    WHERE outlet_id IS DISTINCT FROM (SELECT id FROM d_outlet) AND (actor_id IS NULL OR actor_id NOT IN (SELECT id FROM d_user));
CREATE TEMP TABLE kept_before ON COMMIT DROP AS SELECT * FROM kept;

ALTER TABLE transactions DISABLE TRIGGER transactions_no_delete;
ALTER TABLE transaction_items DISABLE TRIGGER transaction_items_guard;
ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only;

DELETE FROM void_requests WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM payments WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM d_tx);
DELETE FROM transactions WHERE id IN (SELECT id FROM d_tx);
DELETE FROM shifts WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM employee_sessions WHERE employee_id IN (SELECT id FROM d_employee) OR device_id IN (SELECT id FROM d_device);
DELETE FROM employee_pin_attempts WHERE employee_id IN (SELECT id FROM d_employee) OR device_id IN (SELECT id FROM d_device);
DELETE FROM device_pairing_codes WHERE device_id IN (SELECT id FROM d_device);
DELETE FROM idempotency_keys WHERE scope_id IN (
  SELECT id FROM d_outlet UNION ALL SELECT id FROM d_device UNION ALL SELECT id FROM d_employee UNION ALL SELECT id FROM d_user);
DELETE FROM devices WHERE id IN (SELECT id FROM d_device);
DELETE FROM employees WHERE id IN (SELECT id FROM d_employee);
DELETE FROM products WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM categories WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM audit_logs WHERE outlet_id IN (SELECT id FROM d_outlet) OR actor_id IN (SELECT id FROM d_user);
DELETE FROM outlet_members WHERE outlet_id IN (SELECT id FROM d_outlet) OR user_id IN (SELECT id FROM d_user);
DELETE FROM outlet_settings WHERE outlet_id IN (SELECT id FROM d_outlet);
DELETE FROM outlets WHERE id IN (SELECT id FROM d_outlet);
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM d_user);
DELETE FROM users WHERE id IN (SELECT id FROM d_user);

ALTER TABLE transactions ENABLE TRIGGER transactions_no_delete;
ALTER TABLE transaction_items ENABLE TRIGGER transaction_items_guard;
ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only;

-- Report, then refuse to commit if anything outside the outlet changed.
SELECT b.tbl, b.n AS kept_rows, (a.sum = b.sum) AS identical
  FROM kept_before b JOIN kept a USING (tbl) ORDER BY b.tbl;
DO $$
BEGIN
  IF EXISTS ((SELECT * FROM kept EXCEPT SELECT * FROM kept_before) UNION ALL (SELECT * FROM kept_before EXCEPT SELECT * FROM kept)) THEN
    RAISE EXCEPTION 'rows outside outlet % changed, rolling back', current_setting('kk.code');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN
      ('transactions_no_delete', 'transaction_items_guard', 'audit_logs_append_only', 'audit_logs_no_truncate')
      AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'a guard trigger is still disabled, rolling back';
  END IF;
END $$;
DROP VIEW kept;
COMMIT;
\echo deleted outlet :code
