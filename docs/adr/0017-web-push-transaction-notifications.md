ADR-0017 — Notifikasi transaksi & void di laptop owner lewat Web Push dashboard (Service Worker + VAPID)

Status: Accepted · Tanggal: 2026-10-30 · Menggantikan: [ADR-0016](0016-telegram-transaction-notifications.md) (kanal Telegram) · Keputusan: Albert (DEAR-98, "notifikasinya di laptop") + Tech Lead · Issue: DEAR-99 · Desain: DEAR-100 (`docs/design/notifikasi-laptop.html`) · Biaya tambahan: Rp0

## Konteks
Owner ingin tahu setiap transaksi yang masuk tanpa membuka dashboard. ADR-0016 memilih Telegram. Pada 29 Okt 2026 Albert memutuskan notifikasi muncul **di laptop** (DEAR-98). Karena itu kanalnya adalah **notifikasi sistem dari browser** (Chrome/Edge di Windows/macOS) lewat **Web Push**: dashboard mendaftarkan Service Worker, browser membuat *push subscription*, dan API mengirim pesan terenkripsi ke push service browser (FCM untuk Chrome, WNS untuk Edge, Mozilla autopush, Apple). Notifikasi tetap muncul walau tab dashboard ditutup, selama browser berjalan.

Bagian ADR-0016 yang **tetap berlaku** dan dipakai ulang di sini: pemicu, batching `sync/push`, enqueue setelah commit tanpa `await`, idempotensi lewat `notification_log`, dan dispatcher in-process. Yang **diganti**: kanal, tabel `notification_channels`, endpoint `/notifications/telegram*` + webhook, secret Telegram, dan pembagian tugas. Kontrak Telegram belum pernah diimplementasikan, jadi dihapus dari OpenAPI tanpa masa transisi.

Batasan:
- Transaksi kasir tidak boleh gagal atau melambat karena push service.
- `sync/push` bisa membawa sampai 50 mutasi. Layar laptop owner tidak boleh dibanjiri.
- Retry `sync/push`, polling QRIS, dan restart API tidak boleh membuat notifikasi ganda.
- Notifikasi bisa terlihat orang lain di layar, jadi isinya hanya angka ringkas: tanpa PIN, token, `customer_label`, alasan void, atau referensi pembayaran (desain DEAR-100 §A.1).
- API mengirim HTTP ke URL `endpoint` yang dikirim klien → wajib dicegah menjadi SSRF.

## Keputusan

### 1. Pemicu (event)
| Event | Kunci desain | Kapan | Titik di kode |
|---|---|---|---|
| `transaction.paid` | `trx.single` / `trx.offline` | Transaksi berubah menjadi `paid` | Cash online: `POST /transactions` saat `created && status = 'paid'`. QRIS: `PaymentService.confirm` / `get` (poll provider) / webhook pembayaran, saat `markPaid` benar-benar mengubah status. Offline: `sync/push` ≤ 3 transaksi (§2). |
| `transaction.batch` | `trx.batch` | > 3 `transaction.create` berstatus `applied` dalam 1 `sync/push` | `POST /sync/push`, setelah `pushMutations` selesai |
| `void.requested` | `void.requested` | Void diajukan kasir (`created = true`), online atau dari outbox | `requestVoid` (route + `sync/push`) |
| `void.approved` | `void.approved` | Void **disetujui**: owner dari dashboard, PIN owner di HP kasir (`device_pin`), atau void langsung owner | `decideVoid` (hanya `approved`), `voidDirectly` |

- **Void ditolak tidak dikirim** (desain §A.3). Persetujuan oleh owner sendiri tetap dikirim ke semua browsernya (desain §E; sederhana, bisa disaring nanti).
- QRIS `pending`, `cancelled`, dan kedaluwarsa **tidak** dikirim.
- Replay (`created = false`, `duplicate`, `markPaid` pada payment yang sudah `paid`) tidak memicu apa pun.
- `entity_id` = `transactions.id` untuk `transaction.paid`, `void_requests.id` untuk `void.*`, dan **id transaksi terkecil** dalam batch untuk `transaction.batch`.
- Penerima: semua langganan aktif (§6) milik user ber-role **owner** di `outlet_members` gerai itu yang prefs-nya menyala untuk jenis tersebut. Manager tidak menerima di potongan ini.

