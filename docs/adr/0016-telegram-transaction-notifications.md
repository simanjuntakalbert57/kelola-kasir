ADR-0016 — Notifikasi transaksi & void ke Telegram owner (outbox di `notification_log`, dispatcher in-process)

Status: Accepted · Tanggal: 2026-10-30 · Keputusan: Owner (inisiatif DEAR-97, kanal Telegram menunggu konfirmasi Albert di DEAR-98) + Tech Lead · Issue: DEAR-99 · Dasar: [konsep B](../product/concepts/laporan-alert-telegram.md) · Biaya tambahan: Rp0

## Konteks
Owner ingin tahu setiap transaksi yang masuk tanpa membuka dashboard. Konsep B (DEAR-24) memilih Telegram Bot API (gratis) dan pola "event-driven, tanpa worker". Konsep itu masih mengandaikan Render Free. Produksi sekarang satu VPS dengan satu container API (ADR-0012), dan klien hanya memakai `https://kelola-kasir.pages.dev/v1` (ADR-0014).

Potongan pertama hanya mencakup **transaksi lunas** dan **void**. Ringkasan shift dan rekap harian menyusul. Aplikasi kasir (APK) **tidak berubah**.

Batasan:
- Transaksi kasir tidak boleh gagal atau melambat karena Telegram.
- `sync/push` bisa membawa puluhan transaksi sekaligus (maks. 50 mutasi per request). HP owner tidak boleh dibanjiri, dan Telegram membatasi ±1 pesan/detik per chat.
- Retry `sync/push`, polling status QRIS, dan restart API tidak boleh membuat pesan ganda.
- Pesan tidak boleh memuat PIN, token, atau data pelanggan (`customer_label`).

## Keputusan

### 1. Pemicu (event)
| Event | Kapan | Titik di kode | Pesan |
|---|---|---|---|
| `transaction.paid` | Transaksi berubah menjadi `paid` | Cash online: `POST /transactions` saat `created && status = 'paid'`. QRIS: `PaymentService.confirm` / `get` (poll provider) / webhook pembayaran, saat `markPaid` benar-benar mengubah status. Cash offline: `sync/push`, lihat §2. | 1 pesan per transaksi |
| `transaction.batch` | > 3 `transaction.create` berstatus `applied` dalam 1 `sync/push` | `POST /sync/push`, setelah `pushMutations` selesai | 1 pesan ringkasan |
| `void.requested` | Void diajukan kasir (`created = true`), online atau dari outbox | `requestVoid` (route + `sync/push`) | ⚠️ 1 pesan |
| `void.decided` | Void disetujui/ditolak, termasuk PIN owner di HP kasir dan void langsung oleh owner | `decideVoid`, `voidDirectly` | ⚠️ 1 pesan |

- Transaksi `pending` (QRIS belum dibayar), `cancelled`, dan kedaluwarsa **tidak** dikirim.
- Replay (`created = false`, `duplicate`, `markPaid` pada payment yang sudah `paid`) tidak memicu apa pun.
- `void.decided` **tidak** dikirim ke kanal milik user yang mengambil keputusan itu sendiri (owner yang menyetujui dari dashboard tidak perlu diberi tahu tindakannya sendiri). Kanal user lain di outlet yang sama tetap menerima. Persetujuan lewat PIN owner di HP kasir (`device_pin`) **selalu** dikirim, karena siapa pun yang tahu PIN bisa melakukannya.
- `entity_id` = `transactions.id` untuk `transaction.paid`, `void_requests.id` untuk `void.*`, dan **id transaksi terkecil** dalam batch untuk `transaction.batch`.

