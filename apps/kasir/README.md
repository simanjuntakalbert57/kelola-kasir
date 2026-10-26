# @kelola-kasir/kasir

Cashier app for Android phones in portrait (React Native / Expo dev build, offline-first).

Implemented so far (M-1, M-3, M-4, M-5): Expo Router skeleton with Jual/Riwayat/Shift tabs, dark theme from `docs/design/design.css` (DEAR-5), typed API client on `packages/contracts`, device pairing + token in Android Keystore (`expo-secure-store`), PIN login (employee picker, keypad, cached employees, offline argon2id check, 5-wrong → 5-minute lockout), open shift (prefilled opening cash, joins an already-open shift on `409 SHIFT_ALREADY_OPEN`).

Added in DEAR-12 (M-2, M-6, M-8, M-9, M-10): local SQLite (`expo-sqlite`, schema in `src/db/migrations.ts`, repositories take a thin `Db` so tests run on `node:sqlite`), catalog pull every 60 s (`src/catalog/sync.ts`), grid per category + Favorit (best sellers on this device) + search with sold-out hidden, cart (tap = +1) and pay bar, cash payment (Uang Pas, quick amounts, keypad, change) saved to SQLite + outbox in one local transaction, outbox push every 30 s with the "N transaksi belum tersinkron" banner, QRIS static with manual confirmation (online only, 15-minute countdown, cancel). The "Cetak struk" toggle is stored per device.

Added in DEAR-16 (M-11..M-14):

- **Thermal printing (M-11)**: ESC/POS 58 mm over **Bluetooth Classic (SPP)** (`react-native-bluetooth-classic`; the RPP02N is not BLE) behind `PrinterTransport` (`src/printing/service.ts`). Pure formatter in `src/printing/layout.ts` + `escpos.ts` (32 columns, ASCII only, no cutter: 4 feed lines). Receipt is built from SQLite + cached store settings, so it prints offline. Printer screen (K-12, Shift → Printer struk), auto-reconnect (app start, foreground, backoff while the printer is off), print after the sale in the background, banner "Printer tidak tersambung" / "Gagal mencetak" with Coba lagi / Lewati, reprint marked `*** CETAK ULANG ***`, WhatsApp share of the 32-column text. Printer faults never touch the saved sale.
- **History (M-12)**: Riwayat tab (shift / today, Semua/Cash/QRIS), unsynced and rejected badges, detail with receipt preview. Local rows merged with `GET /transactions` when online (other devices, owner decisions).
- **Close shift (M-13)**: Shift → Tutup shift. Server summary when reachable, device totals otherwise; live difference, note required when ≠ 0; online close when nothing is queued, otherwise strong warning then a queued `shift.close` (`closed_offline=true`).
- **Void request + sold-out (M-14)**: detail → Ajukan pembatalan (reason required, status "Menunggu void" at once, queued as `void_request.create` with payload `{id, transaction_id, reason}`); long-press a menu tile → Tandai habis (queued `product.mark_sold_out`), Shift → Menu habis to restore.

Android permissions (`plugins/withBluetooth.js`): `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (`neverForLocation`) on Android 12+; legacy Bluetooth + location (≤ API 30) only for older phones. This needs a dev build (`expo run:android`), not Expo Go.

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