### 2. Batching `sync/push`
- Route `sync/push` mengumpulkan hasil `transaction.create` yang `applied` (bukan `duplicate`/`rejected`) **dan berstatus `paid`**.
- **≤ 3** → masing-masing `transaction.paid` dengan varian `trx.offline` (judul "· offline", baris 2 "Dibuat {jam} WIB", jam = `created_at` di kasir).
- **> 3** → satu `transaction.batch`: jumlah, total, jumlah Cash/QRIS (yang 0 dihilangkan), maks. 2 nama kasir lalu "+N lainnya", jam sinkron. Transaksi di dalam batch tidak dikirim lagi satu per satu.
- Retry `sync/push` mengembalikan `duplicate` → tidak ada event baru. Unique key §4 jadi pengaman kedua.
- Antrean > 50 mutasi terkirim dalam beberapa request → bisa jadi beberapa ringkasan. Diterima.
- `void_request.create` dari outbox tidak dirangkum.

### 3. Pengiriman: setelah commit, tidak di jalur respons
- Modul baru `apps/api/src/modules/notifications`. `AppContext` mendapat `notifier: Notifier`.
- Handler memanggil `notifier.onTransactionPaid(id, { source })`, `onSyncApplied(...)`, `onVoidRequested(...)`, atau `onVoidApproved(...)` **setelah** `db.transaction(...)` selesai, **tanpa `await`**. `Notifier` tidak pernah melempar ke pemanggil; error ke log (+ Sentry).
- Enqueue: (1) cari langganan aktif penerima (§1) + prefs, (2) muat data dan render payload (§8), (3) `INSERT … ON CONFLICT DO NOTHING` ke `notification_log` per langganan (`status = 'pending'`), (4) `kick()` dispatcher.
- VAPID belum dikonfigurasi atau tidak ada langganan → tidak ada baris.
- Library: **`web-push`** (npm, MIT; enkripsi `aes128gcm` RFC 8291 + VAPID RFC 8292). Panggilan `sendNotification` memakai `timeout: 5000` ms dan opsi:
  - `TTL`: **14400** detik (4 jam) untuk transaksi/void; **60** detik untuk uji. Lewat TTL, push service membuang pesan (laptop tidur > 4 jam tidak memunculkan tumpukan notifikasi basi).
  - `urgency`: `high` untuk transaksi/void, `normal` untuk uji.
  - Tanpa header `Topic` (penggantian di layar sudah ditangani `tag`).

### 4. Idempotensi
- `notification_log` UNIQUE `(event, entity_id, subscription_id)`.
- Jalur online dan poll QRIS yang berpacu untuk transaksi yang sama berakhir di satu baris per langganan.
- Di sisi tampilan, `tag` (§8) membuat kiriman ulang mengganti notifikasi yang sama, bukan menumpuk.
- Browser yang mendaftar ulang mendapat `subscription_id` baru; event lama tidak dikirim ulang.

### 5. Retry: dispatcher in-process, tanpa worker terpisah
**Pilihan:** loop di dalam proses API, pola `startExpiryJob` QRIS di `server.ts`: `startNotificationJob(app.notifier, app.log)`, dihentikan saat `SIGTERM`. Tidak ada container, Redis, atau pg-boss baru.

