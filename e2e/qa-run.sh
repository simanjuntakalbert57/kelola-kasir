#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C LANG=C
ADMIN_URL="postgres://postgres@127.0.0.1:55777/postgres"
export E2E_OWNER_PASSWORD="e2e-owner-password-123" RATE_LIMIT_LOGIN_MAX=1000 RATE_LIMIT_PAIR_MAX=1000
project="$1"; shift
DB_NAME="kk_e2e_$(date +%s)_${project//-/_}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}" >/dev/null
export DATABASE_URL="postgres://postgres@127.0.0.1:55777/${DB_NAME}"
pnpm --filter @kelola-kasir/api db:migrate >/dev/null
for pair in "JUS1:owner@e2e.test" "JUS1:manager@e2e.test" "JUS2:lockout@e2e.test" "JUS3:qris@e2e.test"; do
  OWNER_EMAIL="${pair#*:}" OWNER_PASSWORD="$E2E_OWNER_PASSWORD" OUTLET_CODE="${pair%%:*}" OUTLET_NAME="Toko ${pair%%:*}" pnpm --filter @kelola-kasir/api owner:create >/dev/null
done
psql "$DATABASE_URL" -c "update outlet_members set role='manager' where user_id=(select id from users where email='manager@e2e.test')" 
E2E_OWNER_PASSWORD="$E2E_OWNER_PASSWORD" pnpm --filter @kelola-kasir/e2e exec playwright test --project="$project" "$@"
