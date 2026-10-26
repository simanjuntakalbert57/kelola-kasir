Technical Design Document — Kelola Kasir (Toko Jus) · MVP v1.1

Status: v1.2 (v1.1 disetujui owner, dengan perubahan dari DEAR-6; v1.2 = hosting free tier, DEAR-21) · Penyusun: Tech Lead · Tanggal: 2026-10-26 · Sumber: PRD Kelola Kasir v1 (DEAR-3 / DEAR-4), desain final DEAR-5

### Perubahan v1 → v1.1

| # | Keputusan | Dampak di dokumen ini |
|---|---|---|
| 1 | Tidak ada varian/opsi produk (ukuran, gula, es, topping). Satu produk = satu harga. | Tabel `option_groups`, `options`, `product_option_groups`, `transaction_item_options` dihapus. `products.base_price` → `products.price`. Item transaksi = produk + qty + snapshot harga. Task M-7 dan F-5 dihapus, B-5 tanpa opsi. |
| 2 | Kasir = HP Android portrait (360–430 px). Tablet tidak didukung di MVP. | D-2 final. Layout kasir satu kolom (desain DEAR-5). |
| 3 | Cetak struk thermal Bluetooth ESC/POS 58 mm = **Must**. | P-08 naik ke Must. Bagian §2.6 baru. M-11 jadi Must, termasuk layar Printer (K-12). |
| 4 | QRIS statis + konfirmasi manual lewat `PaymentProvider`. | D-1 final (sudah sesuai v1). |
| 5 | Status `cancelled` ditambahkan (Q-1). | Q-1 ditutup. |
| 6 | Tutup shift boleh saat offline, dengan peringatan keras dan sinkron belakangan (Q-3). | §2.5, mutasi `shift.close` di outbox, penanda `after_shift_close`. |
| 7 | Satu shift aktif per gerai. Pegawai lain bisa login di shift yang sama, dan setiap transaksi dicatat atas nama kasirnya. Serah terima = tutup lalu buka shift (Q-4). | §2.5, unique index shift terbuka per outlet, `ShiftSummary.by_employee`. Buka shift wajib online (R-8). |
| 8 | Header/footer struk diatur owner di Pengaturan toko. | `outlet_settings.receipt_header` dan `receipt_footer`. |

### Perubahan v1.1 → v1.2 (DEAR-21, Q-5)

| # | Keputusan | Dampak di dokumen ini |
|---|---|---|
| 1 | Hosting mulai dari free tier: API di Render Free, Postgres di Neon Free, dashboard di Cloudflare Pages, foto + backup di R2 (ADR-0011 menggantikan ADR-0005). Biaya US$0/bulan. | §0, §2.1, §3.2, §6, §7 (R-7, R-9–R-11 baru, Q-5 ditutup), B-1, B-9, B-14, F-1. |
| 2 | Dashboard memanggil API same-origin lewat proxy `/v1/*` (Cloudflare Pages Functions). Kebijakan cookie refresh tetap `SameSite=Strict`. | §2.3, ADR-0004, `servers` OpenAPI. |
| 3 | Kedaluwarsa QRIS dievaluasi lazy (tanpa worker). Backup harian dijalankan GitHub Actions terjadwal. | §2.1, §5.3, §6. |
| 4 | Domain = subdomain gratis. APK dipasang langsung (sideload) dengan signed release. Printer sudah dimiliki owner. | §6. |

## 0. Ringkasan

Kelola Kasir terdiri dari tiga komponen dalam satu monorepo TypeScript:

| Komponen | Teknologi | Pengguna |
|---|---|---|
| `apps/api` | Node.js 24 LTS + Fastify + Drizzle ORM + PostgreSQL 16 | Semua klien |
| `apps/kasir` | React Native (Expo, dev build) + SQLite lokal, offline-first | Pegawai (HP Android portrait) |
| `apps/dashboard` | React + Vite SPA + TanStack Query + Tailwind | Owner (web responsif) |
| `packages/contracts` | Skema Zod + tipe yang di-generate dari OpenAPI | Dipakai bersama |

Hosting (ADR-0011, Q-5 diputuskan owner 2026-10-26): **free tier**. API di Render Free (`kelola-kasir-api.onrender.com`), PostgreSQL di Neon Free, dashboard di Cloudflare Pages (`kelola-kasir.pages.dev`) dengan proxy `/v1` ke API, foto + backup di Cloudflare R2. Biaya **US$0/bulan**, tanpa kartu kredit. Jalur upgrade tanpa ubah kode: Render Starter ±US$7/bulan, Neon Launch (bayar per pemakaian), atau kembali ke Railway (ADR-0005).

Keputusan desain kunci:
1. **Uang = integer Rupiah** (`BIGINT`), tanpa desimal di seluruh lapisan (DB, API, aplikasi).
2. **Snapshot harga**: nama dan harga produk disalin ke `transaction_items` saat transaksi dibuat. Produk tidak punya varian/opsi.
3. **ID dibuat di klien (UUIDv7)** + nomor transaksi yang unik per perangkat → transaksi cash bisa dibuat offline dan disinkron secara idempoten.
4. **Perangkat terdaftar + PIN pegawai**: perangkat di-pair oleh owner; pegawai login dengan PIN 6 digit hanya di perangkat terdaftar.
5. **Abstraksi `PaymentProvider`**: QRIS statis (konfirmasi manual) di MVP; QRIS dinamis (Midtrans/Xendit) cukup menambah implementasi provider tanpa mengubah alur kasir.
6. **Satu shift terbuka per gerai**, dipakai bersama semua perangkat; setiap transaksi mencatat pegawai pembuatnya.
7. **Cetak struk ESC/POS 58 mm dari aplikasi kasir** (Bluetooth), diformat dari data lokal sehingga tetap jalan saat offline.

Dokumen terkait:
- ADR: `docs/adr/0001`–`0011`
- API contract: `docs/api/openapi.yaml` (OpenAPI 3.1, v0.2.0-draft)
- Desain: `docs/design/` (DEAR-5, tema gelap, kasir HP portrait)

## 1. Keputusan Owner (D-1/D-2/D-3) — final

| ID | Keputusan | Catatan |
|---|---|---|
| D-1 QRIS | **QRIS statis** + konfirmasi manual pegawai, lewat `PaymentProvider`. | Pindah ke QRIS dinamis (Midtrans/Xendit) cukup menambah provider + webhook; aplikasi kasir tidak berubah (layar QRIS sudah mendukung mode `auto`). |
| D-2 Perangkat | **HP Android portrait** (lebar 360–430 px). Tablet tidak didukung di MVP. | iPad/tablet bisa ditambah nanti tanpa ganti stack. |
| D-3 Printer | **Cetak struk thermal Bluetooth ESC/POS 58 mm = Must**, ditambah struk digital (share WhatsApp). | Butuh 1 unit printer uji 58 mm ESC/POS (desain memakai contoh RPP02N). Lihat §2.6. |
| Q-1 | Status `cancelled` untuk QRIS `pending` yang dibatalkan/kedaluwarsa. | §3.3. |
| Q-3 | Tutup shift boleh offline, dengan peringatan keras, lalu sinkron belakangan. | §2.5. |
| Q-4 | Satu shift aktif per gerai; pegawai lain login di shift yang sama; transaksi dicatat atas nama kasirnya; serah terima = tutup lalu buka shift. | §2.5. |

Asumsi lain:
- A-1: 1 gerai di MVP, 1–2 perangkat kasir aktif per gerai, ≤ 500 transaksi/hari.
- A-2: Zona waktu bisnis = `Asia/Jakarta` (WIB). Semua timestamp disimpan `timestamptz` (UTC), "hari bisnis" dihitung di WIB.
- A-3: Tidak ada pajak/PPN dan diskon di MVP (O-11 fase 2), tetapi kolom `discount_amount`/`tax_amount` disiapkan bernilai 0.
- A-4: Satu owner per gerai di MVP; model `users` + `outlet_members` sudah mendukung banyak akun owner/manajer.