- **Kapan jalan:** `kick()` langsung setelah enqueue (praktiknya < 2 detik) + interval **30 detik** sebagai jaring pengaman setelah restart/gagal kirim.
- **Single-flight:** maksimal satu putaran berjalan; `kick()` saat putaran berjalan cukup set flag "jalan lagi".
- **Satu putaran:** `SELECT … WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`, dikirim dengan konkurensi maks. 5. Tidak ada batas laju per penerima seperti Telegram.
- **Hasil kirim** (status HTTP dari push service):
  - `201`/`2xx` → `sent`, isi `sent_at`; `push_subscriptions.last_delivered_at = now()`.
  - `404` / `410` → `failed`, langganan dinonaktifkan: `revoked_at = now()`, `revoked_reason = 'gone'`. Baris `pending` lain untuk langganan itu ikut `failed`.
  - `429` → `next_attempt_at = now + Retry-After` (default 60 dtk), tidak dihitung percobaan.
  - Timeout, error jaringan, `5xx` → `attempts += 1`, backoff **30 dtk → 2 mnt → 10 mnt → 30 mnt**. Setelah 5 percobaan → `failed`.
  - `400`, `401`, `403`, `413` → `failed` tanpa retry (payload/VAPID salah: bug atau kunci tidak cocok), log level `error`.
- **Basi:** baris `pending` yang lebih tua dari TTL-nya (4 jam; uji 60 dtk) → `expired`, tanpa dikirim. Tidak ada gunanya mengirim pesan yang toh akan dibuang push service.
- `last_error` hanya status HTTP + nama error/maks. 300 karakter body. **URL `endpoint` dan header `Authorization` (JWT VAPID) tidak pernah dicatat**; endpoint adalah kapabilitas untuk mengirim ke browser itu.

**Kenapa bukan alternatif lain:** *retry saat request berikutnya* — malam hari tidak ada request; *worker/container terpisah* — berlebihan untuk ±ratusan pesan/hari di VPS 1 vCPU; *cron GitHub Actions* — resolusi menit dan bergantung pada Actions.

### 6. Data (migrasi aditif `0003_notifications`)
`push_subscriptions`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK default random | dikembalikan ke klien, disimpan di `localStorage` sebagai penanda "Browser ini" |
| `outlet_id` | uuid FK `outlets` | |
| `user_id` | uuid FK `users` | owner pemilik langganan |
| `endpoint` | text NOT NULL | URL push service (lihat validasi §7). Rahasia ringan: tidak pernah dikembalikan API atau dicatat di log. |
| `p256dh` | text NOT NULL | base64url, 65 byte setelah decode (titik P-256 tak terkompresi) |
| `auth` | text NOT NULL | base64url, 16 byte setelah decode |
| `label` | text NOT NULL | "Chrome di Windows"; dari klien (maks. 60 karakter), cadangan diturunkan dari User-Agent |
| `user_agent` | text null | maks. 300 karakter, untuk dukungan |
| `last_delivered_at` | timestamptz null | |
| `last_seen_at` | timestamptz NOT NULL default now() | diperbarui tiap dashboard mendaftar ulang langganan yang sama |
| `created_at`, `updated_at` | timestamptz | |
| `revoked_at` | timestamptz null | null = aktif |
| `revoked_reason` | text null, CHECK `IN ('user','gone','replaced','limit')` | |

Indeks: UNIQUE `(endpoint)` WHERE `revoked_at IS NULL`; `(outlet_id, user_id)` WHERE `revoked_at IS NULL`.

`notification_prefs` — preferensi **per akun owner per gerai**, berlaku untuk semua browsernya (desain §B.1). Tabel terpisah, bukan kolom JSONB di `push_subscriptions` seperti usulan awal issue, karena menyalin prefs ke tiap langganan membuat toggle tidak konsisten antar-browser.
| Kolom | Tipe | Catatan |
|---|---|---|
| `outlet_id`, `user_id` | uuid, PK gabungan | |
| `prefs` | jsonb NOT NULL default `{"transaction": true, "void": true}` | tidak ada baris = default |
| `updated_at` | timestamptz | |