### 2. Batching `sync/push`
- Route `sync/push` mengumpulkan hasil `transaction.create` yang `applied` (bukan `duplicate`/`rejected`).
- **≤ 3** transaksi → masing-masing `transaction.paid` dengan label "dari mode offline".
- **> 3** transaksi → satu `transaction.batch`: jumlah, total, rincian Cash/QRIS, rentang jam, nama kasir, label "dari mode offline". Transaksi di dalam batch **tidak** dikirim lagi satu per satu.
- Retry `sync/push` setelah timeout mengembalikan `duplicate`, jadi tidak ada event baru. Unique key di §4 menjadi pengaman kedua.
- Antrean offline > 50 mutasi terkirim dalam beberapa request, jadi bisa menghasilkan beberapa ringkasan. Ini diterima karena tetap jauh lebih sedikit daripada satu pesan per transaksi.
- `void_request.create` dari outbox tidak dirangkum. Void jarang terjadi dan perlu perhatian.

### 3. Pengiriman: setelah commit, tidak di jalur respons
- Modul baru `apps/api/src/modules/notifications`. `AppContext` mendapat `notifier: Notifier`.
- Handler memanggil `notifier.onTransactionPaid(id, { source })`, `onSyncApplied(...)`, `onVoidRequested(...)`, atau `onVoidDecided(...)` **setelah** `db.transaction(...)` selesai, **tanpa `await`**. Respons ke kasir tidak menunggu query notifikasi maupun Telegram.
- `Notifier` tidak pernah melempar error ke pemanggil. Error dicatat di log (+ Sentry) dan transaksi tetap sukses.
- Langkah enqueue: (1) cari kanal aktif outlet yang prefs-nya menyala untuk event itu, (2) muat data dan render teks pesan, (3) `INSERT … ON CONFLICT DO NOTHING` ke `notification_log` (`status = 'pending'`), (4) `kick()` dispatcher.
- Kanal tidak ada / tidak aktif / bot belum dikonfigurasi → tidak ada baris, tidak ada biaya.
- Panggilan Telegram memakai `AbortSignal.timeout(5000)`. Webhook link/unlink membalas langsung lewat body respons webhook (method `sendMessage` di respons), jadi tidak perlu panggilan keluar tambahan.

### 4. Idempotensi
- `notification_log` UNIQUE `(event, entity_id, channel_id)`.
- `transaction.paid` dari jalur online dan dari poll QRIS yang berpacu untuk transaksi yang sama berakhir di satu baris.
- Kanal yang diputus lalu dihubungkan lagi mendapat `channel_id` baru. Event lama tidak dikirim ulang karena sudah lewat.

### 5. Retry: dispatcher in-process, tanpa worker terpisah
**Pilihan:** loop di dalam proses API, pola yang sama dengan `startExpiryJob` QRIS di `server.ts`. Fungsinya `startNotificationJob(app.notifier, app.log)`, dihentikan saat `SIGTERM`.

- **Kapan jalan:** `kick()` langsung setelah enqueue (target ≤ 30 detik, praktiknya < 2 detik), plus interval **30 detik** sebagai jaring pengaman setelah restart atau gagal kirim.
- **Single-flight:** paling banyak satu putaran berjalan sekaligus. Kalau `kick()` datang saat putaran berjalan, cukup set flag "jalan lagi".
- **Satu putaran:** `SELECT … WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED` (aman walau suatu saat ada 2 instance). Pesan dikirim berurutan, minimal **1,1 detik antar pesan ke chat yang sama** dan maksimal ±20 pesan/detik total.
- **Hasil kirim:**
  - Sukses → `sent`, isi `sent_at` dan `telegram_message_id`.
  - `429` → `next_attempt_at = now + retry_after`. Tidak dihitung sebagai percobaan gagal.
  - Timeout, error jaringan, `5xx` → `attempts += 1`, backoff **30 dtk → 2 mnt → 10 mnt → 30 mnt → 2 jam**. Setelah 6 percobaan → `failed`.
  - `403` (bot diblokir) atau `400 chat not found` → `failed`, dan kanal ditandai `blocked_at`. Pesan berikutnya tidak di-enqueue sampai owner menghubungkan ulang.
- **Basi:** baris `pending` yang lebih tua dari **24 jam** → `expired`, tanpa dikirim. Ini mencegah banjir pesan lama setelah gangguan panjang.
- `last_error` hanya berisi `error_code` + `description` dari Telegram atau nama error (maks. 300 karakter). **URL request tidak pernah dicatat, karena berisi token bot.**