## 2. Arsitektur Sistem

### 2.1 Diagram komponen

```mermaid
flowchart LR
  subgraph Gerai["Gerai (HP Android)"]
    K["Aplikasi Kasir<br/>React Native/Expo"]
    DB[("SQLite lokal<br/>katalog + outbox")]
    P["Printer thermal BT 58 mm<br/>ESC/POS"]
    K <--> DB
    K -. ESC/POS .-> P
  end

  subgraph Owner["Owner (browser)"]
    W["Dashboard Owner<br/>React + Vite SPA"]
  end

  subgraph Cloud["Cloud"]
    PX["Cloudflare Pages Function<br/>proxy /v1 (same-origin)"]
    API["API Server<br/>Fastify (Node 24)<br/>Render Free"]
    PG[("PostgreSQL 16<br/>Neon Free")]
    R2[("Cloudflare R2<br/>foto produk, backup")]
    JOB["GitHub Actions terjadwal<br/>backup harian"]
  end

  PGW["Payment Gateway<br/>Midtrans/Xendit (fase 2)"]

  K -- "HTTPS /v1 (device + employee token)" --> API
  W -- "HTTPS /v1 same-origin (owner token, cookie refresh)" --> PX
  PX --> API
  API --> PG
  API -- presigned URL --> R2
  W -- upload foto (presigned PUT) --> R2
  K -- unduh foto (CDN) --> R2
  JOB -- "pg_dump (direct URL)" --> PG
  JOB -- "dump terenkripsi age" --> R2
  API -. "create charge" .-> PGW
  PGW -. "webhook paid" .-> API
```

Prinsip:
- **API adalah sumber kebenaran.** Aplikasi kasir menyimpan salinan katalog dan antrean transaksi (outbox) untuk kecepatan dan mode offline.
- **Tanpa worker terpisah** (Render Free tidak punya cron): QRIS `pending` yang lewat `expires_at` ditandai `cancelled` secara lazy saat transaksi/payment dibaca atau diubah dan saat `sync/pull`. Backup dijalankan GitHub Actions (§6).
- **Modular monolith** di `apps/api` (modul: `auth`, `devices`, `catalog`, `shifts`, `transactions`, `payments`, `voids`, `reports`, `settings`, `audit`, `sync`). Tidak perlu microservice di skala ini.
- **Real-time owner dashboard** cukup dengan polling 30 detik (TanStack Query `refetchInterval`) di MVP; SSE bisa ditambah nanti tanpa ubah kontrak.
- **Sinkron produk ke kasir < 1 menit** (PRD §6): kasir menarik `/v1/sync/pull` setiap 30 detik saat online + saat app kembali ke foreground.

### 2.2 Struktur repo

```
kelola-kasir/
├── apps/
│   ├── api/            # Fastify, Drizzle, migrasi SQL, tests (Vitest + Testcontainers)
│   ├── kasir/          # Expo (React Native), expo-sqlite, Drizzle (SQLite)
│   └── dashboard/      # React + Vite, TanStack Router/Query, Tailwind
├── packages/
│   ├── contracts/      # tipe hasil generate dari openapi.yaml (+ skema Zod)
│   └── money/          # helper Rupiah (format, parse, sum) — integer only
├── docs/
│   ├── tdd.md
│   ├── adr/
│   ├── api/openapi.yaml
│   └── design/         # desain final DEAR-5 (HTML/CSS/PNG)
├── tsconfig.base.json, eslint.config.mjs, .prettierrc.json   # konfigurasi bersama di root
└── .github/workflows/  # CI: lint, typecheck, test, openapi lint, gitleaks
```

`pnpm mock` menjalankan mock API (Prism) dari `docs/api/openapi.yaml` di `http://localhost:4010` agar Mobile/Frontend bisa mulai sebelum API jadi.

Tooling: pnpm workspaces + Turborepo, TypeScript strict, ESLint + Prettier, Vitest, Playwright (dashboard e2e), Maestro (kasir e2e, opsional).

### 2.3 Auth & role

```mermaid
sequenceDiagram
  autonumber
  participant O as Owner (Dashboard)
  participant A as API
  participant K as Kasir (perangkat)
  participant E as Pegawai

  O->>A: POST /v1/devices (nama perangkat)
  A-->>O: pairing_code 8 karakter (berlaku 10 menit)
  K->>A: POST /v1/devices/pair {pairing_code}
  A-->>K: device_token (disimpan di Android Keystore)
  E->>K: input PIN 6 digit
  K->>A: POST /v1/auth/pin-login {employee_id, pin} + device_token
  A-->>K: employee access token (JWT, 12 jam, role=cashier)
```

| Aktor | Kredensial | Token | Catatan |
|---|---|---|---|
| Owner | email + password (argon2id) | Access JWT 15 menit + refresh token rotasi (cookie `kk_refresh`: `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`, tanpa `Domain`; dashboard memanggil API same-origin lewat proxy `/v1`, ADR-0011) | Lockout 10 menit setelah 5 gagal. Opsional 2FA fase 2. |
| Perangkat | pairing code sekali pakai | `device_token` opaque 256-bit, di DB disimpan sebagai hash SHA-256 | Owner bisa cabut (revoke) perangkat dari dashboard → semua sesi pegawai di perangkat itu gugur. |
| Pegawai | PIN 6 digit (argon2id) | Access JWT 12 jam, klaim `sub=employee_id, did=device_id, oid=outlet_id, role=cashier` | Hanya valid bila dikirim bersama `X-Device-Token` yang aktif. 5 PIN salah → kunci pegawai 5 menit di perangkat tsb. PIN unik per outlet. |
| Owner di perangkat (approve void) | PIN owner 6 digit | Tidak membuat sesi; hanya dipakai di `POST /v1/void-requests/{id}/approve-with-pin` | Diaudit. |

Otorisasi role-based (RBAC) di API, bukan di klien:

| Kemampuan | cashier | owner |
|---|---|---|
| Buka/tutup shift gerai, buat transaksi, konfirmasi QRIS, cetak/cetak ulang struk | ✅ | — |
| Lihat transaksi | hanya shift berjalan/hari ini di outletnya | semua |
| Ajukan void | ✅ | ✅ (langsung void) |
| Approve/tolak void | — | ✅ |
| Tandai produk habis | ✅ | ✅ |
| Dashboard omzet, laporan, ekspor | ❌ (PRD §5) | ✅ |
| CRUD produk/kategori, pegawai, perangkat, pengaturan (termasuk header/footer struk) | — | ✅ |

**Role `manager`** (kolom `outlet_members.role ∈ owner|manager`): untuk MVP API memperlakukan `manager` **sama persis dengan `owner`** (semua guard `owner` menerima keduanya, token memuat klaim `role`). Role ini dipertahankan di skema dan token supaya pemisahan hak bisa ditambahkan tanpa migrasi, tetapi owner belum memakainya dan belum ada UI/endpoint untuk membuat anggota `manager` (hanya skrip `owner:create` yang membuat anggota `owner`). Bila kelak dibedakan (mis. manager tanpa akses pengaturan toko atau PIN owner), perubahan dilakukan di guard `owner` di `apps/api/src/plugins/auth.ts` dan RBAC di atas diperbarui.

**Login PIN saat offline** (P-13, Should): server mengirim daftar `{employee_id, pin_hash}` (argon2id, parameter berat) pegawai aktif outlet tersebut ke perangkat terdaftar, disimpan terenkripsi (expo-secure-store). Saat offline, kasir memverifikasi PIN lokal dan bekerja dengan "sesi offline"; semua transaksi tetap ditandatangani `device_id` + `employee_id` dan divalidasi ulang server saat sinkron. Risiko: hash PIN 6 digit bisa di-brute-force bila perangkat dibobol → mitigasi: hanya di perangkat terdaftar, revoke perangkat menghapus cache saat online berikutnya, dan PIN pegawai berbeda dari PIN owner. Ditandai sebagai keputusan sadar (ADR-0006).