`notification_log`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK default random | |
| `outlet_id` | uuid FK `outlets` | |
| `subscription_id` | uuid FK `push_subscriptions` **ON DELETE CASCADE** | |
| `event` | text, CHECK `IN ('transaction.paid','transaction.batch','void.requested','void.approved','subscription.test')` | |
| `entity_id` | uuid | §1; untuk `subscription.test`, UUID acak |
| `payload` | jsonb | payload final §8, dirender saat enqueue |
| `ttl_seconds` | int | 14400 atau 60 |
| `status` | text, CHECK `IN ('pending','sent','failed','expired')` default `pending` | |
| `attempts` | int default 0 | |
| `next_attempt_at` | timestamptz default now() | |
| `last_error` | text null | ≤ 300 karakter, tanpa endpoint/JWT |
| `created_at`, `sent_at` | timestamptz | |

Indeks: UNIQUE `(event, entity_id, subscription_id)`, `(next_attempt_at)` WHERE `status = 'pending'`.
Retensi (dispatcher, sekali per hari): baris `sent`/`expired`/`failed` > 30 hari dihapus; langganan `revoked` > 30 hari dihapus (log ikut terhapus).

**Batas:** maks. **10** langganan aktif per (outlet, user). Pendaftaran ke-11 mencabut yang `last_seen_at`-nya paling lama (`revoked_reason = 'limit'`).

### 7. API (kontrak di `docs/api/openapi.yaml`, tag `notifications`)
Semua endpoint: `ownerAuth` dan **role `owner`** di gerai token (manager → `403 FORBIDDEN`).

| Endpoint | Fungsi |
|---|---|
| `GET /notifications/push/config` | `{ configured, vapid_public_key }`. Kunci publik tidak rahasia; `configured: false` → dashboard menampilkan "belum tersedia". |
| `GET /notifications/push/subscriptions` | Daftar langganan user ini di gerai ini: `id`, `label`, `status` (`active`/`expired`), `created_at`, `last_delivered_at`. Yang dicabut user (`user`/`replaced`/`limit`) tidak ditampilkan; yang `gone` tampil sebagai `expired` (desain §B.8). Tanpa `endpoint`/kunci. |
| `POST /notifications/push/subscriptions` | Daftar/daftar ulang (upsert per `endpoint`). Body = `PushSubscription.toJSON()` (`endpoint`, `keys.p256dh`, `keys.auth`, `expirationTime` diabaikan) + `label`. Endpoint aktif yang sama milik user yang sama → perbarui kunci/label/`last_seen_at`, **200** dengan id lama. Milik user lain (browser bersama) → baris lama dicabut `replaced`, baris baru **201**. Maks. 20 panggilan/10 menit per user. |
| `DELETE /notifications/push/subscriptions/{id}` | Cabut (`revoked_reason = 'user'`), idempoten 204. Id milik user lain → 404. |
| `POST /notifications/push/subscriptions/{id}/test` | Kirim notifikasi uji **sinkron** ke satu langganan (timeout 5 dtk) supaya UI bisa membedakan hasil: 200 `{result:"sent"}`; `410 NOTIFICATION_SUBSCRIPTION_GONE` (push service 404/410, langganan langsung jadi `expired`); `502 PUSH_DELIVERY_FAILED` (error lain). Maks. 1 per 5 detik per langganan (429). Dicatat di `notification_log` sebagai `subscription.test`. |
| `GET /notifications/prefs` | `{ transaction, void }` untuk user ini di gerai ini |
| `PATCH /notifications/prefs` | Ubah salah satu/keduanya; 200 dengan nilai baru |

`configured: false` (§9) → `POST …/subscriptions` dan `…/test` mengembalikan `503 NOTIFICATIONS_NOT_CONFIGURED`; `GET` tetap 200.

**Validasi `endpoint` (anti-SSRF), wajib:**
- `https:` saja, tanpa userinfo, port default, panjang ≤ 1024.
- Host harus cocok dengan allowlist push service: `fcm.googleapis.com`, `*.googleapis.com` (`android.googleapis.com` lama), `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`. Selain itu → `400 INVALID_PUSH_SUBSCRIPTION`.
- `p256dh` / `auth` harus base64url valid dengan panjang hasil decode 65 / 16 byte.
- Allowlist disimpan di satu konstanta + unit test; menambah vendor = ubah konstanta + ADR ini.

