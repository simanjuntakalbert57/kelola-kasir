-- Hand-written migration: invariants that cannot be expressed in the Drizzle schema.

-- 1. Sync cursor (ADR-0008): every insert/update of a catalog-like row gets a fresh updated_seq.
CREATE FUNCTION kk_touch_updated() RETURNS trigger AS $$
BEGIN
  NEW.updated_seq := nextval('catalog_seq');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER categories_touch BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint
CREATE TRIGGER products_touch BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint
CREATE TRIGGER employees_touch BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint
CREATE TRIGGER outlet_settings_touch BEFORE INSERT OR UPDATE ON outlet_settings
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint

-- 2. Transactions: financial columns are immutable once the transaction left `pending`,
--    and status changes must follow the state machine of TDD §3.3.
CREATE FUNCTION kk_transactions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'pending' AND (
       NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.client_created_at IS DISTINCT FROM OLD.client_created_at
  ) THEN
    RAISE EXCEPTION 'transaction % is not editable (status %)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('paid', 'cancelled'))
    OR (OLD.status = 'paid' AND NEW.status IN ('void_requested', 'voided'))
    OR (OLD.status = 'void_requested' AND NEW.status IN ('voided', 'paid'))
  ) THEN
    RAISE EXCEPTION 'invalid transaction status change % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_status_transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_guard BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION kk_transactions_guard();
--> statement-breakpoint
CREATE FUNCTION kk_transactions_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions cannot be deleted' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION kk_transactions_no_delete();
--> statement-breakpoint

-- 3. Transaction items (price snapshots) never change after the transaction left `pending`.
CREATE FUNCTION kk_transaction_items_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM transactions
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.transaction_id ELSE NEW.transaction_id END;
  IF parent_status IS NOT NULL AND parent_status <> 'pending' THEN
    RAISE EXCEPTION 'items of a % transaction are immutable', parent_status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_items_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transaction_items_guard BEFORE UPDATE OR DELETE ON transaction_items
  FOR EACH ROW EXECUTE FUNCTION kk_transaction_items_guard();
--> statement-breakpoint

-- 4. Audit log is append-only.
CREATE FUNCTION kk_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION kk_audit_logs_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION kk_audit_logs_append_only();
