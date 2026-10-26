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

# Operations whose generated data Hypothesis sometimes filters out too heavily on CI fail the run with
# "Failed Health Check: filter_too_much" although every generated case passes. The health check can only be
# suppressed per run, so those operations get their own run and every other operation keeps the strict check.
# The void decision operations: flaky on CI (PR #23, PR #24) although every generated case passes.
FILTER_HEAVY=(approveVoidRequest rejectVoidRequest approveVoidWithOwnerPin)

run_schemathesis() {
  SCHEMATHESIS_HOOKS="tests.contract.hooks" PYTHONPATH="$ROOT" \
    schemathesis run docs/api/openapi.yaml \
    --url "$CONTRACT_BASE_URL" \
    --checks all \
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

STRICT=(${EXCLUDES[@]+"${EXCLUDES[@]}"})
LENIENT=()
for op in "${FILTER_HEAVY[@]}"; do
  STRICT+=(--exclude-operation-id "$op")
  LENIENT+=(--include-operation-id "$op")
done

{
  run_schemathesis "${STRICT[@]}" "$@" &&
    run_schemathesis "${LENIENT[@]}" --suppress-health-check filter_too_much "$@"
} || { echo "--- server log ---"; tail -50 "$WORK/server.log"; exit 1; }