**Kenapa bukan alternatif lain:**
- *Retry saat request berikutnya*: malam hari tidak ada request, jadi pesan yang gagal pukul 21.59 baru terkirim besok pagi.
- *Worker/container terpisah atau pg-boss/Redis*: menambah komponen di VPS 1 vCPU untuk volume ±ratusan pesan/hari.
- *Cron GitHub Actions*: resolusi menit dan bergantung pada Actions. Di VPS proses API sudah selalu hidup.

### 6. Data (migrasi aditif `0003_notifications`)
`notification_channels`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK default random | |
| `outlet_id` | uuid FK `outlets` | |
| `user_id` | uuid FK `users` | owner/manager pemilik kanal |
| `type` | text, CHECK `IN ('telegram')` | `whatsapp` menyusul (berbayar, perlu persetujuan) |
| `chat_id` | bigint null | diisi saat verifikasi; id chat Telegram muat di 53 bit |
| `chat_label` | text null | `@username` atau nama depan, hanya untuk tampilan dashboard |
| `prefs` | jsonb NOT NULL default `{"transaction": true, "void": true}` | |
| `verified_at` | timestamptz null | null = menunggu kode dipakai |
| `blocked_at` | timestamptz null | bot diblokir / chat hilang |
| `link_code_hash` | text null | SHA-256 kode sekali pakai |
| `link_code_expires_at` | timestamptz null | +10 menit |
| `created_at`, `updated_at` | timestamptz | |

Indeks: UNIQUE `(outlet_id, user_id, type)`, UNIQUE `link_code_hash` WHERE NOT NULL, `(outlet_id)` WHERE `verified_at IS NOT NULL`.

`notification_log`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK default random | |
| `outlet_id` | uuid FK `outlets` | |
| `channel_id` | uuid FK `notification_channels` **ON DELETE CASCADE** | |
| `event` | text, CHECK `IN ('transaction.paid','transaction.batch','void.requested','void.decided','channel.test')` | |
| `entity_id` | uuid | lihat §1; untuk `channel.test`, UUID acak |
| `body` | text | teks final, dirender saat enqueue (tanpa `parse_mode`, jadi tidak perlu escape) |
| `status` | text, CHECK `IN ('pending','sent','failed','expired')` default `pending` | |
| `attempts` | int default 0 | |
| `next_attempt_at` | timestamptz default now() | |
| `last_error` | text null | ≤ 300 karakter, tanpa URL/token |
| `telegram_message_id` | bigint null | |
| `created_at`, `sent_at` | timestamptz | |

Indeks: UNIQUE `(event, entity_id, channel_id)`, `(next_attempt_at)` WHERE `status = 'pending'`. Retensi: baris `sent`/`expired`/`failed` > 30 hari dihapus oleh dispatcher sekali per hari.

### 7. API (kontrak di `docs/api/openapi.yaml`, tag `notifications`)
| Endpoint | Auth | Fungsi |
|---|---|---|
| `GET /notifications/telegram` | owner | Status kanal user ini: `not_linked`, `pending`, `active`, atau `blocked`, plus `configured`, `prefs`, `chat_label`, `linked_at` |
| `POST /notifications/telegram/link` | owner | Membuat/mengganti kode sekali pakai (10 menit) → `deep_link` `https://t.me/<bot>?start=<kode>`. Kode lama tidak berlaku. Maks. 5 kali per 10 menit per user. Kanal yang sudah `active` tetap aktif sampai kode baru dipakai. |
| `PATCH /notifications/telegram` | owner | Ubah `prefs` (`transaction`, `void`) |
| `DELETE /notifications/telegram` | owner | Putuskan: hapus kanal (log ikut terhapus), kirim pesan "notifikasi dimatikan" best-effort. Idempoten (204). |
| `POST /notifications/telegram/test` | owner | Enqueue pesan uji (`channel.test`), 202. Maks. 1 kali per 10 detik. |
| `POST /integrations/telegram/webhook` | header `X-Telegram-Bot-Api-Secret-Token` | Update dari Telegram, lihat di bawah |

