-- Create a new branch outlet for an EXISTING owner account (ADR-0020, DEAR-134). Nothing existing is changed.
--
--   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir \
--     -v code=PLM -v name='Jus Albert Palmerah' -v owner_email=owner@example.com \
--     [-v operations_started_on=2026-11-10] < create-branch-outlet.sql
--
-- operations_started_on (optional, YYYY-MM-DD, DEAR-140): first business day of the branch; the expense recap counts
-- from it (ADR-0021 §3). Omitted = NULL (no limit); the owner can set it later in Pengaturan.
-- Inserts: outlets (code, name), outlet_settings with defaults (display name = name; QRIS, receipt text and logo empty,
-- to be filled in the dashboard), outlet_members (owner_email as `owner`), the default expense categories
-- (kk_seed_expense_categories, migration 0007) and one audit_logs row. Products, employees and devices start empty and
-- are added in the dashboard after switching to the new branch. Device codes start at K01, so numbers are PLM-K01-...
-- Fails (and changes nothing) when the code is taken now or was taken before a rename, or the email is not an owner.
\set ON_ERROR_STOP on
\if :{?operations_started_on}
\else
  \set operations_started_on ''
\endif
BEGIN;
SELECT set_config('kk.code', upper(:'code'), true),
       set_config('kk.name', btrim(:'name'), true),
       set_config('kk.owner_email', lower(btrim(:'owner_email')), true),
       set_config('kk.ops_start', btrim(:'operations_started_on'), true);

DO $$
DECLARE
  new_code text := current_setting('kk.code');
  new_name text := current_setting('kk.name');
  ops_start text := current_setting('kk.ops_start');
  v_owner uuid;
  v_outlet uuid;
  seeded integer;
BEGIN
  IF new_code !~ '^[A-Z0-9]{2,6}$' THEN
    RAISE EXCEPTION 'code % must be 2-6 letters or digits', new_code;
  END IF;
  IF char_length(new_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'name must be 1-80 characters';
  END IF;
  IF ops_start <> '' AND ops_start !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'operations_started_on % must be YYYY-MM-DD', ops_start;
  END IF;
  IF EXISTS (SELECT 1 FROM outlets WHERE code = new_code OR new_code = ANY (previous_codes)) THEN
    RAISE EXCEPTION 'code % is (or was) used by another outlet', new_code;
  END IF;
  SELECT u.id INTO v_owner
    FROM users u
   WHERE u.email = current_setting('kk.owner_email') AND u.is_active
     AND EXISTS (SELECT 1 FROM outlet_members m WHERE m.user_id = u.id AND m.role = 'owner');
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no active owner account with email %', current_setting('kk.owner_email');
  END IF;

  INSERT INTO outlets (code, name, operations_started_on)
  VALUES (new_code, new_name, NULLIF(ops_start, '')::date) RETURNING id INTO v_outlet;
  INSERT INTO outlet_settings (outlet_id, display_name) VALUES (v_outlet, new_name);
  INSERT INTO outlet_members (outlet_id, user_id, role) VALUES (v_outlet, v_owner, 'owner');
  seeded := kk_seed_expense_categories(v_outlet);
  INSERT INTO audit_logs (outlet_id, actor_type, action, entity_type, entity_id, after, meta)
  VALUES (v_outlet, 'system', 'outlet.created', 'outlet', v_outlet,
          jsonb_build_object('code', new_code, 'name', new_name, 'owner_user_id', v_owner,
                             'operations_started_on', NULLIF(ops_start, '')::date),
          jsonb_build_object('script', 'ops/vps/create-branch-outlet.sql', 'expense_categories', seeded));
  RAISE NOTICE 'outlet % (%) created for owner %, % expense categories', new_code, new_name, v_owner, seeded;
END $$;

SELECT o.id, o.code, o.name, o.operations_started_on, s.display_name,
       (SELECT count(*) FROM outlet_members m WHERE m.outlet_id = o.id) AS members,
       (SELECT count(*) FROM expense_categories c WHERE c.outlet_id = o.id) AS expense_categories
  FROM outlets o JOIN outlet_settings s ON s.outlet_id = o.id
 WHERE o.code = current_setting('kk.code');
COMMIT;
