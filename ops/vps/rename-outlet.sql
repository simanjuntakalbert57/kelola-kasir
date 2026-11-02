-- Rename ONE outlet (code + name) without touching its data (ADR-0020, DEAR-134). Used to turn JUS1 into a branch.
--
--   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir \
--     -v old_code=JUS1 -v new_code=RGN -v new_name='Jus Albert Ragunan' [-v operations_started_on=2026-11-10] \
--     < rename-outlet.sql
--
-- operations_started_on (optional, YYYY-MM-DD, DEAR-140): first business day of the branch; the expense recap counts
-- from it (ADR-0021 §3). Omitted = the column is left as it is; `-v operations_started_on=none` clears it.
-- Changes: outlets.code, outlets.name, appends the old code to outlets.previous_codes, and outlet_settings.display_name
-- when it still equals the old outlet name (a display name the owner customised is kept). One audit_logs row.
-- Only renames: nothing is deleted. Do NOT combine this with delete-outlet.sql or reset-outlet-data.sql (DEAR-140).
-- Not changed: transactions (old numbers like JUS1-K01-... stay as they are and stay valid), devices, employees,
-- products, shifts, members. Paired cashier phones keep numbering with the old code until they are re-paired; the API
-- accepts both codes (ADR-0020 §3). Requires the API version that knows outlets.previous_codes (migration 0006).
-- Any failed check aborts the whole transaction, so the script is safe to re-run.
\set ON_ERROR_STOP on
\if :{?operations_started_on}
\else
  \set operations_started_on ''
\endif
BEGIN;
SELECT set_config('kk.old_code', upper(:'old_code'), true),
       set_config('kk.new_code', upper(:'new_code'), true),
       set_config('kk.new_name', btrim(:'new_name'), true),
       set_config('kk.ops_start', lower(btrim(:'operations_started_on')), true);

DO $$
DECLARE
  old_code text := current_setting('kk.old_code');
  new_code text := current_setting('kk.new_code');
  new_name text := current_setting('kk.new_name');
  ops_start text := current_setting('kk.ops_start');
  o outlets%ROWTYPE;
  settings_renamed integer;
BEGIN
  IF ops_start NOT IN ('', 'none') AND ops_start !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'operations_started_on % must be YYYY-MM-DD or none', ops_start;
  END IF;
  -- Transaction numbers are `<outlet>-<device>-<yymmdd>-<seq>` with a 2-6 character outlet part.
  IF new_code !~ '^[A-Z0-9]{2,6}$' THEN
    RAISE EXCEPTION 'new_code % must be 2-6 letters or digits', new_code;
  END IF;
  IF char_length(new_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'new_name must be 1-80 characters';
  END IF;
  SELECT * INTO o FROM outlets WHERE code = old_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'outlet % not found', old_code;
  END IF;
  IF new_code <> old_code AND EXISTS (
    SELECT 1 FROM outlets WHERE id <> o.id AND (code = new_code OR new_code = ANY (previous_codes))
  ) THEN
    RAISE EXCEPTION 'code % is (or was) used by another outlet', new_code;
  END IF;

  UPDATE outlets
     SET code = new_code,
         name = new_name,
         previous_codes = CASE
           WHEN new_code = old_code OR old_code = ANY (previous_codes) THEN array_remove(previous_codes, new_code)
           ELSE array_remove(array_append(previous_codes, old_code), new_code)
         END,
         operations_started_on = CASE ops_start
           WHEN '' THEN operations_started_on
           WHEN 'none' THEN NULL
           ELSE ops_start::date
         END
   WHERE id = o.id;
  UPDATE outlet_settings SET display_name = new_name WHERE outlet_id = o.id AND display_name = o.name;
  GET DIAGNOSTICS settings_renamed = ROW_COUNT;

  INSERT INTO audit_logs (outlet_id, actor_type, action, entity_type, entity_id, before, after, meta)
  SELECT o.id, 'system', 'outlet.renamed', 'outlet', o.id,
         jsonb_build_object('code', o.code, 'name', o.name, 'previous_codes', o.previous_codes,
                            'operations_started_on', o.operations_started_on),
         jsonb_build_object('code', x.code, 'name', x.name, 'previous_codes', x.previous_codes,
                            'operations_started_on', x.operations_started_on),
         jsonb_build_object('script', 'ops/vps/rename-outlet.sql', 'display_name_renamed', settings_renamed = 1)
    FROM outlets x WHERE x.id = o.id;

  RAISE NOTICE 'outlet % renamed to % (%); receipt display name %', old_code, new_code, new_name,
    CASE WHEN settings_renamed = 1 THEN 'renamed too' ELSE 'kept (customised)' END;
END $$;

SELECT o.code, o.name, o.previous_codes, o.operations_started_on, s.display_name,
       (SELECT count(*) FROM transactions t WHERE t.outlet_id = o.id) AS transactions,
       (SELECT count(*) FROM devices d WHERE d.outlet_id = o.id AND d.revoked_at IS NULL AND d.paired_at IS NOT NULL) AS paired_devices
  FROM outlets o JOIN outlet_settings s ON s.outlet_id = o.id
 WHERE o.code = current_setting('kk.new_code');
COMMIT;
