# Image of the nightly backup on the VPS (service "backup" in ops/vps/compose.yaml, docs/ops/backup-restore.md).
# PostgreSQL 16 client, same major version as the database.
FROM postgres:16-alpine
RUN apk add --no-cache bash age aws-cli coreutils
COPY backup.sh restore.sh verify-restore.sh s3.sh latest.sh restore-test.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/backup.sh"]