**Audit:** `notification.subscription_added`, `notification.subscription_revoked`, `notification.prefs_updated`. Isinya `subscription_id`, `label`, prefs — tanpa endpoint atau kunci.

### 8. Payload & Service Worker
**Payload** (JSON UTF-8, dienkripsi `web-push`; target ≤ 1 KB, batas keras push service ±4 KB):
```json
{ "v": 1, "kind": "trx.single", "title": "💰 Transaksi masuk Rp45.000", "body": "QRIS · 3 item · Kasir Rina\n14.32 WIB · #JUS1-K01-261030-0123", "tag": "trx-<transaction_id>", "url": "/transaksi?date_from=2026-10-30&date_to=2026-10-30", "ts": "2026-10-30T07:32:10Z" }
```
- Teks **final** = tabel A.3 desain DEAR-100. Renderer di satu file `notifications/messages.ts` dengan unit test per `kind`. Nomor transaksi memakai `transactions.number` lengkap (desain memakai contoh `#TRX-0123`). Jam di zona `outlets.timezone` dengan label zona (WIB/WITA/WIT).
- `tag`: `trx-{transaction_id}`, `batch-{entity_id}`, `void-{void_request_id}` (requested dan approved memakai tag yang sama: status terbaru menggantikan yang lama), `test-{subscription_id}`.
- `url` (path relatif, harus diawali `/` tunggal) — menyesuaikan rute dashboard yang **sudah ada**, karena `/transaksi/{id}` dan `/persetujuan` di desain belum ada:
  | kind | url |
  |---|---|
  | `trx.single`, `trx.offline`, `void.approved` | `/transaksi?date_from=D&date_to=D` (D = tanggal transaksi di zona gerai) |
  | `trx.batch` | `/transaksi` |
  | `void.requested` | `/void` |
  | `test` | `/pengaturan/notifikasi` |
  Bila nanti ada halaman detail transaksi, cukup ubah renderer.
- Dilarang di payload: `customer_label`, PIN, token, alasan void, referensi pembayaran, id internal selain di `tag`/`url`.

**Service Worker** (`apps/dashboard/public/sw.js`, disajikan sebagai `/sw.js` → scope `/` seluruh dashboard; JS biasa, tidak di-bundle Vite):
- Hanya `install` (`skipWaiting`), `activate` (`clients.claim`), `push`, `notificationclick`. **Tidak** ada handler `fetch` dan tidak meng-cache aset (deploy Pages tidak boleh tertahan cache SW).
- `push`: parse JSON (gagal parse → notifikasi umum "Kelola Kasir"/"Ada aktivitas baru"), `event.waitUntil(registration.showNotification(title, { body, tag, renotify: false, requireInteraction: false, silent: false, icon: '/icons/notif-192.png', badge: '/icons/notif-badge-96.png', data: { url } }))`. Selalu menampilkan notifikasi (Chrome mewajibkan `userVisibleOnly`).
- `notificationclick`: tutup notifikasi; validasi `data.url` (harus path same-origin, diawali `/` dan bukan `//`, selain itu pakai `/`); cari `clients.matchAll({ type: 'window', includeUncontrolled: true })` dengan origin yang sama → `focus()` lalu `postMessage({ type: 'navigate', url })` (dashboard menavigasi lewat router tanpa reload); bila tidak ada tab → `clients.openWindow(url)`.
- Tidak ada handler `pushsubscriptionchange` (SW tidak punya token owner). Gantinya **rekonsiliasi di dashboard**: setiap kali owner login dan `Notification.permission === 'granted'`, dashboard memanggil `getSubscription()`; bila ada → `POST …/subscriptions` (upsert, sekaligus memperbarui `last_seen_at`); bila id di `localStorage` tidak ada lagi di server/`expired` → tampilan "Daftarkan ulang browser ini" (desain §B.8).
- `subscribe` memakai `userVisibleOnly: true` dan `applicationServerKey` dari `GET …/config`.

