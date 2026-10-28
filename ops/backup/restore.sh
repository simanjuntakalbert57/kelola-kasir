#!/usr/bin/env bash
# Restore an encrypted backup produced by backup.sh into an EMPTY database.
#
#   restore.sh <backup-file.dump.age> <target DATABASE_URL>
#
# The age private key file is read from AGE_IDENTITY_FILE (kept offline / in the password manager).
# Refuses to run against a database that already has tables, so production is never overwritten by accident.
set -euo pipefail

backup="${1:?usage: restore.sh <backup-file.dump.age> <target DATABASE_URL>}"
target="${2:?usage: restore.sh <backup-file.dump.age> <target DATABASE_URL>}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE (age private key file) is required}"

existing="$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$existing" != "0" ]; then
  echo "restore: target database is not empty (${existing} tables); create a fresh database first" >&2
  exit 1
fi

age --decrypt --identity "$AGE_IDENTITY_FILE" "$backup" | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$target"
# Never print the password of the target URL: this output ends up in screenshots and issue comments.
safe_target="$(printf '%s' "$target" | sed -E 's#://([^:/@]+):.*@#://\1:***@#')"
echo "restore: finished; run ops/backup/verify-restore.sh ${safe_target} to sanity check" >&2
