# @kelola-kasir/api

Backend API: Fastify 5, Drizzle ORM, PostgreSQL 16, Zod. Contract: [`docs/api/openapi.yaml`](../../docs/api/openapi.yaml)
(TDD v1.1, ADR-0002/0006/0009).

Implemented so far (DEAR-8): skeleton, owner auth (B-2), devices (B-3), employees + PIN login + RBAC (B-4),
shifts (B-7), backup tooling (B-14, see [`docs/ops/backup-restore.md`](../../docs/ops/backup-restore.md)).
Catalog, transactions, payments, sync, dashboard and settings follow in B-5/B-6/B-8..B-13.

## Run locally

```sh
cp .env.example .env            # fill DATABASE_URL
pnpm install
pnpm --filter @kelola-kasir/api db:migrate
OWNER_EMAIL=owner@example.com OWNER_PASSWORD='at-least-12-chars' OUTLET_CODE=JUS1 OUTLET_NAME='Toko Jus' \
  pnpm --filter @kelola-kasir/api owner:create
pnpm --filter @kelola-kasir/api dev          # http://localhost:3000, base path /v1, health at /healthz
```

Production: `pnpm --filter @kelola-kasir/api build`, then `node dist/db/migrate.js && node dist/server.js`.
Generate the signing key with `pnpm --filter @kelola-kasir/api keys:generate` and keep it in the secret manager.

## Tests

`pnpm --filter @kelola-kasir/api test` runs unit and integration tests against **real PostgreSQL 16**.
By default a Testcontainers instance is started (needs Docker, as in CI). Without Docker point to any
server whose user may `CREATE DATABASE`:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @kelola-kasir/api test
```

Each test file works in a throw-away database and each test seeds its own outlet, so tests never truncate tables
(the audit log is append-only by design). `pnpm --filter @kelola-kasir/api test:coverage` prints coverage.

## Migrations

Schema lives in `src/db/schema.ts`. `pnpm --filter @kelola-kasir/api db:generate` writes SQL to `drizzle/`; commit it.
`drizzle/0001_triggers.sql` is hand-written: sync cursor (`updated_seq`), transaction immutability and state machine,
append-only audit log.

## Conventions

- Errors are `application/problem+json` with a stable `code`; validation errors list `errors[{path, message}]`.
- Money is integer Rupiah (`BIGINT`). Timestamps are UTC; business days (`date_from`/`date_to`) are WIB (UTC+7).
- Services take the database or a transaction handle. Every audited change writes its `audit_logs` row in the same
  transaction. PINs, passwords and tokens are never logged or audited.
- RBAC is enforced per route by guards in `src/plugins/auth.ts`: `owner`, `device`, `employee`, `ownerOrEmployee`.
  A valid token of the wrong kind is `403 FORBIDDEN`; missing/invalid credentials are `401`.

## Implemented endpoints

| Endpoint                                                                         | Auth              | Notes                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`                                                               | –                 | Rate limited (5/min/IP). 5 wrong passwords lock the account 10 min (`429 ACCOUNT_LOCKED`). Sets `kk_refresh` cookie                 |
| `POST /auth/refresh`                                                             | cookie            | Rotates the refresh token; reuse of a rotated token revokes the whole family                                                        |
| `POST /auth/logout`                                                              | owner             | Revokes the refresh family, clears the cookie                                                                                       |
| `POST /auth/pin-login`                                                           | device            | 5 wrong PINs lock the employee on that device for 5 min (`423 PIN_LOCKED`, `Retry-After`)                                           |
| `POST /auth/pin-logout`                                                          | employee          | Ends the session immediately                                                                                                        |
| `GET /me`                                                                        | owner or employee |                                                                                                                                     |
| `GET/POST /devices`, `POST /devices/{id}/revoke`                                 | owner             | Pairing code: 8 chars, 10 min, single use, stored hashed                                                                            |
| `POST /devices/pair`                                                             | –                 | Rate limited (10/hour/IP). Returns the device token once; only its SHA-256 is stored                                                |
| `GET /devices/me/employees`                                                      | device            |                                                                                                                                     |
| `GET/POST /employees`, `PATCH /employees/{id}`, `POST /employees/{id}/reset-pin` | owner             | PIN unique per outlet (`409 PIN_NOT_UNIQUE`); reset/deactivate ends sessions                                                        |
| `GET /shifts`                                                                    | owner             | Filters `date_from`, `date_to`, `employee_id`, `status`; cursor pagination                                                          |
| `POST /shifts`                                                                   | employee          | Idempotent on `id`; `409 SHIFT_ALREADY_OPEN` if the outlet has an open shift (DB-enforced)                                          |
| `GET /shifts/current`                                                            | employee          | `204` when none                                                                                                                     |
| `GET /shifts/{id}/summary`                                                       | owner or employee | Employees: the open shift or a shift they closed                                                                                    |
| `POST /shifts/{id}/close`                                                        | employee          | `expected_cash = opening + cash sales (paid + void_requested, created <= closed_at)`; `409 SHIFT_CLOSED`, `409 PENDING_QRIS_EXISTS` |

Error codes added beyond the contract's examples: `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED` (429), `RATE_LIMITED` (429),
`DEVICE_REVOKED`, `INVALID_PAIRING_CODE`, `DEVICE_LIMIT_REACHED`, `ID_CONFLICT`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`.

## Design notes

- **Employee PIN uniqueness**: argon2id hashes are salted, so uniqueness uses `pin_fingerprint = HMAC-SHA256(secret, outlet_id:pin)`
  with a partial unique index over active employees.
- **PIN lockout** counts the attempt _before_ verifying (row lock), so parallel guesses cannot outrun the lock.
- **Sessions**: employee JWTs (EdDSA, 12 h) carry a `jti` backed by `employee_sessions`; every request re-checks the session,
  the employee, and the device token, so logout, deactivation and device revocation take effect at once.
- **Closing a shift** marks transactions created after `closed_at` as `after_shift_close` and reports them as `late_*`;
  a closed shift keeps the totals recorded at close.