**Cloudflare Pages:**
- `_headers`: tambah blok `/sw.js` dengan `Cache-Control: no-cache` (browser memeriksa versi SW baru setiap navigasi) dan `Content-Type: text/javascript; charset=utf-8`. Tidak perlu `Service-Worker-Allowed` karena file di root.
- Dashboard saat ini **tidak** memasang CSP. Bila CSP ditambahkan kelak, wajib menyertakan `worker-src 'self'`; push tidak butuh `connect-src` tambahan karena pengiriman dari VPS, bukan dari browser.
- Proxy `/v1/*` (ADR-0014) tidak berubah: endpoint baru biasa memakai `Authorization`. Tidak ada webhook masuk.
- Ikon `notif-192.png` dan `notif-badge-96.png` di `apps/dashboard/public/icons/` (desain §A.4).

### 9. Konfigurasi & secret
| Variabel | Wajib | Catatan |
|---|---|---|
| `VAPID_PUBLIC_KEY` | opsional | base64url, 65 byte (P-256 tak terkompresi) |
| `VAPID_PRIVATE_KEY` | opsional | base64url, 32 byte. **Rahasia.** |
| `VAPID_SUBJECT` | opsional | `https://kelola-kasir.pages.dev` (URL, bukan e-mail, supaya tidak ada alamat pribadi di JWT) |

- "Semua atau tidak sama sekali": ketiganya diisi atau ketiganya kosong; set parsial atau format salah → API menolak start (pola `STORAGE_*`, ADR-0015). Public key diverifikasi cocok dengan private key saat start.
- Kosong → fitur mati: `config` mengembalikan `configured: false`, subscribe/test 503, dispatcher tidak jalan. Lokal dan CI berjalan tanpa VAPID; test memakai klien push palsu (injeksi `sendNotification`).
- **Pembuatan kunci tanpa aksi Albert:** workflow manual **Configure Web Push** (`workflow_dispatch`, pola `rotate-db-password.yml`) lewat SSH:
  1. bila `VAPID_PRIVATE_KEY` belum ada di `/opt/kelola-kasir/.env`, membuat pasangan kunci **di VPS** dengan image API (`node -e` + `web-push.generateVAPIDKeys()`), menulis ketiga baris ke `.env` (mode 600);
  2. bila sudah ada, **tidak** mengubah apa pun (idempoten);
  3. `./compose.sh up -d --wait`, lalu cek `/healthz` dan `GET /v1/notifications/push/config` → `configured: true` tanpa mencetak nilai.

  Private key tidak pernah meninggalkan VPS, tidak masuk GitHub secret, dan tidak dicetak ke log. Backup `.env` mengikuti prosedur VPS yang ada (runbook).
- **Rotasi kunci membatalkan semua langganan** (push service menolak JWT dengan kunci lain → semua owner harus mengaktifkan ulang). Jangan rotasi kecuali bocor; langkah rotasi + konsekuensinya ditulis di runbook. Input `rotate: true` di workflow sengaja tidak disediakan di potongan ini.
- `ops/vps/compose.yaml` meneruskan `${VAPID_PUBLIC_KEY:-}`, `${VAPID_PRIVATE_KEY:-}`, `${VAPID_SUBJECT:-}`; `ops/vps/env.example` mendapat entri kosong + komentar.
- Hanya ada satu lingkungan (VPS), jadi satu pasang kunci. Dashboard lokal (`localhost` dianggap secure context) bisa diuji dengan kunci lokal buatan sendiri.

## Alternatif yang ditolak
- **Telegram (ADR-0016):** Albert ingin notifikasi di laptop; butuh bot + HP.
- **Notifikasi hanya saat tab terbuka (polling/SSE + `new Notification()`):** tidak muncul bila tab ditutup; SSE juga menahan koneksi di VPS dan lewat proxy Pages.
- **Firebase Cloud Messaging SDK:** menambah vendor/akun dan SDK di dashboard; Web Push standar sudah memakai FCM di Chrome tanpa akun.
- **Layanan pihak ketiga (OneSignal, dsb.):** data owner keluar ke vendor, tidak perlu.
- **Kirim sinkron di handler transaksi / outbox dalam transaksi DB yang sama:** sama seperti ADR-0016 (latensi kasir; menyentuh internal domain).
- **Prefs per langganan:** toggle di satu browser tidak mengubah browser lain, bertentangan dengan desain.

