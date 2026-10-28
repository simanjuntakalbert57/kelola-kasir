#!/usr/bin/env bash
# Restore test: fetch a backup from BACKUP_TARGET, restore it into an EMPTY database, run verify-restore.sh.
#
#   restore-test.sh [<backup name>, default: newest]     (age private key on stdin)
#
# Environment: RESTORE_DATABASE_URL (empty target database), BACKUP_TARGET, R2_ENDPOINT + AWS_* for s3://.
# The private key is read from stdin and never written to disk, so it can stay on the owner's laptop.
set -euo pipefail
here="$(dirname "$0")"
# shellcheck source=ops/backup/s3.sh
. "$here/s3.sh"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_TARGET:?BACKUP_TARGET is required}"
case "$BACKUP_TARGET" in s3://*) s3_setup ;; esac

name="${1:-$(backup_names | tail -n 1)}"
[ -n "$name" ] || { echo "restore-test: no backup found in $BACKUP_TARGET" >&2; exit 1; }
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

case "$BACKUP_TARGET" in
  local:*) cp "${BACKUP_TARGET#local:}/$name" "$workdir/$name" ;;
  s3://*) s3 cp --only-show-errors "${BACKUP_TARGET%/}/$name" "$workdir/$name" ;;
esac
echo "restore-test: $name ($(wc -c <"$workdir/$name" | tr -d ' ') bytes)" >&2

start="$(date +%s)"
AGE_IDENTITY_FILE=/dev/stdin "$here/restore.sh" "$workdir/$name" "$RESTORE_DATABASE_URL"
echo "restore-test: restored in $(($(date +%s) - start)) s" >&2
"$here/verify-restore.sh" "$RESTORE_DATABASE_URL"
