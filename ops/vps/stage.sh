#!/usr/bin/env bash
# Assemble the files the VPS needs in /opt/kelola-kasir into <dest> (used by the deploy workflow and CI).
# .env, release.env and the data volumes are never part of the bundle, so copying it over keeps them intact.
set -euo pipefail
dest="${1:?usage: stage.sh <dest-dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$dest/backup" "$dest/initdb" "$dest/backups"
cp "$root/ops/vps/compose.yaml" "$root/ops/vps/Caddyfile" "$root/ops/vps/compose.sh" "$root/ops/vps/backup-now.sh" "$root/ops/vps/restore-test.sh" "$root/ops/vps/backup-status.sh" "$root/ops/vps/rotate-db-password.sh" "$root/ops/vps/env.example" "$dest/"
cp "$root/ops/vps/initdb/"*.sh "$dest/initdb/"
cp "$root/ops/backup/Dockerfile" "$root/ops/backup/"*.sh "$dest/backup/"
chmod +x "$dest/compose.sh" "$dest/backup-now.sh" "$dest/restore-test.sh" "$dest/backup-status.sh" "$dest/rotate-db-password.sh" "$dest/initdb/"*.sh "$dest/backup/"*.sh