## Konsekuensi
- (+) Rp0, tanpa vendor/akun baru, tanpa aksi Albert selain klik **Izinkan** saat UAT. APK tidak berubah.
- (+) Kasir tidak pernah menunggu push service. Gagal kirim dicoba ulang otomatis (juga setelah restart) sampai TTL.
- (+) Idempoten di tiga lapis: `created`/`duplicate` domain, unique key `notification_log`, `tag` di layar.
- (−) Notifikasi hanya muncul bila browser berjalan; laptop tidur > 4 jam → notifikasi dibuang (disengaja, dijelaskan di layar §B.2).
- (−) Bergantung pada pengaturan OS (Fokus/Jangan Ganggu, izin notifikasi Chrome di macOS); dijelaskan di layar §B.5 dan dicek di UAT.
- (−) Bisa hilang bila proses API mati tepat di antara commit dan enqueue (milidetik). Diterima.
- (−) Rotasi kunci VAPID = semua browser daftar ulang.
- (−) Safari macOS mendukung Web Push tapi tidak dirancang/diuji khusus di potongan ini.

## Pembagian tugas (stage 2)
Owner tinggal meng-assign. Backend dan Frontend bisa paralel (kontrak sudah di OpenAPI; Frontend memakai mock Prism).

### DEAR-101 — Backend
1. Migrasi `0003_notifications` (aditif) + skema Drizzle sesuai §6.
2. Config `VAPID_*` dengan validasi §9 + test config. Update `compose.yaml`, `env.example`, `docs/ops/runbook.md` (bagian Web Push: workflow, cek, rotasi, troubleshooting).
3. Klien push tipis di atas `web-push` (timeout 5 dtk, error tersanitasi tanpa endpoint/JWT) yang bisa diganti klien palsu di test.
4. `Notifier` (enqueue + renderer `messages.ts`) dan dispatcher §5 + `startNotificationJob` di `server.ts`. Sediakan `notifier.idle()` untuk test.
5. Hook di titik §1 dan batching §2.
6. Tujuh endpoint §7 sesuai `docs/api/openapi.yaml`, termasuk validasi anti-SSRF, rate limit, batas 10 langganan, dan audit.
7. Workflow **Configure Web Push** (§9), lalu jalankan sekali ke VPS setelah merge.

Kriteria penerimaan:
- [ ] `POST /transactions` cash → tepat 1 baris `transaction.paid` per langganan aktif owner. Respons tidak menunggu enqueue (test: klien push palsu yang lambat tidak memperlambat respons).
- [ ] QRIS `pending` → tidak ada. `confirm`/poll → 1. `confirm` ulang dan poll yang berpacu → tetap 1.
- [ ] `sync/push` dengan 3 transaksi `applied` → 3 notifikasi `trx.offline`. Dengan 4 → 1 `trx.batch` dengan total/rincian/kasir benar. Push yang sama diulang → 0 baru.
- [ ] `void.requested` (online + sync) dan `void.approved` (dashboard, `device_pin`, void langsung). Void ditolak → tidak ada.
- [ ] Prefs `transaction: false` / `void: false` dihormati untuk semua browser user itu. Langganan dicabut/`expired` dan user manager tidak menerima.
- [ ] Push service `404`/`410` → langganan `expired` (`revoked_reason = 'gone'`), baris pending lainnya `failed`. `429` menghormati `Retry-After`. Timeout/`5xx` → backoff, terkirim setelah pulih. Lewat TTL → `expired`.
- [ ] Payload sesuai teks A.3 desain (unit test per `kind`, termasuk varian 0 Cash/QRIS, > 2 kasir, zona WITA), ≤ 1 KB, tanpa `customer_label`/PIN/alasan void. Opsi kirim: TTL 14400/60, urgency `high`/`normal`.
- [ ] Endpoint di luar allowlist, `http:`, IP literal, atau kunci dengan panjang salah → `400 INVALID_PUSH_SUBSCRIPTION`; tidak ada request keluar.
- [ ] Upsert endpoint yang sama → 200 id sama; endpoint milik user lain → lama `replaced`, 201 baru. Ke-11 → yang tertua `limit`.
- [ ] Endpoint/JWT/private key tidak muncul di log, `last_error`, audit, respons, atau Sentry (test dengan error klien palsu yang memuat endpoint).
- [ ] Tanpa env VAPID semua test lama lulus; `config` → `configured: false`, subscribe/test 503.
- [ ] Hapus 7 operasi notifikasi dari `tests/contract/pending-operations.txt`; contract test (schemathesis) lulus untuk endpoint baru.