### 2.4 Sinkronisasi offline

Ringkas (detail di ADR-0003 & ADR-0008):

- **Tarik (pull) katalog & konfigurasi**: `GET /v1/sync/pull?cursor=<opaque>` mengembalikan perubahan kategori, produk, pegawai (tanpa data sensitif selain pin_hash), status habis, pengaturan toko (termasuk header/footer struk), dan shift yang sedang terbuka (`current_shift`) sejak cursor, termasuk tombstone (`deleted_at`). Cursor = `max(updated_seq)` dari sequence Postgres global.
- **Dorong (push) transaksi**: transaksi, item, pembayaran cash, tutup shift, permintaan void ditulis dulu ke tabel `outbox` di SQLite, lalu dikirim batch ke `POST /v1/sync/push`. Setiap mutasi punya `id` UUIDv7 dari klien → **idempoten** (kirim ulang aman; server membalas `applied`/`duplicate`/`rejected` per item).
- **Nomor transaksi** dibuat di klien: `{OUTLET}-{DEV}-{YYMMDD}-{seq4}`, mis. `JUS1-K01-261026-0042`. `DEV` = kode perangkat 3 karakter dari server saat pairing, `seq` reset harian per perangkat → unik tanpa koordinasi server. Constraint unik `(outlet_id, number)` di DB.
- **Konflik**: transaksi bersifat append-only, jadi konflik hanya mungkin pada (1) harga berubah saat kasir offline → server **menerima** snapshot klien dan menandai `price_mismatch=true` + audit log (bukan menolak, agar penjualan nyata tidak hilang); (2) produk dinonaktifkan → sama, diterima + ditandai; (3) shift sudah ditutup di server → lewat `/sync/push` tetap **diterima** dan, bila `client_created_at` > `closed_at`, ditandai `after_shift_close` (dilaporkan terpisah di ringkasan shift); lewat `POST /transactions` online ditolak `SHIFT_CLOSED` agar pegawai membuka shift baru.
- **QRIS hanya online.** Tombol QRIS dinonaktifkan saat offline (desain: perlu state disabled + pesan).
- **Catatan implementasi pull** (B-10): cursor = `updated_seq` tertinggi yang sudah dikirim; klien meng-upsert per `id`, jadi pengiriman ulang tidak berbahaya. Karena `nextval` tidak selalu berurutan dengan commit, baris yang di-commit terlambat oleh transaksi yang lebih lambat dapat terlewat; untuk MVP (satu owner, edit jarang dan berurutan) risiko ini diterima, dan klien tetap melakukan pull penuh tanpa cursor saat pertama kali login atau setelah reinstall.
- **Catatan implementasi push** (B-10): `void_request.create` (id mutasi = id void request, payload `{transaction_id, reason}`) diproses oleh B-13: `applied`/`duplicate`, atau `rejected` dengan kode (`NOT_FOUND`, `TRANSACTION_NOT_VOIDABLE`, `EMPLOYEE_UNKNOWN`). `transaction.create` dengan id yang sama tetapi nomor/total berbeda ditolak `ID_REUSED` (bukan `duplicate`); transaksi sync dari pegawai nonaktif diterima dan diberi audit `sync.inactive_employee`. Transaksi `sync` dengan produk habis/nonaktif/harga berbeda diterima dan dicatat (`sync.product_unavailable`, `sync.price_mismatch`); transaksi yang dibuat sebelum `closed_at` tetapi tiba setelah shift ditutup membuat server menghitung ulang total shift (audit `shift.totals_recomputed`).
- **Waktu**: simpan `client_created_at` (jam perangkat) dan `server_received_at`. Laporan memakai `client_created_at`; selisih > 10 menit ditandai `clock_skew` di audit.
- Online-first untuk layar owner: dashboard tidak punya mode offline.

### 2.5 Shift: satu shift aktif per gerai

- **Satu shift `open` per outlet**, ditegakkan di DB dengan unique partial index `shifts (outlet_id) WHERE status = 'open'`. Semua perangkat terdaftar di gerai memakai shift yang sama.
- **Buka shift wajib online** (`POST /v1/shifts`). Hanya dengan begitu aturan satu shift bisa ditegakkan tanpa konflik. Bila sudah ada shift terbuka, API membalas `409 SHIFT_ALREADY_OPEN` dan aplikasi langsung bergabung ke shift itu. Perangkat lain mengetahui shift aktif dari `GET /v1/shifts/current` atau `current_shift` di `/sync/pull`. Konsekuensinya ada di R-8.
- **Pegawai lain** login PIN di perangkat mana pun dan bertransaksi di shift yang sama. `transactions.employee_id` = pegawai yang login saat transaksi dibuat. Ringkasan shift memuat rincian per kasir (`by_employee`).
- **Serah terima** = pegawai A menutup shift (hitung kas), lalu pegawai B membuka shift baru dengan modal kas.
- **Tutup shift offline** diizinkan setelah peringatan keras ("N transaksi belum tersinkron; ringkasan bisa berubah setelah sinkron"). Aplikasi menyimpan mutasi `shift.close` di outbox dengan `closed_offline=true`. Saat diterapkan, server menghitung ulang ringkasan dari semua transaksi shift dengan `client_created_at ≤ closed_at`. Selama perangkat masih offline, perangkat itu menganggap shift sudah tutup dan meminta buka shift baru saat online.
- Transaksi offline dari perangkat lain yang tiba setelah shift ditutup tidak dibuang (prinsip "penjualan nyata tidak hilang"). Transaksi itu diterima, ditandai `after_shift_close` bila dibuat setelah `closed_at`, dan dilaporkan di `late_transaction_count`/`late_cash_amount` agar owner bisa menjelaskan selisih kas.
- Tutup shift ditolak `409 PENDING_QRIS_EXISTS` bila masih ada QRIS `pending`. Pegawai harus konfirmasi atau batalkan dulu.

### 2.6 Cetak struk (thermal Bluetooth ESC/POS 58 mm)

- **Di mana**: aplikasi kasir (React Native dev build) memakai modul native Bluetooth Classic (SPP) untuk printer ESC/POS 58 mm (32 karakter per baris, font A). Library dipilih di M-11 setelah uji dengan printer nyata; antarmuka dibungkus `ReceiptPrinter` agar bisa diganti.
- **Layar Printer (K-12)**: pindai perangkat terpasang/terdekat, hubungkan, cetak tes. Alamat MAC printer terakhir disimpan lokal per perangkat dan dihubungkan ulang otomatis saat app dibuka atau sebelum mencetak. Izin Android 12+: `BLUETOOTH_CONNECT` dan `BLUETOOTH_SCAN`.
- **Toggle "Cetak struk"** di layar Cash dan QRIS. Default aktif, diingat per perangkat. Bila aktif, struk dicetak otomatis setelah transaksi `paid` (cash: setelah "Uang Pas"/"Bayar", jadi alur tetap 3 tap; QRIS: setelah konfirmasi). Pencetakan berjalan di latar belakang dan **tidak memblokir** penyimpanan transaksi.
- **Gagal cetak**: transaksi tetap tersimpan. Layar sukses menampilkan banner "Printer tidak tersambung" dengan "Coba lagi"/"Lewati". **Cetak ulang** tersedia di layar sukses dan detail riwayat; salinan ulang diberi tanda `CETAK ULANG`.
- **Isi struk**: nama toko, alamat, telepon, `receipt_header` (owner), nomor transaksi, waktu (WIB), nama kasir, item (nama × qty, harga satuan, subtotal baris), total, metode bayar, tunai & kembalian (cash), status, `receipt_footer` (owner). Struk diformat di klien dari SQLite + pengaturan yang tersinkron, sehingga **bisa dicetak saat offline**. `GET /v1/transactions/{id}/receipt` dipakai untuk struk digital, cetak ulang dari perangkat lain, dan pratinjau di dashboard.
- **Formatter** ESC/POS (teks → byte, termasuk pemotongan nama panjang dan perataan kolom harga) ditulis sebagai fungsi murni di `packages/receipt` (atau di `apps/kasir` sampai dipakai ulang) supaya bisa di-unit-test tanpa printer.

