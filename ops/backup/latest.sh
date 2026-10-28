#!/usr/bin/env bash
# List the newest backups in BACKUP_TARGET, newest last:  latest.sh [count, default 5]
set -euo pipefail
# shellcheck source=ops/backup/s3.sh
. "$(dirname "$0")/s3.sh"
: "${BACKUP_TARGET:?BACKUP_TARGET is required}"
backup_names | tail -n "${1:-5}"