### DEAR-102 — Frontend
1. `public/sw.js` sesuai §8, ikon 192/96 (§A.4 desain), blok `/sw.js` di `public/_headers`.
2. Halaman **Pengaturan → Notifikasi** (`/pengaturan/notifikasi`, hanya owner) sesuai desain DEAR-100 §B, memakai tipe dari `@kelola-kasir/contracts`.
3. Rekonsiliasi langganan saat login (§8) dan listener `message` `navigate` dari SW ke router.

Kriteria penerimaan:
- [ ] SW terdaftar di scope `/`, tanpa handler `fetch`; deploy baru Pages tidak tertahan cache (cek `Cache-Control` `/sw.js` di staging).
- [ ] Izin tidak diminta saat halaman dimuat; hanya setelah klik "Aktifkan notifikasi di browser ini". Izinkan → `POST …/subscriptions` → id disimpan di `localStorage` → notifikasi lokal "✅ Notifikasi aktif" + toast.
- [ ] Semua keadaan §B.8: tidak didukung, default, menunggu izin, `denied` (berubah tanpa reload lewat `permissions.query().onchange`), aktif, "Daftarkan ulang" (langganan hilang/`expired`).
- [ ] Daftar perangkat dengan penanda "Browser ini", Cabut + dialog konfirmasi; mencabut browser ini juga `unsubscribe()` lokal.
- [ ] Toggle prefs `PATCH` optimistic + rollback + toast; terkunci bila belum ada langganan aktif.
- [ ] Kirim notifikasi uji: 200 → pesan sukses; 410 → tampilan "Daftarkan ulang"; 502/429 → pesan galat sesuai desain.
- [ ] `notificationclick`: tab dashboard terbuka → fokus + navigasi ke `data.url`; tidak ada tab → tab baru; `url` asing/`//evil` → `/`.
- [ ] `configured: false` → kartu "Belum tersedia", tanpa tombol aksi.
- [ ] Terang + gelap, desktop + HP; unit test komponen untuk tiap keadaan dan error 503/410/429; unit test logika SW (parse payload, validasi url).

### DEAR-103 — QA (ringkas)
- Aktifkan di Chrome dan Edge (Windows dan/atau macOS), cek daftar perangkat, notifikasi uji, cabut.
- 1 Cash + 1 QRIS online → notifikasi ≤ 30 detik, **tab dashboard ditutup**; klik membuka/memfokus dashboard di halaman yang benar.
- Batch offline 2 dan 5 transaksi (mode pesawat lalu online).
- Void diajukan + disetujui PIN; void ditolak tidak memunculkan notifikasi.
- Sync ulang tidak dobel; toggle prefs mati dihormati.
- Blokir izin di browser → layar Diblokir; reset data situs → "Daftarkan ulang".
- Notifikasi tanpa data pelanggan / alasan void.
- UAT Albert: Pengaturan → Notifikasi → Aktifkan → Izinkan (macOS: izinkan notifikasi Chrome di System Settings).
