#!/usr/bin/env bash
# Restore test on the VPS (docs/ops/backup-restore.md § Uji restore): newest backup (or the one named) is
# restored into a throwaway database "restore_check", checked with verify-restore.sh, then dropped.
# The age private key comes on stdin and never touches the VPS disk. From the owner's laptop:
#   ssh root@<vps> 'sudo -u deploy /opt/kelola-kasir/restore-test.sh' < kelola-kasir-backup.key
set -euo pipefail
cd "$(dirname "$0")"
[[ ! -t 0 ]] || { echo "usage: restore-test.sh [<backup name>] < <age private key file>" >&2; exit 1; }
pw="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -n 1)"
# </dev/null: only the final compose run may read stdin (the key).
db() { ./compose.sh exec -T db psql -U kelola_kasir -d postgres -qc "$1" </dev/null; }
db 'DROP DATABASE IF EXISTS restore_check'
db 'CREATE DATABASE restore_check'
trap "db 'DROP DATABASE IF EXISTS restore_check' && echo 'restore-test: dropped restore_check' >&2" EXIT
# Same host-network build as backup-now.sh (no DNS on Docker's default bridge, DEAR-33).
docker build --quiet --network host -t kelola-kasir-backup ./backup >/dev/null </dev/null
./compose.sh --profile backup run --rm -T \
  -e RESTORE_DATABASE_URL="postgres://kelola_kasir:${pw}@db:5432/restore_check" \
  --entrypoint /opt/backup/restore-test.sh backup "$@"
