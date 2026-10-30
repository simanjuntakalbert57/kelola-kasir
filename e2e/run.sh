#!/usr/bin/env bash
# Runs the dashboard E2E suite. Every Playwright project gets its own throw-away PostgreSQL database,
# because the specs mutate the seeded outlet (void approvals, shifts, ...).
# Needs a PostgreSQL server where E2E_ADMIN_DATABASE_URL's user may CREATE DATABASE.
#   E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @kelola-kasir/e2e e2e
#   E2E_KEEP_DB=1 keeps the databases (names are printed) so the backup/restore drill can use the seeded data.
#   E2E_PROJECTS="chromium" ... to run a subset (default: chromium firefox webkit mobile-chrome); extra args go to playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${E2E_ADMIN_DATABASE_URL:?set E2E_ADMIN_DATABASE_URL (a server where the user may CREATE DATABASE)}"
export E2E_OWNER_PASSWORD="${E2E_OWNER_PASSWORD:-e2e-owner-password-123}"
export RATE_LIMIT_LOGIN_MAX=1000 RATE_LIMIT_PAIR_MAX=1000
status=0

for project in ${E2E_PROJECTS:-chromium firefox webkit mobile-chrome}; do
  DB_NAME="kk_e2e_$(date +%s)_$$_${project//-/_}"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}" >/dev/null
  DB_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$ADMIN_URL" "$DB_NAME")"
  export DATABASE_URL="$DB_URL"
  pnpm --filter @kelola-kasir/api db:migrate >/dev/null
  for pair in "JUS1:owner@e2e.test" "JUS1:manager@e2e.test" "JUS2:lockout@e2e.test" "JUS3:qris@e2e.test"; do
    OWNER_EMAIL="${pair#*:}" OWNER_PASSWORD="$E2E_OWNER_PASSWORD" OUTLET_CODE="${pair%%:*}" OUTLET_NAME="Toko ${pair%%:*}" \
      pnpm --filter @kelola-kasir/api owner:create >/dev/null
  done
  # No API/UI creates a manager (docs/tdd.md RBAC): promote the extra JUS1 member directly.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "update outlet_members set role='manager' where user_id=(select id from users where email='manager@e2e.test')" >/dev/null
  echo "=== project: ${project}"
  pnpm --filter @kelola-kasir/e2e exec playwright test --project="$project" "$@" || status=$?
  if [ -n "${E2E_KEEP_DB:-}" ]; then echo "kept database: ${DB_NAME}"; else
    psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" >/dev/null 2>&1 || true
  fi
done
exit "$status"
