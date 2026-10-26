#!/usr/bin/env bash
# API contract test: fuzz the real API against docs/api/openapi.yaml with schemathesis.
# Requires: DATABASE_URL (disposable PostgreSQL database), schemathesis on PATH (tests/contract/requirements.txt).
#
# Checks left out on purpose (see tests/contract/README.md):
#   ignored_auth, missing_required_header, unsupported_method  covered by apps/api/test/rbac.test.ts / Fastify defaults
#   negative_data_rejection  flags harmless unknown query parameters as failures
#   positive_data_acceptance (via CONTRACT_EXCLUDE_CHECKS in CI)  temporary, see the linked bug issue
# Extra arguments are passed to `schemathesis run`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
export PORT="${CONTRACT_PORT:-3100}"
WORK="$(mktemp -d)"
export CONTRACT_SESSION_FILE="$WORK/session.json"
export CONTRACT_BASE_URL="http://127.0.0.1:${PORT}/v1"

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cd "$ROOT/apps/api"
pnpm exec tsx src/scripts/contract-server.ts >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$WORK/server.log"; exit 1; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null || { cat "$WORK/server.log"; exit 1; }
[[ -s "$CONTRACT_SESSION_FILE" ]] || { cat "$WORK/server.log"; exit 1; }

cd "$ROOT"
EXCLUDES=()
while read -r op _; do
  [[ -z "$op" || "$op" == \#* ]] && continue
  EXCLUDES+=(--exclude-operation-id "$op")
done <"$ROOT/tests/contract/pending-operations.txt"

# Deterministic by default so a PR is never failed by an unrelated random finding; CONTRACT_RANDOM=1 fuzzes freshly.
DETERMINISTIC=()
[[ -z "${CONTRACT_RANDOM:-}" ]] && DETERMINISTIC=(--generation-deterministic)

# `filter_too_much` is suppressed for every operation: Hypothesis (Python 3.12 on CI) intermittently gives up on
# operations with narrow patterns (updateCategory's partial body, approveVoidWithOwnerPin's `^[0-9]{6}$`) and fails
# the run with "Failed Health Check" although the API behaves. It is a property of the data generator, not of the
# API, and which operation trips it varies between runs, so a per-operation list kept breaking PRs unrelated to it.
# Every other check (status, schema, content type, 5xx, ...) stays strict.

run_schemathesis() {
  SCHEMATHESIS_HOOKS="tests.contract.hooks" PYTHONPATH="$ROOT" \
    schemathesis run docs/api/openapi.yaml \
    --url "$CONTRACT_BASE_URL" \
    --checks all \
    --suppress-health-check filter_too_much \
    --generation-with-security-parameters false \
    --generation-allow-x00 false \
    ${DETERMINISTIC[@]+"${DETERMINISTIC[@]}"} \
    --generation-codec ascii \
    --max-examples "${CONTRACT_MAX_EXAMPLES:-25}" \
    --phases examples,coverage,fuzzing \
    --exclude-checks "ignored_auth,unsupported_method,missing_required_header,negative_data_rejection${CONTRACT_EXCLUDE_CHECKS:+,$CONTRACT_EXCLUDE_CHECKS}" \
    --report junit --report-dir "${CONTRACT_REPORT_DIR:-$ROOT/tests/contract/reports}" \
    "$@"
}

run_schemathesis ${EXCLUDES[@]+"${EXCLUDES[@]}"} "$@" || { echo "--- server log ---"; tail -50 "$WORK/server.log"; exit 1; }