## 3. Data Model

### 3.1 ERD

```mermaid
erDiagram
  OUTLETS ||--o{ OUTLET_MEMBERS : has
  USERS ||--o{ OUTLET_MEMBERS : "is member"
  OUTLETS ||--|| OUTLET_SETTINGS : has
  OUTLETS ||--o{ EMPLOYEES : employs
  OUTLETS ||--o{ DEVICES : registers
  OUTLETS ||--o{ CATEGORIES : has
  OUTLETS ||--o{ PRODUCTS : sells
  CATEGORIES ||--o{ PRODUCTS : groups
  OUTLETS ||--o{ SHIFTS : has
  EMPLOYEES ||--o{ SHIFTS : opens
  DEVICES ||--o{ SHIFTS : "opened on"
  DEVICES ||--o{ TRANSACTIONS : "created on"
  SHIFTS ||--o{ TRANSACTIONS : contains
  EMPLOYEES ||--o{ TRANSACTIONS : creates
  TRANSACTIONS ||--o{ TRANSACTION_ITEMS : has
  TRANSACTIONS ||--o{ PAYMENTS : "paid by"
  TRANSACTIONS ||--o{ VOID_REQUESTS : "may have"
  OUTLETS ||--o{ AUDIT_LOGS : records

  OUTLETS {
    uuid id PK
    string code "mis. JUS1"
    string name
    string timezone "Asia/Jakarta"
    timestamptz created_at
  }
  USERS {
    uuid id PK
    string email UK
    string password_hash
    string name
    string owner_pin_hash
    bool is_active
  }
  OUTLET_MEMBERS {
    uuid outlet_id FK
    uuid user_id FK
    string role "owner|manager"
  }
  OUTLET_SETTINGS {
    uuid outlet_id PK
    string display_name
    string address
    string phone
    string logo_url
    string receipt_header "baris tambahan di bawah nama toko"
    string receipt_footer "ucapan penutup"
    string qris_mode "static|dynamic"
    string qris_static_payload "EMVCo string"
    string qris_static_image_url
    string qris_merchant_name
  }
  EMPLOYEES {
    uuid id PK
    uuid outlet_id FK
    string name
    string pin_hash
    bool is_active
    timestamptz locked_until
  }
  DEVICES {
    uuid id PK
    uuid outlet_id FK
    string code "K01"
    string name
    string token_hash
    timestamptz paired_at
    timestamptz revoked_at
    timestamptz last_seen_at
  }
  CATEGORIES {
    uuid id PK
    uuid outlet_id FK
    string name
    int sort_order
    timestamptz deleted_at
  }
  PRODUCTS {
    uuid id PK
    uuid outlet_id FK
    uuid category_id FK
    string name
    string image_url
    bigint price "Rupiah, satu harga per produk"
    bool is_active
    bool is_sold_out
    int sort_order
    timestamptz deleted_at
  }
  SHIFTS {
    uuid id PK "UUIDv7 dari klien"
    uuid outlet_id FK "unik bila status=open"
    uuid opened_device_id FK
    uuid closed_device_id FK
    uuid opened_by FK
    uuid closed_by FK
    string status "open|closed"
    bigint opening_cash
    bigint expected_cash
    bigint actual_cash
    bigint cash_difference
    bigint total_cash_sales
    bigint total_qris_sales
    int transaction_count
    timestamptz opened_at
    timestamptz closed_at
    string closing_note
    bool closed_offline
  }
  TRANSACTIONS {
    uuid id PK "UUIDv7 dari klien"
    uuid outlet_id FK
    uuid shift_id FK
    uuid device_id FK
    uuid employee_id FK "kasir yang login"
    string number UK "JUS1-K01-261026-0042"
    string status "pending|paid|void_requested|voided|cancelled"
    string payment_method "cash|qris"
    string customer_label
    bigint subtotal
    bigint discount_amount "0 di MVP"
    bigint tax_amount "0 di MVP"
    bigint total
    bool price_mismatch
    bool after_shift_close
    timestamptz client_created_at
    timestamptz server_received_at
    timestamptz paid_at
    timestamptz voided_at
  }
  TRANSACTION_ITEMS {
    uuid id PK
    uuid transaction_id FK
    uuid product_id FK "referensi, boleh null bila dihapus"
    string product_name "snapshot"
    bigint unit_price "snapshot harga produk"
    int quantity
    bigint line_total
    string note
  }
  PAYMENTS {
    uuid id PK
    uuid transaction_id FK
    string method "cash|qris"
    string provider "cash|qris_static|midtrans|xendit"
    string status "pending|paid|expired|failed|cancelled"
    bigint amount
    bigint cash_tendered
    bigint cash_change
    string provider_ref
    string qr_payload
    timestamptz expires_at
    string confirmation_mode "manual|auto"
    uuid confirmed_by FK "employee, mode manual"
    timestamptz paid_at
    jsonb provider_raw
  }
  VOID_REQUESTS {
    uuid id PK
    uuid transaction_id FK
    uuid requested_by FK "employee"
    string reason
    string status "pending|approved|rejected"
    uuid decided_by FK "user/owner"
    string decision_channel "dashboard|device_pin"
    string decision_note
    timestamptz requested_at
    timestamptz decided_at
  }
  AUDIT_LOGS {
    uuid id PK
    uuid outlet_id FK
    string actor_type "user|employee|device|system"
    uuid actor_id
    string action "transaction.void, product.price_changed, ..."
    string entity_type
    uuid entity_id
    jsonb before
    jsonb after
    jsonb meta "ip, device_id, reason"
    timestamptz created_at
  }
```

Tabel pendukung (tidak digambar): `refresh_tokens`, `device_pairing_codes`, `idempotency_keys` (untuk endpoint online non-sync), `sync_seq` (kolom `updated_seq BIGINT` di tabel katalog yang diisi dari sequence global).

### 3.2 Aturan data (memenuhi PRD §5)

| Aturan PRD | Implementasi |
|---|---|
| Nomor unik, waktu, pegawai, shift, item, total, metode, status | Kolom `NOT NULL` di `transactions`; unik `(outlet_id, number)`; FK ke `shifts`, `employees`. |
| Status `paid`, `pending`, `void_requested`, `voided` | `CHECK (status IN (...))` + state machine di service (§3.3), ditambah status `cancelled` untuk QRIS `pending` yang dibatalkan/kedaluwarsa (keputusan Q-1). `cancelled` tidak masuk total mana pun. |
| `paid` tidak bisa diedit, hanya void + jejak audit | Tidak ada endpoint `PATCH /transactions`. Trigger DB menolak `UPDATE` pada kolom finansial bila `status <> 'pending'`. Void hanya via `void_requests` + `audit_logs`. |
| Snapshot harga | `transaction_items.product_name` dan `unit_price` disalin saat transaksi dibuat; tidak ada join ke harga produk untuk laporan. |
| Integer Rupiah | Semua kolom uang `BIGINT NOT NULL CHECK (>= 0)` (kecuali `cash_difference` boleh negatif). JSON API memakai integer; klien format dengan `packages/money`. |
| Pegawai tidak bisa lihat omzet keseluruhan | Endpoint `/v1/reports/*` & `/v1/dashboard/*` hanya untuk role owner; endpoint kasir `/v1/transactions` di-scope ke perangkat + shift/hari ini. Ringkasan tutup shift hanya untuk shift milik pegawai itu. |
| Audit log void & perubahan harga | `audit_logs` ditulis dalam transaksi DB yang sama untuk: `transaction.void_requested/approved/rejected`, `product.price_changed`, `product.deleted`, `shift.closed_offline`, `employee.pin_reset`, `device.revoked`, `payment.qris_manual_confirmed`, `sync.price_mismatch`. Tabel append-only (role DB aplikasi tidak punya `UPDATE/DELETE`). |
| Backup harian | `pg_dump` harian terenkripsi (age) ke R2 oleh GitHub Actions terjadwal, retensi 30 hari, ditambah PITR Neon 6 jam (ADR-0011). |

