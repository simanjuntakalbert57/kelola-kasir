# @kelola-kasir/api

Backend API: Fastify 5, Drizzle ORM, PostgreSQL 16, Zod. Contract: [`docs/api/openapi.yaml`](../../docs/api/openapi.yaml)
(TDD v1.1, ADR-0002/0006/0009).

Implemented so far (DEAR-8): skeleton, owner auth (B-2), devices (B-3), employees + PIN login + RBAC (B-4),
shifts (B-7), backup tooling (B-14, see [`docs/ops/backup-restore.md`](../../docs/ops/backup-restore.md)).
DEAR-11: catalog (B-5), store settings and static QRIS (B-6), transactions (B-8), payments (B-9), offline sync (B-10).
DEAR-15: dashboard summary/series/top products and sales report (B-11), CSV/XLSX export (B-12), void requests with
approval and audit (B-13). Notifications follow in B-15.

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
(the audit log is append-only by design). `pnpm test` prints coverage and fails when `transactions`, `payments` or `sync`
drop below 80%.

## Migrations

Schema lives in `src/db/schema.ts`. `pnpm --filter @kelola-kasir/api db:generate` writes SQL to `drizzle/`; commit it.
`drizzle/0001_triggers.sql` is hand-written: sync cursor (`updated_seq`), transaction immutability and state machine,
append-only audit log.

## Conventions

- Errors are `application/problem+json` with a stable `code`; validation errors list `errors[{path, message}]`.
- Money is integer Rupiah (`BIGINT`). Timestamps are UTC; business days (`date_from`/`date_to`) are WIB (UTC+7).
- Services take the database or a transaction handle. Every audited change writes its `audit_logs` row in the same
  transaction. PINs, passwords and tokens are never logged or audited.
- RBAC is enforced per route by guards in `src/plugins/auth.ts`: `owner`, `device`, `employee`, `ownerOrEmployee`,
  `ownerOrDevice`. The `manager` role is treated exactly like `owner` (TDD §2.3).
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

### Catalog, settings, transactions, payments and sync (DEAR-11)

