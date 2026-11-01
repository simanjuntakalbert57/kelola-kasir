-- Hand-written migration (ADR-0021): expense invariants the Drizzle schema cannot express, and default categories.

-- 1. Expense categories carry `updated_seq`/`updated_at` like the catalog, ready for the cashier app (Fase 2).
CREATE TRIGGER expense_categories_touch BEFORE INSERT OR UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint

-- 2. Expenses are never physically deleted; a deleted expense is frozen until it is restored.
CREATE FUNCTION kk_expenses_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expenses cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'expense % is deleted', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_deleted_frozen';
  END IF;
  IF NEW.outlet_id IS DISTINCT FROM OLD.outlet_id OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expense % outlet, source and creator are immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'expenses_immutable_fields';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER expenses_guard BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION kk_expenses_guard();
--> statement-breakpoint

-- 3. Expense history is append-only, like audit_logs and transaction_deletions (kk_append_only from 0005).
CREATE TRIGGER expense_history_append_only BEFORE UPDATE OR DELETE ON expense_history
  FOR EACH ROW EXECUTE FUNCTION kk_append_only();
--> statement-breakpoint
CREATE TRIGGER expense_history_no_truncate BEFORE TRUNCATE ON expense_history
  FOR EACH STATEMENT EXECUTE FUNCTION kk_append_only();
--> statement-breakpoint

-- 4. Default categories of an outlet. Idempotent: does nothing when the outlet already has any category.
--    Called here for existing outlets, and by ops/vps/create-branch-outlet.sql and the create-owner script.
CREATE FUNCTION kk_seed_expense_categories(p_outlet_id uuid) RETURNS integer AS $$
DECLARE
  inserted integer;
BEGIN
  IF EXISTS (SELECT 1 FROM expense_categories WHERE outlet_id = p_outlet_id) THEN
    RETURN 0;
  END IF;
  INSERT INTO expense_categories (outlet_id, category_group, name, sort_order)
  SELECT p_outlet_id, d.category_group, d.name, d.sort_order
  FROM (VALUES
    ('hpp', 'Buah', 10),
    ('hpp', 'Es batu', 20),
    ('hpp', 'Gula/sirup/susu', 30),
    ('hpp', 'Cup & sedotan/kemasan', 40),
    ('operasional', 'Listrik', 110),
    ('operasional', 'Wifi/internet', 120),
    ('operasional', 'Air/galon', 130),
    ('operasional', 'Gas', 140),
    ('tetap', 'Sewa tempat', 210),
    ('tetap', 'Gaji pegawai', 220),
    ('lainnya', 'Perawatan/perbaikan', 310),
    ('lainnya', 'Lain-lain', 320)
  ) AS d(category_group, name, sort_order);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
SELECT kk_seed_expense_categories(id) FROM outlets;