Perhitungan (dihitung di klien untuk UX, **divalidasi ulang di server**):
- `unit_price` = snapshot `products.price`
- `line_total = unit_price × quantity`
- `subtotal = Σ line_total`; `total = subtotal − discount_amount + tax_amount`
- Cash: `cash_change = cash_tendered − total`, wajib `cash_tendered ≥ total`.
- Tutup shift: `expected_cash = opening_cash + Σ total (cash, status paid|void_requested, client_created_at ≤ closed_at)`; `cash_difference = actual_cash − expected_cash`. Transaksi `voided` dan `cancelled` dikeluarkan dari total. Transaksi `void_requested` tetap dihitung sampai diputuskan (dicatat terpisah di ringkasan). Transaksi `after_shift_close` dilaporkan terpisah (`late_*`).

### 3.3 State machine transaksi

```mermaid
stateDiagram-v2
  [*] --> paid: cash (bayar langsung)
  [*] --> pending: qris (QR ditampilkan)
  pending --> paid: konfirmasi manual (statis) / webhook (dinamis)
  pending --> cancelled: dibatalkan kasir / kedaluwarsa 15 menit
  paid --> void_requested: pegawai ajukan void + alasan
  void_requested --> voided: owner approve (dashboard / PIN owner)
  void_requested --> paid: owner tolak
  paid --> voided: owner void langsung (dashboard)
  voided --> [*]
  cancelled --> [*]
```

### 3.4 Indeks & performa

- `transactions (outlet_id, client_created_at DESC)`, `(shift_id)`, `(outlet_id, status)`, `(outlet_id, employee_id, client_created_at)`.
- `products (outlet_id, updated_seq)`, sama untuk tabel katalog lain (pull sync).
- `UNIQUE shifts (outlet_id) WHERE status = 'open'` → satu shift aktif per gerai (§2.5).
- Dashboard O-02 memakai query agregat langsung ke `transactions`/`transaction_items` (volume ≤ 500 trx/hari → < 200k baris/tahun, cukup tanpa tabel agregat). Bila nanti lambat: materialized view `daily_sales` di-refresh tiap 5 menit.
- Layar kasir < 300 ms per tap: semua interaksi katalog/keranjang di SQLite lokal & state memori; tidak ada panggilan jaringan di jalur tap.

## 4. API Contract

Kontrak lengkap: `docs/api/openapi.yaml` (OpenAPI 3.1). Konvensi:
- Base path `/v1`, JSON, `snake_case`, uang integer Rupiah, waktu ISO-8601 UTC.
- Error: `application/problem+json` dengan `code` stabil (mis. `SHIFT_NOT_OPEN`, `SHIFT_ALREADY_OPEN`, `SHIFT_CLOSED`, `INVALID_PIN`, `PIN_LOCKED`, `CASH_INSUFFICIENT`, `PRODUCT_UNAVAILABLE`, `TRANSACTION_NOT_EDITABLE`, `QRIS_OFFLINE_UNSUPPORTED`).
- Pagination: cursor (`?cursor=&limit=`), default 50, max 200.
- Idempoten: semua `POST` pembuatan dari kasir memakai `id` klien; endpoint online lain menerima header `Idempotency-Key`.
- Security scheme: `ownerAuth` (Bearer JWT owner), `employeeAuth` (Bearer JWT pegawai + header `X-Device-Token`), `deviceAuth` (hanya `X-Device-Token`).

### 4.1 Pemetaan fitur Must → endpoint → tabel

