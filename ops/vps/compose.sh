#!/usr/bin/env bash
# docker compose with the two env files of /opt/kelola-kasir (docs/ops/runbook.md):
#   .env         owner secrets and settings (chmod 600, never in the repo)
#   release.env  API_TAG of the deployed image, written by the deploy workflow
# Examples: ./compose.sh ps | ./compose.sh logs -f api | ./compose.sh --profile backup run --rm backup
set -euo pipefail
cd "$(dirname "$0")"
[[ -f release.env ]] || { echo "release.env is missing: run the 'Deploy API to VPS' workflow first" >&2; exit 1; }
exec docker compose --env-file .env --env-file release.env -f compose.yaml "$@"
