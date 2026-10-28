#!/usr/bin/env bash
# Rotate POSTGRES_PASSWORD (role kelola_kasir, used by the API and restore-test.sh) after it was exposed.
# The new value is generated here and only written to .env: it is never printed, so it never reaches CI logs.
# Run by Actions → Rotate database password, or by hand as deploy in /opt/kelola-kasir.
# Afterwards copy the new value from .env into the password manager (deploy.md step 3).
set -Eeuo pipefail
cd "$(dirname "$0")"
umask 077

old="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)"
[[ -n "$old" ]] || { echo "rotate: POSTGRES_PASSWORD is empty in .env" >&2; exit 1; }
new="$(openssl rand -hex 32)"

# SQL on stdin, not in argv, so the value never shows up in a process list. Hex only: no quoting issues.
set_role() {
  printf "ALTER ROLE kelola_kasir PASSWORD '%s';\n" "$1" |
    ./compose.sh exec -T db psql -U kelola_kasir -d postgres -v ON_ERROR_STOP=1 -q
}

cp -p .env .env.rotate-bak
rollback() {
  echo "rotate: failed, restoring the previous password" >&2
  set_role "$old" || true
  mv .env.rotate-bak .env
  ./compose.sh up -d --wait --wait-timeout 240 || true
  exit 1
}
trap rollback ERR

set_role "$new"
sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${new}/" .env > .env.rotate-new
mv .env.rotate-new .env
# DATABASE_URL of the api changes, so compose recreates it (db too; its data volume is untouched).
./compose.sh up -d --wait --wait-timeout 240
./compose.sh exec -T api wget -qO- http://127.0.0.1:3000/healthz | grep -q '"db":"up"'

trap - ERR
rm -f .env.rotate-bak
echo "rotate: POSTGRES_PASSWORD rotated, api healthy with the new password ($(date -u +%FT%TZ))"
