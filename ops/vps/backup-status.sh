#!/usr/bin/env bash
# Status of the nightly backup, without secrets (Actions → Backup status, or by hand on the VPS):
# last run of kelola-kasir-backup.service, the next timer run, heartbeat configured, newest objects in the bucket.
# The heartbeat is pinged only after a successful backup (backup-now.sh), so Result=success with a heartbeat
# URL configured means healthchecks.io received that run's ping.
set -euo pipefail
cd "$(dirname "$0")"
if systemctl cat kelola-kasir-backup.service >/dev/null 2>&1; then
  systemctl show kelola-kasir-backup.service --no-pager \
    -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp
  systemctl list-timers kelola-kasir-backup.timer --no-pager | head -n 2
else
  echo "kelola-kasir-backup.service is not installed (setup.sh)"
fi
if [[ -n "$(sed -n 's/^BACKUP_HEARTBEAT_URL=//p' .env | tail -n 1)" ]]; then
  echo "heartbeat: configured"
else
  echo "heartbeat: NOT configured (BACKUP_HEARTBEAT_URL is empty)"
fi
docker build --quiet --network host -t kelola-kasir-backup ./backup >/dev/null
echo "newest backups:"
./compose.sh --profile backup run --rm --no-deps -T --entrypoint /opt/backup/latest.sh backup 5