**Kode link:** 24 byte acak, base64url (32 karakter, masuk batas parameter `start` Telegram ≤ 64). Yang disimpan hanya SHA-256. Sekali pakai, kedaluwarsa 10 menit. Kode mentah hanya muncul di respons `link`.

**Webhook:**
- Header dibandingkan dengan `timingSafeEqual`. Salah atau tidak ada → 401. Bot belum dikonfigurasi → 404.
- Update lain selalu dijawab **200** supaya Telegram tidak mengulang terus.
- Hanya chat `private` yang diproses:
  - `/start <kode>` valid → isi `chat_id`, `chat_label`, `verified_at`; kosongkan kode dan `blocked_at`; balas "berhasil terhubung ke <nama gerai>".
  - Kode salah/kedaluwarsa/terpakai → balas "kode tidak berlaku, buat kode baru di dashboard".
  - `/start` tanpa kode → petunjuk singkat.
  - `/stop` → hapus semua kanal dengan `chat_id` itu dan balas konfirmasi.
- `my_chat_member` dengan status `kicked` → `blocked_at = now()`.
- Balasan dikirim sebagai body respons webhook: `{"method":"sendMessage","chat_id":…,"text":…}`.

**Pendaftaran webhook:** saat start, bila Telegram dikonfigurasi, API memanggil `setWebhook` dengan:
- `url = ${API_PUBLIC_BASE_URL}/v1/integrations/telegram/webhook` (URL Pages, ADR-0014)
- `secret_token`
- `allowed_updates = ["message","my_chat_member"]`

Bila gagal, cukup dicatat di log (best-effort); API tetap start. `getMe` dipanggil sekali dan di-cache untuk mendapatkan username bot. **Proxy Pages harus meneruskan header `x-telegram-bot-api-secret-token`** (tambahan ke `FORWARDED_HEADERS`, ADR-0014).

**Audit:** `notification.channel_linked`, `notification.channel_unlinked`, `notification.prefs_updated`. Isinya tanpa kode, token, atau `chat_id` mentah.

### 8. Isi pesan
Teks final mengikuti dokumen desain DEAR-100 (`docs/design/`). Data yang **boleh** dipakai:
- nama gerai
- nomor transaksi
- total
- metode (Cash/QRIS)
- jumlah item
- nama kasir (`employees.name`)
- jam WIB (`paid_at`)
- label "dari mode offline" / "setelah shift ditutup"
- alasan void (dipotong 100 karakter)
- untuk batch: jumlah, total, rincian Cash/QRIS, jam pertama–terakhir

**Dilarang:** `customer_label`, PIN, token, id internal selain nomor transaksi.

Contoh sementara dari DEAR-97: `💰 Transaksi masuk Rp45.000 · QRIS · 3 item · Kasir Rina · 14.32 WIB · #JUS1-K01-261030-0123`. Renderer berada di satu file (`notifications/messages.ts`) dengan unit test per jenis pesan, supaya copy dari desain mudah diganti.

### 9. Konfigurasi & secret
| Variabel | Wajib | Catatan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | opsional | dari @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | opsional | 32–256 karakter `[A-Za-z0-9_-]`, dibuat di VPS (`openssl rand -hex 32`) |

