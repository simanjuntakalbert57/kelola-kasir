# @kelola-kasir/kasir

Cashier app for Android phones in portrait (React Native / Expo dev build, offline-first).

Implemented so far (M-1, M-3, M-4, M-5): Expo Router skeleton with Jual/Riwayat/Shift tabs, dark theme from `docs/design/design.css` (DEAR-5), typed API client on `packages/contracts`, device pairing + token in Android Keystore (`expo-secure-store`), PIN login (employee picker, keypad, cached employees, offline argon2id check, 5-wrong → 5-minute lockout), open shift (prefilled opening cash, joins an already-open shift on `409 SHIFT_ALREADY_OPEN`).

Added in DEAR-12 (M-2, M-6, M-8, M-9, M-10): local SQLite (`expo-sqlite`, schema in `src/db/migrations.ts`, repositories take a thin `Db` so tests run on `node:sqlite`), catalog pull every 60 s (`src/catalog/sync.ts`), grid per category + Favorit (best sellers on this device) + search with sold-out hidden, cart (tap = +1) and pay bar, cash payment (Uang Pas, quick amounts, keypad, change) saved to SQLite + outbox in one local transaction, outbox push every 30 s with the "N transaksi belum tersinkron" banner, QRIS static with manual confirmation (online only, 15-minute countdown, cancel). The "Cetak struk" toggle is stored per device; the actual ESC/POS printing is M-11.

## Run

```sh
pnpm install
# Backend: Prism mock (serves without the /v1 prefix) or the real API
pnpm mock                                   # http://localhost:4010
EXPO_PUBLIC_API_URL=http://10.0.2.2:4010 pnpm --filter @kelola-kasir/kasir android   # emulator → host
# Stateful fake with 204 / 401 / 423 flows: pairing code AB12CD34, PIN 123456
node apps/kasir/scripts/dev-api.mjs 4011
# Web preview (UI only, localStorage instead of Keystore)
EXPO_PUBLIC_API_URL=http://localhost:4011 pnpm --filter @kelola-kasir/kasir web
```

`expo run:android` needs JDK 17 and the Android SDK. Real API: `EXPO_PUBLIC_API_URL=http://<host>:3000/v1`.

Keep the workspace scripts `lint`, `typecheck` and `test` so CI covers this package.
