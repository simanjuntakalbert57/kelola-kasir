# shellcheck shell=bash
# Sourced by the backup scripts: S3 settings shared by backup.sh, latest.sh and restore-test.sh.
#   R2_ENDPOINT       https://<account-id>.r2.cloudflarestorage.com  or  https://s3.<region>.backblazeb2.com
#   BACKUP_S3_REGION  signing region; default: <region> of a B2 endpoint, else auto (R2)
# B2 rejects SigV4 requests signed for any region other than the endpoint's own, R2 expects "auto".
s3_setup() {
  : "${R2_ENDPOINT:?R2_ENDPOINT is required for s3:// targets}"
  local region="${BACKUP_S3_REGION:-}"
  if [ -z "$region" ]; then
    case "$R2_ENDPOINT" in
      *://s3.*.backblazeb2.com*) region="${R2_ENDPOINT#*://s3.}"; region="${region%%.backblazeb2.com*}" ;;
      *) region=auto ;;
    esac
  fi
  export AWS_DEFAULT_REGION="$region"
}

s3() { aws --endpoint-url "$R2_ENDPOINT" s3 "$@"; }

# Backup object names, oldest first: kelola-kasir-<UTC timestamp>.dump.age sorts by time.
backup_names() {
  case "$BACKUP_TARGET" in
    local:*) find "${BACKUP_TARGET#local:}" -maxdepth 1 -name 'kelola-kasir-*.dump.age' -type f -exec basename {} \; | sort ;;
    s3://*) s3_setup; s3 ls "${BACKUP_TARGET%/}/" | awk '$4 ~ /^kelola-kasir-.*\.dump\.age$/ {print $4}' | sort ;;
    *) echo "unsupported BACKUP_TARGET (use s3://bucket/prefix or local:/dir)" >&2; return 2 ;;
  esac
}
