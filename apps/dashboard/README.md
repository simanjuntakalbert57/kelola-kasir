# @kelola-kasir/dashboard

Owner web dashboard: React + Vite, TanStack Router/Query, Tailwind (dark theme from `docs/design/design.css`, DEAR-5). See ADR-0004.

## Run

```sh
pnpm install
pnpm mock                                   # repo root: Prism mock on :4010
pnpm --filter @kelola-kasir/dashboard dev:mock   # dashboard against the mock
pnpm --filter @kelola-kasir/dashboard dev        # dashboard against the real API (VITE_API_PROXY, default :3000)
```

Auth: access token is kept in memory; the refresh token is the `kk_refresh` HttpOnly cookie, so the dashboard and API must share a site (the dev proxy keeps them same-origin). Setting `VITE_API_URL` to a different site makes the browser withhold the `SameSite=Strict` cookie, so refresh and session restore fail; keep `app.` and `api.` under the same registrable domain.

## Layout

- `src/lib/api.ts`: fetch client (bearer token, single-flight refresh on 401, problem+json errors)
- `src/auth/`: `AuthProvider` (login, restore session, logout)
- `src/layout/AppShell.tsx`: sidebar (≥768px) and bottom tab bar (<768px)
- `src/pages/`: pages (Pegawai, Perangkat done; others are placeholders for F-2…F-8)
- `src/components/ui.tsx`: reusable primitives (Button, Field, Dialog, Badge, …)

Keep the workspace scripts `lint`, `typecheck` and `test` so CI keeps covering this package.
