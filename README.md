# Kelola Kasir

Point-of-sale system for a juice shop: backend API, cashier app for Android phones (portrait,
offline-first, Bluetooth receipt printing) and a web dashboard for the owner.

| Path                    | What                                                            | Status              |
| ----------------------- | --------------------------------------------------------------- | ------------------- |
| `apps/api`              | Fastify + Drizzle + PostgreSQL API                              | B-1..B-4, B-7, B-14 |
| `apps/kasir`            | React Native (Expo) cashier app                                 | placeholder (M-1)   |
| `apps/dashboard`        | React + Vite owner dashboard                                    | placeholder (F-1)   |
| `packages/contracts`    | TypeScript types generated from `docs/api/openapi.yaml`         | ready               |
| `packages/money`        | Integer Rupiah helpers (format, parse, cart totals, change)     | ready               |
| `docs/tdd.md`           | Technical design (v1.1)                                         |                     |
| `docs/adr/`             | Architecture decision records                                   |                     |
| `docs/api/openapi.yaml` | API contract (OpenAPI 3.1, source of truth)                     |                     |
| `docs/design/`          | Final UI design (open `kasir.html` / `owner.html` in a browser) |                     |

## Requirements

- Node.js 24.18+ (`.nvmrc`; `nvm use`)
- pnpm 10 (`corepack enable` picks the version from `packageManager`)

## Setup

```sh
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Common commands

| Command                            | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| `pnpm mock`                        | Mock API from `openapi.yaml` (Prism) at `http://localhost:4010`     |
| `pnpm mock:dynamic`                | Same, with randomly generated response data                         |
| `pnpm api:lint`                    | Lint the OpenAPI contract (Redocly)                                 |
| `pnpm contracts:generate`          | Regenerate `packages/contracts` types after changing `openapi.yaml` |
| `pnpm contracts:check`             | Fail if generated types are out of date (runs in CI)                |
| `pnpm lint` / `typecheck` / `test` | Run across all workspaces (Turborepo)                               |
| `pnpm format`                      | Format with Prettier                                                |

### Using the mock API

The mock validates requests against the contract, including auth headers. Example:

```sh
pnpm mock
curl http://localhost:4010/catalog -H 'X-Device-Token: dev'
curl http://localhost:4010/shifts/current -H 'Authorization: Bearer dev' -H 'X-Device-Token: dev'
```

Point the cashier app and dashboard at `http://localhost:4010` (the mock serves paths without the
`/v1` prefix) until the real API is available. Force a specific response with the `Prefer` header,
e.g. `-H 'Prefer: code=409'`.

## Workflow

- Branch from `main`, open a PR to `main`. The Tech Lead reviews every PR; CI must be green before merge.
- API contract changes go to `docs/api/openapi.yaml` first, then `pnpm contracts:generate`.
- Money is always an integer number of Rupiah. Use `@kelola-kasir/money`, never floats.
- Never commit secrets. Use environment variables; `.env` is git-ignored and CI runs gitleaks.
- Code, commits and PRs are in English.

CI (`.github/workflows/ci.yml`) runs: Redocly lint, contracts drift check, Prettier, ESLint,
`tsc --noEmit`, Vitest, and a gitleaks secret scan.
