#!/usr/bin/env bash
# One backup run: pg_dump -> age -> R2/B2 (ops/backup/backup.sh), then ping BACKUP_HEARTBEAT_URL.
# Started daily at 01:00 WIB by kelola-kasir-backup.timer (setup.sh); safe to run by hand.
# The heartbeat is only pinged after a successful backup, so a missing ping means a failed or skipped run.
set -euo pipefail
cd "$(dirname "$0")"
# Backups stay off until AGE_RECIPIENT is set (owner deferred them during UAT, DEAR-19). Required before go-live.
if [[ -z "$(sed -n 's/^AGE_RECIPIENT=//p' .env | tail -n 1)" ]]; then
  echo "backup skipped: AGE_RECIPIENT is empty in .env (backups not configured yet)" >&2
  exit 0
fi
# Host network for the build: Docker's default bridge has no working DNS on the VPS (DEAR-33).
docker build --quiet --network host -t kelola-kasir-backup ./backup >/dev/null
./compose.sh --profile backup run --rm backup
url="$(sed -n 's/^BACKUP_HEARTBEAT_URL=//p' .env | tail -n 1)"
if [[ -n "$url" ]]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$url"
fi
