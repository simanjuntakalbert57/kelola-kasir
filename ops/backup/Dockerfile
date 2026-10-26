# Image the daily backup workflow runs (.github/workflows/backup.yml, docs/ops/backup-restore.md).
# PostgreSQL 16 client: the Neon project must run Postgres 16.
FROM postgres:16-alpine
RUN apk add --no-cache bash age aws-cli coreutils
COPY backup.sh restore.sh verify-restore.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/backup.sh"]
