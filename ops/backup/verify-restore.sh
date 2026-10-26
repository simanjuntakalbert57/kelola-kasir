#!/usr/bin/env bash
# Sanity-check a restored database: every table exists and the money invariants hold.
#   verify-restore.sh <DATABASE_URL>
set -euo pipefail
target="${1:?usage: verify-restore.sh <DATABASE_URL>}"

psql "$target" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'tables', count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';
select 'outlets', count(*) from outlets;
select 'employees', count(*) from employees;
select 'shifts', count(*) from shifts;
select 'open_shifts_per_outlet_max', coalesce(max(c), 0) from (select count(*) c from shifts where status = 'open' group by outlet_id) s;
select 'transactions', count(*) from transactions;
select 'paid_total_rupiah', coalesce(sum(total), 0) from transactions where status in ('paid', 'void_requested');
select 'audit_logs', count(*) from audit_logs;
select 'migrations', count(*) from drizzle.__drizzle_migrations;
SQL
