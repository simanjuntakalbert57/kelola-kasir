#!/bin/sh
# Runs once, when the database volume is created: a read-only role for the nightly pg_dump.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$BACKUP_DB_PASSWORD" <<'SQL'
CREATE ROLE backup_ro LOGIN PASSWORD :'pw';
GRANT pg_read_all_data TO backup_ro;
SQL
