#!/usr/bin/env bash
# One backup run: pg_dump -> age -> R2/B2 (ops/backup/backup.sh), then ping BACKUP_HEARTBEAT_URL.
# Started daily at 01:00 WIB by kelola-kasir-backup.timer (setup.sh); safe to run by hand.
# The heartbeat is only pinged after a successful backup, so a missing ping means a failed or skipped run.
set -euo pipefail
cd "$(dirname "$0")"
./compose.sh --profile backup run --rm --build backup
url="$(sed -n 's/^BACKUP_HEARTBEAT_URL=//p' .env | tail -n 1)"
if [[ -n "$url" ]]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$url"
fi
