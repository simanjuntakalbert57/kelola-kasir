-- Hand-written migration (ADR-0019): invariants of owner soft delete that the Drizzle schema cannot express.

-- 1. A deleted transaction is frozen: its status cannot change until it is restored.
--    Keeps a re-sent void request, payment confirmation or webhook from moving a row that no report counts.
CREATE FUNCTION kk_transactions_deleted_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'transaction % is deleted', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_deleted_frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_deleted_guard BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION kk_transactions_deleted_guard();
--> statement-breakpoint

-- 2. Delete/restore history is append-only, like audit_logs.
CREATE FUNCTION kk_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transaction_deletions_append_only BEFORE UPDATE OR DELETE ON transaction_deletions
  FOR EACH ROW EXECUTE FUNCTION kk_append_only();
--> statement-breakpoint
CREATE TRIGGER transaction_deletions_no_truncate BEFORE TRUNCATE ON transaction_deletions
  FOR EACH STATEMENT EXECUTE FUNCTION kk_append_only();
