-- Hand-written migration (ADR-0023): discount invariants the Drizzle schema cannot express.

-- 1. `discount_outlets` is the sync unit of a discount, so it gets `updated_seq`/`updated_at` like the catalog (ADR-0008).
CREATE TRIGGER discount_outlets_touch BEFORE INSERT OR UPDATE ON discount_outlets
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated();
--> statement-breakpoint

-- 2. Discounts are never physically deleted (past transactions point at them); a deleted discount is frozen and the
--    creator never changes. A rule only moves forward: `version` rises by exactly one per change.
CREATE FUNCTION kk_discounts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discounts cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'discount % is deleted', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'discounts_deleted_frozen';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'discount % creator is immutable', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'discounts_immutable_fields';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'discount % version must rise by one', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'discounts_version_step';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER discounts_guard BEFORE UPDATE OR DELETE ON discounts
  FOR EACH ROW EXECUTE FUNCTION kk_discounts_guard();
--> statement-breakpoint

-- 3. Discount history is append-only, like audit_logs and expense_history (kk_append_only from 0005).
CREATE TRIGGER discount_history_append_only BEFORE UPDATE OR DELETE ON discount_history
  FOR EACH ROW EXECUTE FUNCTION kk_append_only();
--> statement-breakpoint
CREATE TRIGGER discount_history_no_truncate BEFORE TRUNCATE ON discount_history
  FOR EACH STATEMENT EXECUTE FUNCTION kk_append_only();