| Endpoint                                                                          | Auth                         | Notes                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /catalog`                                                                    | owner or device              | Categories + active products and a `/sync/pull` cursor                                                                                                                                                                                        |
| `GET/POST /categories`, `PATCH/DELETE /categories/{id}`                           | owner                        | Soft delete; `409 CATEGORY_NOT_EMPTY` while products remain                                                                                                                                                                                   |
| `GET/POST /products`, `GET/PATCH/DELETE /products/{id}`                           | owner                        | One price per product, `is_favorite` + `sort_order`; price changes audited (`product.price_changed`); soft delete keeps transaction snapshots                                                                                                 |
| `PATCH /products/{id}/availability`                                               | owner or employee            | Sold-out flag, audited, idempotent                                                                                                                                                                                                            |
| `POST /uploads`                                                                   | owner                        | Presigned PUT (SigV4, Cloudflare R2). `503 UPLOADS_NOT_CONFIGURED` without `STORAGE_*` env vars. Content type is signed, size capped at 2 MiB                                                                                                 |
| `GET /settings`, `PATCH /settings`                                                | owner or device / owner      | Receipt header/footer, quick cash, offline login, owner PIN (hashed, must differ from employee PINs). QRIS payload validated (`422 INVALID_QRIS_PAYLOAD`); QRIS image or `qris_embed_amount` without a payload is `422 QRIS_PAYLOAD_REQUIRED` |
| `POST /settings/qris/decode`                                                      | owner                        | Reads the QRIS payload from a PNG/JPEG of the shop's QR (jsQR) and validates structure + CRC                                                                                                                                                  |
| `GET/POST /transactions`, `GET /transactions/{id}`, `GET .../receipt`             | employee / owner             | Employees: open shift or today only. Create is idempotent on `id`, recomputes totals, snapshots prices, flags `price_mismatch`                                                                                                                |
| `GET /payments/{id}`, `POST /payments/{id}/confirm`, `POST /payments/{id}/cancel` | owner or employee / employee | Static QRIS with manual confirmation, 15 minute expiry (job every 30 s + lazy on read)                                                                                                                                                        |
| `GET /sync/pull`, `POST /sync/push`                                               | device                       | Cursor pull with tombstones, batch push (max 50) idempotent per mutation id                                                                                                                                                                   |

All error codes are enumerated in the contract (`ErrorCode` in `docs/api/openapi.yaml`, also in `@kelola-kasir/contracts`).

### Static QRIS

`StaticQrisProvider` (ADR-0007) shows the shop's own QR with manual confirmation. With `qris_embed_amount` it inserts the
amount (EMVCo tag 54), switches tag 01 to `12` and recomputes the CRC16 so buyers need not type it (test with real
e-wallets before enabling it in production). `outlet_settings.qris_mode = dynamic` is reserved for the gateway providers (phase 2) and
currently answers `503 QRIS_PROVIDER_UNAVAILABLE`. The expiry job (`startExpiryJob`, started by `src/server.ts`) turns
pending payments older than 15 minutes into `expired` and their transaction into `cancelled`; an advisory lock keeps several
instances from doing it twice.

### Sync

`/sync/pull` returns changes with `updated_seq > cursor` (omit the cursor for a full snapshot without tombstones),
at most `limit` (default 500) per page. Employees carry `pin_hash` only when the owner enabled offline login.
`/sync/push` applies mutations in order, each in its own DB transaction; the answer per mutation is `applied`, `duplicate`
(replay, safe) or `rejected` with a `code`. See TDD §2.4 and ADR-0008 for the conflict rules.

### Dashboard, export and voids (DEAR-15)

| Endpoint                                                   | Auth              | Notes                                                                                       |
| ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `GET /dashboard/summary`, `/sales-series`, `/top-products` | owner             | `paid` + `void_requested` by `client_created_at`, WIB business days; series are zero-filled |
| `GET /reports/sales?group_by=`                             | owner             | product, employee, payment method or day                                                    |
| `GET /transactions/export?format=csv\|xlsx`                | owner             | Streamed in batches of 500; `detail=true` = one row per item; audited                       |
| `POST /transactions/{id}/void-requests`                    | employee, owner   | Employee: `paid` → `void_requested` (idempotent on `id`); owner: voids at once              |
| `GET /void-requests`, `POST .../approve`, `.../reject`     | owner             | Same decision twice is a replay; the opposite one is `409 VOID_ALREADY_DECIDED`             |
| `POST /void-requests/{id}/approve-with-pin`                | employee + device | Owner PIN on the cashier phone; 5 wrong PINs per outlet in 15 min lock it (`423`)           |

Reports count `paid` and `void_requested`; `voided`, `cancelled` and `pending` are never revenue. Every void writes
`transaction.void_requested` / `void_approved` / `void_rejected` to the append-only `audit_logs` (actor, reason, time, channel)
in the same DB transaction as the status change. A closed shift keeps its frozen totals even if one of its sales is voided later.

## Design notes

- **Employee PIN uniqueness**: argon2id hashes are salted, so uniqueness uses `pin_fingerprint = HMAC-SHA256(secret, outlet_id:pin)`
  with a partial unique index over active employees.
- **PIN lockout** counts the attempt _before_ verifying (row lock), so parallel guesses cannot outrun the lock.
- **Sessions**: employee JWTs (EdDSA, 12 h) carry a `jti` backed by `employee_sessions`; every request re-checks the session,
  the employee, and the device token, so logout, deactivation and device revocation take effect at once.
- **Transactions** are append-only: the DB trigger of `0001_triggers.sql` refuses edits of financial columns once a
  transaction left `pending`, and `POST /transactions` + `shift.close` + QRIS confirmation never touch them afterwards.
- **Closing a shift** marks transactions created after `closed_at` as `after_shift_close` and reports them as `late_*`;
  a closed shift keeps the totals recorded at close.
