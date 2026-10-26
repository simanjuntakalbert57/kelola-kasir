# Image for the Railway cron service that runs the daily backup (see docs/ops/backup-restore.md).
FROM postgres:16-alpine
RUN apk add --no-cache bash age aws-cli coreutils
COPY backup.sh restore.sh verify-restore.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/backup.sh"]
