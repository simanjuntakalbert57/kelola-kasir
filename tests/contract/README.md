# API contract test

[Schemathesis](https://schemathesis.readthedocs.io) fuzzes the real API against `docs/api/openapi.yaml`
and fails on any mismatch: response status not documented, response body or content type not matching
the schema, 5xx, and so on. It runs in the `contract` job of `.github/workflows/ci.yml` on every PR.

## Run locally

Needs a disposable PostgreSQL database and Python 3.9+.

```sh
python3 -m venv .venv-contract && . .venv-contract/bin/activate
pip install -r tests/contract/requirements.txt
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kk_contract tests/contract/run.sh
```

`run.sh` starts `apps/api/src/scripts/contract-server.ts` (migrates, seeds one outlet, owner, employee and paired
device with throwaway credentials, writes their tokens to a temp file), then runs schemathesis with
`hooks.py`, which authenticates each operation from its `security` definition. Pass extra
`schemathesis run` flags after the command, `CONTRACT_MAX_EXAMPLES=100` for a deeper run. A JUnit report
lands in `tests/contract/reports/`.

## Fixtures

`contract-server.ts` also seeds a category, two products, an open shift, a cash sale and a pending QRIS sale, and
points the (dummy) object storage at a fake endpoint so `POST /uploads` can answer 201. `hooks.py` swaps the random
path parameters for these real ids on every other call (a fresh resource for DELETE and for confirm/cancel
payment), so path-parameter operations reach their logic instead of only returning 404.

## Adding endpoints

`pending-operations.txt` lists the operations the API does not implement yet (they are skipped). When the
Backend ships an endpoint, delete its line in the same PR: from then on CI checks it against the spec.

## Deliberate leniency

- `hooks.py` adds the shared `400/401/403/404` problem+json responses to every operation in memory, because the draft
  spec does not list them everywhere. They are still validated against the `Problem` schema. Drop entries from
  `DEFAULT_ERROR_RESPONSES` as the spec documents them.
- Checks not enforced: `ignored_auth`, `missing_required_header`, `unsupported_method` (authz is covered by
  `apps/api/test/rbac.test.ts`; `TRACE` and friends return 404 not 405), `negative_data_rejection` (flags unknown query
  parameters, which the API rightly ignores).
- `positive_data_acceptance` is off in CI (`CONTRACT_EXCLUDE_CHECKS`) until the known spec/API gaps are fixed:
  the spec lacks `minLength: 1` on names and `pairing_code`, `format: uuid` and `format: email` are laxer than the
  API's zod validation. Remove the variable from the workflow once fixed.
- Deterministic generation by default (stable PR gate); `CONTRACT_RANDOM=1` fuzzes with fresh seeds and finds more (see bug issues).

- `filter_too_much` (Hypothesis health check) is suppressed for all operations: which operation trips it on CI varies between runs (updateCategory, approveVoidWithOwnerPin, ...), and it reflects the data generator, not the API.