- "Semua atau tidak sama sekali": keduanya diisi, atau keduanya kosong. Bila diisi, `API_PUBLIC_BASE_URL` juga wajib. Set parsial → API menolak start (pola `STORAGE_*`, ADR-0015).
- Kosong → fitur mati: `GET` mengembalikan `configured: false`, `link`/`test` mengembalikan `503 NOTIFICATIONS_NOT_CONFIGURED`, webhook 404, dispatcher tidak jalan.
- `ops/vps/compose.yaml` meneruskan `${TELEGRAM_BOT_TOKEN:-}` dan `${TELEGRAM_WEBHOOK_SECRET:-}`. `ops/vps/env.example` mendapat entri kosong dengan komentar.
- Nilai secret masuk ke VPS lewat workflow manual **Configure Telegram** (`workflow_dispatch`, pola `rotate-db-password.yml`):
  1. membaca secret GitHub `TELEGRAM_BOT_TOKEN`;
  2. menulis/mengganti baris itu di `/opt/kelola-kasir/.env` lewat SSH (nilai dikirim lewat stdin, tidak lewat argumen perintah);
  3. membuat `TELEGRAM_WEBHOOK_SECRET` di VPS bila belum ada;
  4. menjalankan `./compose.sh up -d --wait`, lalu mengecek `/healthz`.

  Nilai secret tidak pernah dicetak ke log. Jalan cadangan: edit `.env` lewat SSH sesuai runbook.
- Hanya ada satu lingkungan (VPS = produksi, `docs/ops/deploy.md`), jadi hanya ada satu bot. Lokal dan CI tanpa token, dengan test memakai klien Telegram palsu.

## Alternatif yang ditolak
- **Kirim sinkron di handler transaksi:** menambah latensi 100–5000 ms ke kasir dan menggagalkan transaksi kalau Telegram bermasalah.
- **Enqueue di dalam transaksi DB yang sama (outbox transaksional penuh):** jaminannya paling kuat, tapi harus menyentuh internal `createTransaction`/`markPaid`/`requestVoid` dan menambah query ke setiap transaksi. Risiko yang tersisa dengan pilihan ini, yaitu proses mati tepat di antara commit dan enqueue, sangat kecil dan hanya menghilangkan satu notifikasi, bukan data penjualan.
- **Polling `getUpdates` sebagai ganti webhook:** perlu loop long-poll terus-menerus. Webhook lewat proxy Pages gratis dan hanya terpicu saat owner berinteraksi dengan bot.
- **Webhook langsung ke `sslip.io`:** terikat IP VPS (lihat ADR-0014). Lewat Pages, URL-nya stabil.
- **WhatsApp Cloud API:** berbayar per pesan dan butuh verifikasi Meta, jadi di luar lingkup.

## Konsekuensi
- (+) Rp0. Tanpa container atau vendor baru. APK tidak berubah.
- (+) Kasir tidak pernah menunggu Telegram. Gagal kirim tercatat dan dicoba ulang otomatis, termasuk setelah restart.
- (+) Idempoten di dua lapis: `created`/`duplicate` dari domain dan unique key di `notification_log`.
- (−) Notifikasi bisa hilang bila proses API mati tepat setelah commit dan sebelum enqueue (milidetik). Diterima.
- (−) Bergantung pada proxy Pages untuk webhook: link/unlink butuh Pages sehat. Pengiriman pesan tidak bergantung pada Pages, karena VPS memanggil `api.telegram.org` langsung.
- (−) Satu bot per lingkungan. Bila nanti ada staging terpisah, staging butuh bot sendiri karena satu bot hanya bisa punya satu webhook.

## Pembagian tugas (stage 2)
Owner tinggal meng-assign. Urutan: Backend dulu (kontrak sudah ada di OpenAPI, jadi Frontend bisa mulai paralel dengan mock).

### DEAR-101 — Backend
1. Migrasi `0003_notifications` (aditif) + skema Drizzle sesuai §6.
2. Config `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` dengan validasi §9 + test config. Update `compose.yaml`, `env.example`, dan `docs/ops/runbook.md` (bagian Telegram + troubleshooting).
3. Klien Telegram tipis (`sendMessage`, `setWebhook`, `getMe`) dengan timeout 5 detik. Error disanitasi (tanpa URL/token).
4. `Notifier` (enqueue + render) dan dispatcher (§5) + `startNotificationJob` di `server.ts`. Sediakan `notifier.idle()` untuk test.
5. Hook di titik §1 dan batching §2.
6. Endpoint §7 sesuai `docs/api/openapi.yaml`, termasuk webhook, rate limit, dan audit.
7. Workflow **Configure Telegram** (§9).

