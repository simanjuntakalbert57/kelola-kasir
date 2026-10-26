#!/usr/bin/env bash
# Daily encrypted PostgreSQL backup to Cloudflare R2 / Backblaze B2 (TDD §6, ADR-0011).
#
#   pg_dump (custom format) -> age (public-key encryption) -> R2 (S3 API), then prune old backups.
#
# Required environment (from /opt/kelola-kasir/.env via ops/vps/compose.yaml, never in the repo):
#   DATABASE_URL        connection string of the database to back up
#   AGE_RECIPIENT       age public key (age1...); the private key is kept offline, see docs/ops/backup-restore.md
#   BACKUP_TARGET       s3://<bucket>/<prefix>   (R2)   or   local:<directory>   (tests / manual runs)
# For s3:// targets also:
#   R2_ENDPOINT         https://<account-id>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2/B2 key (object read/write only)
# Optional:
#   RETENTION_DAYS      default 30
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"
: "${BACKUP_TARGET:?BACKUP_TARGET is required}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="kelola-kasir-${stamp}.dump.age"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
file="${workdir}/${name}"

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# A failed pg_dump must fail the whole run (pipefail), not leave an empty "successful" backup.
log "dumping database"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | age --recipient "$AGE_RECIPIENT" --output "$file"

size="$(wc -c <"$file" | tr -d ' ')"
if [ "$size" -lt 1024 ]; then
  log "backup is suspiciously small (${size} bytes), aborting"
  exit 1
fi

case "$BACKUP_TARGET" in
  local:*)
    dir="${BACKUP_TARGET#local:}"
    mkdir -p "$dir"
    cp "$file" "${dir}/${name}"
    log "stored ${dir}/${name} (${size} bytes)"
    find "$dir" -name 'kelola-kasir-*.dump.age' -type f -mtime "+${RETENTION_DAYS}" -print -delete | sed 's/^/pruned /' >&2
    ;;
  s3://*)
    : "${R2_ENDPOINT:?R2_ENDPOINT is required for s3:// targets}"
    dest="${BACKUP_TARGET%/}"
    aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors "$file" "${dest}/${name}"
    log "uploaded ${dest}/${name} (${size} bytes)"
    cutoff="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -v "-${RETENTION_DAYS}d" +%Y%m%dT%H%M%SZ)"
    # Names embed the UTC timestamp, so retention is a plain string comparison.
    aws s3 ls --endpoint-url "$R2_ENDPOINT" "${dest}/" | awk '{print $4}' | while read -r key; do
      case "$key" in
        kelola-kasir-*.dump.age)
          ts="${key#kelola-kasir-}"; ts="${ts%.dump.age}"
          if [[ "$ts" < "$cutoff" ]]; then
            aws s3 rm --endpoint-url "$R2_ENDPOINT" --only-show-errors "${dest}/${key}"
            log "pruned ${key}"
          fi
          ;;
      esac
    done
    ;;
  *)
    log "unsupported BACKUP_TARGET (use s3://bucket/prefix or local:/dir)"
    exit 2
    ;;
esac
log "done"