| Fitur | Endpoint | Tabel utama |
|---|---|---|
| P-01 Login PIN di perangkat terdaftar | `POST /devices` (owner), `POST /devices/pair`, `GET /devices/me/employees`, `POST /auth/pin-login`, `POST /auth/pin-logout` | devices, device_pairing_codes, employees |
| P-02 Buka shift (satu per gerai, wajib online) | `POST /shifts`, `GET /shifts/current` | shifts |
| P-03 Katalog | `GET /catalog` (snapshot penuh), `GET /sync/pull` | categories, products |
| ~~P-04 Varian/opsi~~ | Dihapus (keputusan v1.1 #1) | — |
| P-05 Keranjang | lokal di aplikasi; dikirim saat checkout lewat `POST /transactions` (`items[].note`, `customer_label`) | transactions, transaction_items |
| P-06 Bayar cash | `POST /transactions` dengan `payment.method=cash` (online) atau `POST /sync/push` (offline) | transactions, payments |
| P-07 Bayar QRIS | `POST /transactions` dengan `payment.method=qris` → `GET /payments/{id}` (poll) → `POST /payments/{id}/confirm` (statis) / webhook (dinamis); `POST /payments/{id}/cancel` | payments, transactions |
| P-08 Struk digital + cetak thermal (Must) | `GET /transactions/{id}/receipt`; cetak ESC/POS di klien dari data lokal + `GET /settings`/`/sync/pull` | transactions, outlet_settings |
| P-09 Riwayat transaksi | `GET /transactions?scope=shift/today&payment_method=`, `GET /transactions/{id}` | transactions, transaction_items, payments |
| P-12 Tutup shift (boleh offline) | `GET /shifts/{id}/summary`, `POST /shifts/{id}/close`, atau mutasi `shift.close` di `POST /sync/push` | shifts, transactions |
| O-01 Login owner | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` | users, refresh_tokens |
| O-02 Dashboard | `GET /dashboard/summary?date_from=&date_to=`, `GET /dashboard/sales-series?granularity=hour/day`, `GET /dashboard/top-products` | transactions, transaction_items |
| O-03 Daftar transaksi + ekspor | `GET /transactions` (filter tanggal, pegawai, metode, status), `GET /transactions/{id}`, `GET /transactions/export?format=csv/xlsx` | transactions, transaction_items, payments |
| O-04 Kelola produk | `GET/POST /products`, `GET/PATCH/DELETE /products/{id}`, `POST /uploads` (presigned, `purpose=product_image`) | products, audit_logs |
| O-05 Kategori | `GET/POST /categories`, `PATCH/DELETE /categories/{id}` (tanpa varian/add-on) | categories |
| O-06 Kelola pegawai | `GET/POST /employees`, `PATCH /employees/{id}` (nonaktifkan), `POST /employees/{id}/reset-pin` | employees, audit_logs |
| O-07 Riwayat shift & rekonsiliasi | `GET /shifts?date_from=&date_to=&employee_id=`, `GET /shifts/{id}/summary` | shifts |
| O-10 Pengaturan toko + QRIS + header/footer struk | `GET/PATCH /settings` (`receipt_header`, `receipt_footer`), `POST /uploads` (`purpose=logo/qris_image`) | outlet_settings |
| Perangkat (pendukung P-01) | `GET /devices`, `POST /devices/{id}/revoke` | devices |

Fitur Should yang sudah disiapkan kontraknya (boleh diimplementasikan setelah Must): P-10 `POST /transactions/{id}/void-requests`, P-11 `PATCH /products/{id}/availability`, P-13 `POST /sync/push`, O-08 `GET /void-requests`, `POST /void-requests/{id}/approve/reject`, `POST /void-requests/{id}/approve-with-pin`, O-09 `GET /reports/sales?group_by=product/employee/payment_method/day`.

## 5. Desain Pembayaran QRIS

### 5.1 Abstraksi provider

```ts
// apps/api/src/modules/payments/provider.ts
export interface PaymentProvider {
  readonly name: 'qris_static' | 'midtrans' | 'xendit';
  readonly confirmationMode: 'manual' | 'auto';
  createCharge(input: {
    paymentId: string; transactionNumber: string; amount: number; expiresInSec: number;
  }): Promise<{ qrPayload: string; qrImageUrl?: string; providerRef?: string; expiresAt: Date }>;
  getStatus(payment: Payment): Promise<'pending' | 'paid' | 'expired' | 'failed'>;
  cancel(payment: Payment): Promise<void>;
  parseWebhook?(headers: Record<string, string>, rawBody: Buffer): Promise<WebhookEvent>; // hanya mode auto
}
```

Provider dipilih per outlet dari `outlet_settings.qris_mode` (`static` → `StaticQrisProvider`, `dynamic` → `MidtransQrisProvider`/`XenditQrisProvider`). Kredensial gateway disimpan di environment variable Render, **tidak** di DB atau repo.

### 5.2 Alur (sama untuk kedua mode dari sisi kasir)

```mermaid
sequenceDiagram
  autonumber
  participant K as Kasir
  participant A as API
  participant P as PaymentProvider
  participant G as Gateway (mode dinamis)

  K->>A: POST /v1/transactions {payment: {method: qris}}
  A->>P: createCharge(amount)
  alt statis
    P-->>A: qr_payload = QRIS toko (+ nominal bila didukung), mode=manual
  else dinamis
    P->>G: create QRIS charge
    G-->>P: qr_string, ref, expiry
    P-->>A: qr_payload, mode=auto
  end
  A-->>K: transaction(status=pending) + payment{qr_payload, confirmation_mode, expires_at}
  K->>K: tampilkan QR + nominal + hitung mundur
  alt mode manual
    K->>A: POST /v1/payments/{id}/confirm (pegawai sudah cek notifikasi bank)
  else mode auto
    G-->>A: webhook paid (signature diverifikasi)
    K->>A: GET /v1/payments/{id} (poll 2 dtk)
  end
  A-->>K: payment.status=paid, transaction.status=paid
  K->>K: layar sukses + struk
```

Kontrak klien **tidak berubah** antar mode; aplikasi kasir hanya membaca `confirmation_mode`:
- `manual` → tampilkan tombol **"Sudah Dibayar"** (dengan dialog konfirmasi "Pastikan notifikasi dana masuk Rp X sudah diterima") dan tombol **"Batal"**.
- `auto` → tampilkan "Menunggu pembayaran…" + tombol "Batal"; tombol "Cek manual" muncul setelah 60 detik sebagai cadangan (memanggil `GET /payments/{id}` yang memicu `getStatus`).

### 5.3 QRIS statis (MVP)

- Owner mengunggah gambar QRIS toko di Pengaturan (O-10); API mendekode payload EMVCo (`qris_static_payload`) dari gambar atau owner menempelkannya.
- **Opsional (disarankan)**: API membentuk QRIS "statis bernominal" dengan menyisipkan tag 54 (amount) dan menghitung ulang CRC16 di payload statis, sehingga pembeli tidak perlu mengetik nominal → mengurangi salah bayar. Perlu uji dengan 3–4 aplikasi e-wallet/m-banking; jika ada yang menolak, fallback ke QR asli + nominal besar di layar.
- Konfirmasi manual dicatat: `payments.confirmed_by`, audit `payment.qris_manual_confirmed`. Owner melihat di dashboard daftar QRIS yang dikonfirmasi manual per shift untuk dicocokkan dengan mutasi bank (rekonsiliasi QRIS manual — risiko R-2).
- Kedaluwarsa: `pending` > 15 menit → ditandai `cancelled` (payment `expired`) secara lazy saat transaksi/payment disentuh atau saat `sync/pull` (tanpa worker, ADR-0011). Aplikasi kasir tetap menjalankan hitung mundur sendiri.

### 5.4 Migrasi ke QRIS dinamis (fase 2)

1. Owner menyelesaikan verifikasi merchant di gateway (Midtrans Core API QRIS atau Xendit QR Codes).
2. Implementasi `MidtransQrisProvider` + endpoint `POST /v1/webhooks/payments/{provider}` (verifikasi signature, idempoten via `provider_ref`).
3. Ubah `outlet_settings.qris_mode = dynamic` dari dashboard. Tidak ada rilis aplikasi kasir yang diperlukan.

## 6. Keamanan, Observability, Operasional

- HTTPS saja; HSTS di dashboard. Dashboard memanggil API same-origin lewat proxy `/v1`, jadi CORS produksi tidak membuka origin mana pun. Aplikasi kasir native memanggil API langsung.
- Rate limit: login owner 5/menit/IP, PIN login 5 gagal → lock, pairing code 10/jam/IP.
- Validasi input dengan Zod di setiap route; query lewat Drizzle (parametrized).
- Secret hanya via environment variable platform (Render, Cloudflare Pages, GitHub Actions secrets untuk backup); `.env.example` tanpa nilai di repo; CI menjalankan secret scan (gitleaks).
- Logging terstruktur (pino) tanpa PIN/password/token; error tracking Sentry (free tier) untuk API, dashboard, dan kasir.
- Health check `/healthz`; uptime monitor (Better Stack / UptimeRobot free). Monitor dijalankan dengan interval jarang atau hanya saat jam buka, karena ping tiap 5 menit membuat API dan Neon tidak pernah tidur sehingga kuota CU-jam Neon habis (R-10).
- Hosting (ADR-0011): Render Free (API, region Singapore) + Neon Free (Postgres 16, `ap-southeast-1`) + Cloudflare Pages (dashboard + proxy `/v1`) + R2. Koneksi DB: `DATABASE_URL` = URL **pooled** Neon (`-pooler`, driver `pg` tanpa prepared statement bernama) untuk runtime. `DATABASE_URL_DIRECT` = URL **direct** untuk `drizzle-kit migrate` (Render pre-deploy command) dan `pg_dump`.
- Backup: GitHub Actions `schedule` 01:00 WIB (`0 18 * * *` UTC) + `workflow_dispatch`: `pg_dump` (client 16) via URL direct → enkripsi age → R2 `postgres/` (`ops/backup/backup.sh`), retensi 30 hari. Repo publik: dump tidak boleh jadi artifact atau tercetak di log. Uji restore bulanan (task QA/Backend) sekaligus cek umur objek backup terbaru (< 26 jam). Setup: `docs/ops/backup-restore.md`.
- Distribusi aplikasi kasir: APK signed release (EAS Build free tier atau build lokal) yang dipasang langsung (sideload) di HP kasir, tanpa Play Console. Update JS via EAS Update untuk perbaikan cepat. Keystore release disimpan owner di luar repo.

## 7. Risiko & Open Question

| ID | Risiko | Mitigasi |
|---|---|---|
| R-1 | QRIS statis: pegawai salah konfirmasi (klik "Sudah Dibayar" tanpa dana masuk) / fraud. | Dialog konfirmasi, audit per pegawai, laporan QRIS manual per shift untuk dicocokkan owner dengan mutasi bank; rencana pindah ke dinamis (D-1 b). |
| R-2 | Rekonsiliasi QRIS tidak otomatis di MVP → selisih QRIS tak terdeteksi oleh tutup shift (yang hanya menghitung kas). | Ringkasan tutup shift menampilkan total QRIS terpisah; owner cek mutasi; fase 2 dinamis. |
| R-3 | Offline lama → data transaksi hanya di perangkat; perangkat hilang/rusak = data hilang. Tutup shift offline bisa membuat ringkasan berubah setelah sinkron. | Sinkron otomatis tiap 30 dtk; banner "N transaksi belum tersinkron"; tutup shift offline dengan peringatan keras; ringkasan dihitung ulang server dan transaksi telat ditandai `after_shift_close`. |
| R-4 | Jam perangkat salah → laporan per jam keliru. | Simpan `server_received_at`, tandai skew > 10 menit, aplikasi menampilkan peringatan jam. |
| R-5 | Brute-force PIN dari cache offline. | Argon2id berat, cache hanya di perangkat terdaftar, revoke perangkat, opsi mematikan login offline. |
| R-6 | Printer Bluetooth beragam merek; koneksi BT putus-sambung; izin Bluetooth Android 12+. | ESC/POS generik 58 mm, 1 model rekomendasi untuk diuji (mis. RPP02N); auto-reconnect; gagal cetak tidak memblokir transaksi; struk digital sebagai cadangan. |
| R-7 | Kuota free tier berubah atau terlampaui → service disuspend (tanpa kartu tidak ada tagihan, tetapi layanan berhenti). | Batas & tanggal cek dicatat di ADR-0011, dicek ulang tiap kuartal dan sebelum rilis. Jalur upgrade tanpa ubah kode (Render Starter ±US$7/bulan, Neon Launch, atau Railway); keputusan biaya ke Chief of Staff. |
| R-8 | Buka shift wajib online (konsekuensi satu shift per gerai) → bila internet mati sebelum buka toko, kasir tidak bisa mulai berjualan. | Shift biasanya dibuka sekali per hari; HP kasir bisa memakai data seluler sebagai cadangan. Bila sering terjadi, fase 2: buka shift offline "sementara" yang digabung server ke shift aktif. |
| R-9 | **Cold start Render Free ±30–60 detik** pada request pertama setelah 15 menit tanpa trafik (mis. pagi saat buka shift, atau owner membuka dashboard malam hari). | Aplikasi kasir offline-first: transaksi cash, cetak struk, dan login PIN offline tidak menunggu server. Saat buka shift, login PIN online, pairing, dan login dashboard: tampilkan "Menghubungkan ke server…" + spinner, timeout klien ≥ 75 detik, retry otomatis dengan backoff. Kasir boleh memanggil `/healthz` saat app dibuka untuk "membangunkan" API lebih awal. Selama jam buka, polling sync 30 detik menjaga API tetap bangun. Bila mengganggu → Render Starter. |
| R-10 | **Kuota compute Neon 100 CU-jam/bulan** (≈ 13 jam aktif/hari pada 0.25 CU) habis karena polling membuat DB tidak pernah idle 5 menit. | Compute dikunci 0.25 CU. `sync/pull` tanpa perubahan dijawab dari cursor in-memory tanpa query DB. Validasi device token di-cache in-memory (dihapus saat revoke). Polling dashboard berhenti saat tab tidak aktif. Pemakaian dipantau mingguan; > 80% → Neon Launch (±US$0.106/CU-jam). |
| R-11 | **Bandwidth Render 5 GB/bulan**; bila habis tanpa kartu, semua service disuspend sampai akhir bulan. | Gzip respons. Foto/logo tidak pernah lewat API (presigned R2). Ekspor dibatasi rentang tanggal. Perkiraan < 0,5 GB/bulan. Pantau dashboard Render. |

| ID | Pertanyaan | Status |
|---|---|---|
| Q-1 | Status `cancelled` untuk QRIS pending yang batal/kedaluwarsa | **Diputuskan**: ya |
| Q-2 | D-1/D-2/D-3 | **Diputuskan**: lihat §1 |
| Q-3 | Tutup shift saat offline | **Diputuskan**: boleh, dengan peringatan keras, sinkron belakangan |
| Q-4 | Pemakaian shift oleh beberapa pegawai | **Diputuskan**: satu shift aktif per gerai, transaksi atas nama kasirnya, serah terima = tutup lalu buka |
| Q-5 | Persetujuan biaya hosting, domain, Play Console, printer | **Tertutup** (owner, 2026-10-26): mulai dengan free tier (Render + Neon + Cloudflare, ADR-0011), subdomain gratis, APK sideload, printer 58 mm sudah dimiliki owner. Upgrade dinilai setelah ada data pemakaian nyata. |
| Q-6 | Nama repo | **Diputuskan**: `simanjuntakalbert57/kelola-kasir` |

**Dampak ke UI/UX (sudah tercakup di desain final DEAR-5):**
1. Layar QRIS punya dua varian: `manual` (tombol "Sudah Dibayar" + dialog konfirmasi) dan `auto` (menunggu + "Cek manual" setelah 60 dtk), plus hitung mundur 15 menit dan tombol "Batal".
2. State offline: tombol QRIS disabled + pesan; banner jumlah transaksi belum tersinkron; peringatan keras saat tutup shift offline.
3. Alur pairing perangkat: layar "Masukkan kode perangkat" di kasir (sekali) + layar "Tambah perangkat" di dashboard yang menampilkan kode 8 karakter.
4. Login PIN: pilih nama pegawai → keypad PIN; pesan terkunci 5 menit. Bila shift gerai sudah terbuka, pegawai langsung masuk ke katalog (tidak ada layar buka shift).
5. Riwayat transaksi menampilkan badge status `pending/paid/void_requested/voided/cancelled`, nama kasir, dan penanda "belum tersinkron".
6. Tutup shift: ringkasan memisahkan cash, QRIS, transaksi menunggu void, rincian per kasir, dan selisih (bisa negatif, warna merah).
7. Cetak struk: toggle "Cetak struk" di Cash & QRIS, status printer, "Cetak ulang", banner gagal cetak, dan layar Printer (K-12).

## 8. Rencana Breakdown Implementasi

Estimasi kasar dalam hari kerja engineer (d). Prefiks: **B** Backend, **M** Mobile (kasir), **F** Frontend (dashboard), **Q** QA, **T** Tech Lead.

### 8.1 Fondasi
| ID | Task | Est | Bergantung |
|---|---|---|---|
| T-1 | Buat repo monorepo (pnpm + Turborepo), tsconfig/eslint/prettier, `packages/contracts`, `packages/money` | 1d | — |
| T-2 | CI GitHub Actions: lint, typecheck, test, `redocly lint openapi.yaml`, gitleaks; branch protection main | 0.5d | T-1 |
| T-3 | Generate tipe TS dari OpenAPI ke `packages/contracts` (openapi-typescript) + mock server Prism (`pnpm mock`) | 0.5d | T-1 |

### 8.2 Backend
| ID | Task | Est | Bergantung |
|---|---|---|---|
| B-1 | Skeleton Fastify, config, logging, error problem+json, healthz, Drizzle + migrasi awal semua tabel §3; Dockerfile untuk Render, `DATABASE_URL` pooled + `DATABASE_URL_DIRECT` untuk migrasi (ADR-0011), `trustProxy` + IP dari `CF-Connecting-IP` | 2d | T-1 |
| B-2 | Auth owner (login, refresh rotasi, logout, me), argon2id, rate limit | 1.5d | B-1 |
| B-3 | Perangkat: create + pairing code, pair, revoke, device token middleware | 1d | B-2 |
| B-4 | Pegawai CRUD + PIN login/lockout + JWT pegawai + RBAC guard | 1.5d | B-3 |
| B-5 | Katalog: kategori, produk (satu harga, tanpa opsi), upload presigned R2, audit perubahan harga | 1.5d | B-2 |
| B-6 | Pengaturan toko (termasuk header/footer struk) + QRIS statis (upload & decode payload) | 1d | B-5 |
| B-7 | Shift: satu shift terbuka per outlet (unique index), buka, current, summary + rincian per kasir, tutup (online & offline via sync) | 2d | B-4 |
| B-8 | Transaksi: create (validasi harga, snapshot, nomor, cash), list/detail ber-scope role, data struk (`/receipt`), trigger immutability | 2d | B-5, B-7 |
| B-9 | Payments: `PaymentProvider` + `StaticQrisProvider` (+ amount tag 54/CRC), confirm, cancel, expire lazy (tanpa worker) | 2d | B-8, B-6 |
| B-10 | Sync pull (cursor `updated_seq`, tombstone, `current_shift`) + push batch idempoten (termasuk `shift.close`) + penanda price_mismatch/clock_skew/after_shift_close | 2.5d | B-8 |
| B-11 | Dashboard summary, sales series, top products (WIB) | 1.5d | B-8 |
| B-12 | Ekspor CSV/XLSX transaksi (streaming) | 1d | B-8 |
| B-13 | Void request + approve/reject (dashboard & PIN owner) + audit *(Should)* | 1.5d | B-8 |
| B-14 | Backup harian: workflow GitHub Actions terjadwal (`pg_dump` → age → R2 via `ops/backup/backup.sh`, retensi 30 hari) + dokumen restore | 0.5d | B-1 |
| B-15 | Laporan O-09 *(Should)* | 1.5d | B-11 |

### 8.3 Mobile (aplikasi kasir)
| ID | Task | Est | Bergantung |
|---|---|---|---|
| M-1 | Skeleton Expo (dev build Android), navigasi, tema dari design system DEAR-5, client API dari contracts | 1.5d | T-3, DEAR-5 |
| M-2 | SQLite lokal (Drizzle) + repository katalog + sync pull periodik | 2d | M-1, B-10 |
| M-3 | Pairing perangkat + secure storage token | 1d | M-1, B-3 |
| M-4 | Login PIN (online + cache offline) + lock | 1.5d | M-3, B-4 |
| M-5 | Buka shift (online) / gabung shift gerai yang sudah terbuka | 0.5d | M-4, B-7 |
| M-6 | Katalog grid per kategori + pencarian + produk habis disembunyikan | 1.5d | M-2 |
| M-8 | Keranjang (tap kartu = +1, qty, catatan, hapus, label pembeli) + bar bayar + kalkulasi via `packages/money` | 1d | M-6 |
| M-9 | Bayar cash (keypad, nominal cepat, kembalian) + outbox + sync push | 2d | M-8, B-8, B-10 |
| M-10 | Bayar QRIS (render QR, mode manual/auto, countdown, cancel), disabled saat offline | 1.5d | M-8, B-9 |
| M-11 | Cetak struk ESC/POS 58 mm via Bluetooth: layar Printer K-12 (pindai, hubungkan, cetak tes, auto-reconnect), toggle "Cetak struk" di Cash/QRIS, cetak ulang, banner gagal cetak; struk digital + share WhatsApp | 3d | M-9, B-6 |
| M-12 | Riwayat transaksi shift/hari ini + filter + detail + badge belum sinkron | 1.5d | M-9 |
| M-13 | Tutup shift (input kas aktual, ringkasan, selisih), termasuk tutup offline dengan peringatan keras | 1.5d | M-12, B-7, B-10 |
| M-14 | Ajukan void *(Should)*, tandai habis *(Should)* | 1d | M-12, B-13 |

### 8.4 Frontend (dashboard owner)
| ID | Task | Est | Bergantung |
|---|---|---|---|
| F-1 | Skeleton Vite + router + auth (login, refresh, guard) + layout responsif + Pages Function proxy `/v1/*` ke API (ADR-0011) + state "Menghubungkan ke server…" untuk cold start | 1.5d | T-3, B-2, DEAR-5 |
| F-2 | Dashboard ringkasan + grafik per jam/hari + produk terlaris | 2d | F-1, B-11 |
| F-3 | Daftar transaksi + filter + detail + ekspor | 2d | F-1, B-8, B-12 |
| F-4 | Kategori + produk (form, upload foto, status aktif) | 2d | F-1, B-5 |
| F-6 | Pegawai (tambah, nonaktif, reset PIN) + perangkat (pairing code, revoke) | 1.5d | F-1, B-3, B-4 |
| F-7 | Riwayat shift & rekonsiliasi kas (rincian per kasir, transaksi telat) | 1d | F-1, B-7 |
| F-8 | Pengaturan toko (header/footer struk) + upload QRIS statis + pratinjau struk 58 mm | 1d | F-1, B-6 |
| F-9 | Approve/tolak void *(Should)*, laporan *(Should)* | 2d | B-13, B-15 |

### 8.5 QA
| ID | Task | Est | Bergantung |
|---|---|---|---|
| Q-A | Test plan dari PRD + TDD (fungsional, RBAC, offline, uang integer, snapshot harga) | 1.5d | TDD disetujui |
| Q-B | API contract test (schemathesis/Dredd terhadap openapi.yaml) di CI | 1.5d | B-8, T-2 |
| Q-C | E2E dashboard (Playwright): login, produk, transaksi, shift | 2d | F-3, F-4, F-7 |
| Q-D | Uji kasir di HP Android nyata: alur ≤ 4 tap/≤ 15 dtk, offline → online, QRIS manual, tutup shift (online & offline), dua perangkat di satu shift, cetak struk printer 58 mm | 2d | M-11, M-13 |
| Q-E | UAT bersama owner + uji restore backup | 1d | semua Must |

### 8.6 Urutan & jalur kritis

```mermaid
flowchart LR
  T1[T-1 Repo] --> T2[T-2 CI] & T3[T-3 Contracts] & B1[B-1 Skeleton API]
  B1 --> B2[B-2 Auth owner] --> B3[B-3 Device] --> B4[B-4 PIN] --> B7[B-7 Shift]
  B2 --> B5[B-5 Katalog] --> B6[B-6 Settings/QRIS] --> B9[B-9 Payments]
  B5 --> B8[B-8 Transaksi]
  B7 --> B8 --> B9
  B8 --> B10[B-10 Sync] & B11[B-11 Dashboard] & B12[B-12 Ekspor]
  T3 --> M1[M-1 Kasir skeleton] & F1[F-1 Dashboard skeleton]
  B10 --> M2[M-2 SQLite+pull] --> M6[M-6, M-8 Katalog/Keranjang] --> M9[M-9 Cash+outbox] --> M12[M-12 Riwayat] --> M13[M-13 Tutup shift]
  B9 --> M10[M-10 QRIS]
  M9 --> M11[M-11 Cetak struk]
  M6 --> M10
  B11 --> F2[F-2 Dashboard]
  B5 --> F4[F-4 Produk & kategori]
  M13 --> QD[Q-D Uji perangkat] --> QE[Q-E UAT]
  M11 --> QD
```

Jalur kritis: T-1 → B-1 → B-2 → B-3/B-4 → B-7 → B-8 → B-10 → M-2 → M-9 → M-13 → Q-D → Q-E. Dengan 1 orang per peran berjalan paralel, Must selesai **±4–5 minggu** setelah TDD + desain disetujui. Backend sebaiknya mulai B-1..B-5 segera, Mobile/Frontend mulai skeleton dengan mock dari OpenAPI (Prism) agar tidak menunggu.

### 8.7 Definition of Done (semua task)
- Sesuai `openapi.yaml` (perubahan kontrak = PR ke `docs/api` dulu, di-review Tech Lead).
- Unit test untuk logika uang/shift/state machine; integration test endpoint dengan Postgres nyata (Testcontainers); coverage modul `transactions`, `shifts`, `payments`, `sync` ≥ 80%.
- CI hijau; tidak merge ke `main` tanpa review Tech Lead.
- Tidak ada secret di repo/log.