Kriteria penerimaan:
- [ ] `POST /transactions` cash → tepat 1 baris `transaction.paid` per kanal aktif. Respons tidak menunggu enqueue (test: klien Telegram palsu yang lambat tidak memperlambat respons).
- [ ] QRIS `pending` → tidak ada pesan. `confirm`/poll → 1 pesan. `confirm` ulang dan poll yang berpacu → tetap 1.
- [ ] `sync/push` dengan 3 transaksi `applied` → 3 pesan berlabel offline. Dengan 4 → 1 `transaction.batch` yang total/rinciannya benar. Push yang sama diulang → 0 pesan baru.
- [ ] `void.requested` (online + sync) dan `void.decided` (dashboard, `device_pin`, void langsung). Keputusan dari dashboard tidak dikirim ke kanal user yang memutuskan.
- [ ] Prefs `transaction: false` / `void: false` dihormati. Kanal `pending`/`blocked` tidak menerima.
- [ ] Telegram gagal (timeout/5xx) → transaksi tetap 201, baris `pending` dengan backoff, dan terkirim setelah Telegram pulih. `429` menghormati `retry_after`. `403` → kanal `blocked`. Baris > 24 jam → `expired`.
- [ ] Jarak antar pesan ke chat yang sama ≥ 1,1 detik (test dengan jam palsu).
- [ ] Webhook: secret salah → 401. `/start <kode>` valid → kanal aktif. Kode kedaluwarsa/terpakai → ditolak. `/stop` → kanal terhapus.
- [ ] Unit test renderer: tidak ada `customer_label`, PIN, atau token di teks.
- [ ] Token tidak muncul di log, `last_error`, atau Sentry (test: error dari klien palsu yang berisi URL).
- [ ] Tanpa env Telegram, semua test lama tetap lulus dan endpoint mengembalikan `configured: false` / 503.
- [ ] Respons sesuai `docs/api/openapi.yaml` (contracts tidak berubah tanpa update spec).
- [ ] Hapus 6 operasi notifikasi dari `tests/contract/pending-operations.txt` sehingga contract test (schemathesis) ikut menguji endpoint baru, dan test itu lulus.

### DEAR-102 — Frontend
1. Halaman **Pengaturan → Notifikasi** sesuai desain DEAR-100, memakai tipe dari `@kelola-kasir/contracts`.
2. Proxy Pages: tambahkan `x-telegram-bot-api-secret-token` ke `FORWARDED_HEADERS` di `apps/dashboard/src/proxy/apiProxy.ts` + test di `apiProxy.test.ts`.

Kriteria penerimaan:
- [ ] Status `not_linked` → tombol "Hubungkan Telegram": `POST …/link`, lalu tampil deep link + QR (`deep_link`) + hitung mundur ke `expires_at`. Halaman polling `GET` tiap 3 detik selama kode berlaku, lalu berpindah ke `active` tanpa reload.
- [ ] `configured: false` → kartu "Belum disiapkan" tanpa tombol aksi.
- [ ] `active`: tampil `chat_label`, toggle Transaksi & Void (`PATCH`, optimistic + rollback bila error), tombol "Kirim pesan uji" (202 → toast; 429 → pesan tunggu), tombol "Putuskan" dengan konfirmasi (`DELETE`).
- [ ] `blocked`: penjelasan + tombol "Hubungkan ulang".
- [ ] Terang + gelap, mobile + desktop. Teks dalam Bahasa Indonesia.
- [ ] Test proxy: header secret Telegram diteruskan, header lain yang tidak dikenal tetap dibuang.
- [ ] Unit test komponen untuk empat status dan error 503/429.

### DEAR-103 — QA (ringkas)
- Link/unlink/blokir bot.
- 1 Cash + 1 QRIS online (≤ 30 detik).
- Batch offline 2 dan 5 transaksi (mode pesawat lalu online).
- Void diajukan + disetujui PIN.
- Sync ulang tidak dobel.
- Matikan internet VPS sebentar → pesan menyusul.
- Pesan tanpa data pelanggan.
