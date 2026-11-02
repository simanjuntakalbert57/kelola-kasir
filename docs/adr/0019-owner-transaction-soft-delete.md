ADR-0019 — Owner menghapus transaksi: soft delete + Riwayat Hapus + pulihkan

Status: Accepted · Tanggal: 2026-10-30 · Keputusan: Tech Lead (aturan bisnis dari DEAR-121, keputusan owner) · Issue: DEAR-122 (parent DEAR-121) · Implementasi: DEAR-123 (Backend), DEAR-124 (Frontend) · Biaya tambahan: Rp0

## Konteks
Owner ingin bisa menghapus transaksi yang salah atau uji coba dari dashboard. Transaksi itu tidak boleh hilang permanen: harus masuk ke **Riwayat Hapus** (siapa, kapan, alasan) dan bisa **dipulihkan** (DEAR-121). Keputusan owner:
- Soft delete, bukan hapus fisik. Tidak ada migrasi destruktif.
- Hapus/pulihkan dicatat di `audit_logs` (snapshot before/after).
- Berbeda dengan void: void adalah alur pembatalan kasir dengan persetujuan, sedangkan hapus adalah pembersihan catatan oleh owner. Status apa pun boleh dihapus, kecuali `pending` dan `void_requested` yang masih diproses.
- HP kasir yang mengirim ulang transaksi terhapus tidak boleh menghidupkannya. APK tidak berubah.
- Angka tutup shift (uang laci) tidak diubah. Laporan shift menampilkan "N transaksi dihapus (Rp X)".
- Hanya role owner.

Batasan teknis yang sudah ada:
- `transactions` dilindungi trigger: `kk_transactions_no_delete` melarang `DELETE`, dan `kk_transactions_guard` membekukan kolom uang setelah keluar dari `pending` serta menjaga state machine status (TDD §3.3). Kolom baru tidak disentuh trigger itu.
- `guards.owner` juga meloloskan **manager** (`principal.role` = `owner | manager`). Satu-satunya cek owner murni ada di `notifications/routes.ts` (`ownerOnly`).
- Sync push **tidak melakukan upsert**. `createTransaction` (API dan `/sync/push`) hanya `INSERT`; kalau id sudah ada, `replay()` mengembalikan baris lama (`duplicate`) tanpa mengubahnya.
- Nomor transaksi unik per gerai (`transactions_outlet_number_unique`), dan `last_number` perangkat dibaca dari `transactions`.

## Keputusan

### 1. Model data: kolom status hapus + tabel riwayat terpisah
Status saat ini disimpan di kolom `transactions`, sedangkan riwayat disimpan di tabel baru yang append-only.

`transactions` (kolom nullable, migrasi `0004_transaction_soft_delete`):
| Kolom | Tipe | Arti |
|---|---|---|
| `deleted_at` | `timestamptz` null | Waktu dihapus. `NULL` = transaksi aktif. |
| `deleted_by` | `uuid` null → `users.id` | Owner yang menghapus. |
| `delete_reason` | `text` null | Alasan (5–200 karakter setelah trim). |

- Index `transactions_outlet_deleted_idx (outlet_id, deleted_at)` untuk daftar Riwayat Hapus.
- CHECK `transactions_deleted_fields_check`: ketiga kolom terisi bersama atau kosong bersama.
- CHECK `transactions_deleted_status_check`: `deleted_at IS NULL OR status NOT IN ('pending','void_requested')`.

`transaction_deletions` (tabel baru): `id`, `outlet_id`, `transaction_id`, `action` (`delete`|`restore`), `reason` (wajib untuk `delete`; catatan opsional untuk `restore`), `actor_user_id` → `users`, `created_at`. Index `(transaction_id, created_at)` dan `(outlet_id, created_at desc)`.

Trigger (migrasi `0005_transaction_soft_delete_triggers`):
- `transactions_deleted_guard`: selama `deleted_at` terisi, `status` tidak boleh berubah. Ini mencegah void request, konfirmasi pembayaran, atau proses lain yang datang belakangan menggeser transaksi yang tidak dihitung laporan mana pun.
- `transaction_deletions` append-only: `UPDATE`, `DELETE`, dan `TRUNCATE` ditolak, sama seperti `audit_logs`.

**Kenapa tabel riwayat terpisah, bukan kolom + `audit_logs` saja.** Kolom hanya menyimpan keadaan terakhir, sehingga hapus → pulihkan → hapus lagi akan menimpa data penghapusan pertama. `audit_logs` memang lengkap, tetapi isinya JSON generik untuk semua entitas, tanpa FK dan tanpa index per transaksi. Riwayat Hapus dan detail transaksi perlu query yang murah dan bertipe jelas, jadi dipakai tabel sendiri. `audit_logs` tetap diisi dengan snapshot before/after sebagai jejak forensik.

**Kenapa tetap ada kolom di `transactions`.** Lebih dari 20 query perlu tahu apakah sebuah transaksi aktif (§5). Predikat `deleted_at IS NULL` pada tabel yang sama jauh lebih murah dan lebih kecil kemungkinan salahnya daripada `NOT EXISTS` ke tabel riwayat. Kolom dan riwayat selalu ditulis dalam satu transaksi DB.

### 2. Endpoint (detail di `docs/api/openapi.yaml`, tag `transactions`)
| Endpoint | Fungsi |
|---|---|
| `DELETE /v1/transactions/{id}` body `{ reason }` | Soft delete. `200` + `Transaction` (dengan `deleted`). |
| `GET /v1/transactions/deleted` | Riwayat Hapus: transaksi yang **saat ini** terhapus, urut `deleted_at` desc, cursor + `limit`, `date_from`/`date_to` (tanggal bisnis WIB) terhadap `date_field` = `deleted_at` (default) atau `client_created_at`, serta `q`. |
| `POST /v1/transactions/{id}/restore` body `{ note? }` | Pulihkan. `200` + `Transaction` (`deleted` = null). |
| `GET /v1/transactions/{id}` (sudah ada) | Untuk owner, transaksi terhapus tetap bisa dibuka (`deleted` + `deletion_history`). Untuk pegawai → `404`. |

Akses: ketiga endpoint baru hanya untuk **role owner**, yaitu `[guards.owner, ownerRole]` seperti pada `notifications/routes.ts`. Manager, pegawai, dan device mendapat `403 FORBIDDEN`. Gerai diambil dari `principal.outletId`. Transaksi milik gerai lain → `404`.

Alur hapus (satu transaksi DB):
1. Validasi `reason`: trim, lalu panjang 5–200. Kalau tidak memenuhi → `400 VALIDATION_ERROR`.
2. `SELECT … FROM transactions WHERE id = $1 AND outlet_id = $2 FOR UPDATE`. Tidak ditemukan → `404`.
3. Kalau sudah terhapus → `200` dengan keadaan sekarang (idempoten). Alasan baru diabaikan dan tidak ada baris riwayat baru.
4. Kalau `status` adalah `pending` atau `void_requested` → `409 TRANSACTION_NOT_DELETABLE` ("Selesaikan pembayaran / keputusan void dulu").
5. `UPDATE transactions SET deleted_at = now(), deleted_by, delete_reason`, `INSERT transaction_deletions (action='delete')`, lalu `writeAudit` dengan `action = 'transaction.deleted'`, `entityType = 'transaction'`, serta `before`/`after` = snapshot baris (termasuk kolom hapus).

Alur pulihkan sama, tetapi kebalikannya. Transaksi yang tidak sedang terhapus → `200` tanpa efek. Selain itu kolom dikosongkan, ditulis baris `action='restore'` (dengan `reason` = `note`), dan `writeAudit` dengan `action = 'transaction.restored'`. Pemulihan selalu boleh, karena status transaksi beku selama terhapus.

Kode error baru: `TRANSACTION_NOT_DELETABLE` (409).

### 3. Aturan sync dan pengiriman ulang dari HP kasir
- `createTransaction` tetap **insert-only**. Kalau id sudah ada, `replay()` hanya membaca baris dan **tidak pernah** menulis `deleted_at`, `deleted_by`, atau `delete_reason`. Hasilnya `duplicate` (sync) atau `200` replay (API), sehingga APK tidak menganggapnya gagal dan berhenti mengirim ulang.
- Replay dari transaksi terhapus **tidak** memicu notifikasi (sudah begitu, karena `created = false`).
- Aturan untuk masa depan: kalau suatu saat ada `ON CONFLICT … DO UPDATE` pada `transactions`, kolom `deleted_*` **wajib** dikecualikan dari `SET`. Test integrasi DEAR-123 menguncinya: hapus → kirim ulang via `/sync/push` dan `POST /transactions` → tetap terhapus.
- Nomor transaksi yang terhapus **tetap terpakai**. Unique index dan `last_number` (sync pull, pairing ulang) tetap menghitung baris terhapus, sehingga nomor tidak pernah dipakai dua kali.

### 4. Shift
- Shift **terbuka**: transaksi terhapus tidak dihitung dalam penjualan maupun `expected_cash`. Kalau owner menghapus input dobel atau uji coba, uang itu memang tidak ada di laci.
- Shift **tertutup**: angka saat tutup tidak boleh berubah. `computeShiftTotals` hanya mengecualikan transaksi yang dihapus **sebelum** shift ditutup: `t.deleted_at IS NULL OR (cutoff IS NOT NULL AND t.deleted_at > cutoff)`. Dengan begitu `GET /shifts/{id}/summary` dan perhitungan ulang saat ada sync terlambat (`shift.totals_recomputed`) memberi hasil yang sama sebelum dan sesudah penghapusan.
- `ShiftSummary` mendapat `deleted_count` dan `deleted_amount`: transaksi `paid` di shift itu yang saat ini terhapus. Dashboard menampilkannya sebagai "N transaksi dihapus (Rp X)".

### 5. Inventaris query yang membaca `transactions`
Legenda: **Wajib** = tambahkan `deleted_at IS NULL` (di SQL, bukan filter JS). **Tidak** = sengaja tetap membaca baris terhapus. **Khusus** = aturan lain di kolom catatan. Path relatif terhadap `apps/api/src`.

| # | Lokasi | Fitur | Aturan | Catatan |
|---|---|---|---|---|
| 1 | `modules/transactions/routes.ts:122` | `GET /transactions` (daftar owner & riwayat kasir) | **Wajib** | |
| 2 | `modules/transactions/export.ts:87` `exportRows` | `GET /transactions/export` | **Wajib** | Item (`:98`) ikut lewat id transaksi. |
| 3 | `modules/transactions/access.ts:22` `findVisibleTransaction` | Detail, struk, void request | **Khusus** | Tambahkan parameter `includeDeleted` (default `false`). Hanya detail untuk owner yang memakai `true`. Struk dan void → `404`. |
| 4 | `modules/transactions/serialize.ts:147` `loadTransactionDto` | DTO untuk struk, pembayaran, void, replay | **Tidak** | Dipanggil setelah akses dicek. DTO menambahkan `deleted` (+ `deletion_history` hanya untuk owner). |
| 5 | `modules/transactions/serialize.ts:46,93–99` | Item, payments, void_requests per id | **Tidak** | Disaring lewat id dari induk. |
| 6 | `modules/transactions/service.ts:112` `replay()` | Idempotensi `POST /transactions` + `/sync/push` | **Tidak** | Harus menemukan baris terhapus supaya tidak di-insert ulang (§3). |
| 7 | `modules/reports/queries.ts:80` `loadSummary` | `GET /dashboard/summary` (termasuk periode pembanding) | **Wajib** | Termasuk hitungan `voided`. |
| 8 | `modules/reports/queries.ts:138` `loadSalesSeries` | `GET /dashboard/sales-series` | **Wajib** | |
| 9 | `modules/reports/queries.ts:168` `loadTopProducts` | `GET /dashboard/top-products` | **Wajib** | Pada join `transactions`. |
| 10 | `modules/reports/queries.ts:199–239` `loadSalesReport` | `GET /reports/sales` (semua `group_by`) | **Wajib** | Disarankan menambahkannya ke helper `inPeriod` agar semua query laporan ikut. |
| 11 | `modules/shifts/summary.ts:62` `computeShiftTotals` (raw SQL) | Ringkasan & tutup shift, hitung ulang sync terlambat | **Khusus** | Aturan cutoff §4 + hitung `deleted_count`/`deleted_amount`. |
| 12 | `modules/shifts/summary.ts:143` (QRIS manual) | `qris_manual_confirmed_count` | **Khusus** | Predikat sama dengan #11. |
| 13 | `modules/shifts/close.ts:80` hitung `pending` | Blok tutup shift | **Tidak** | `pending` tidak bisa dihapus. |
| 14 | `modules/shifts/close.ts:93` set `after_shift_close` | Tandai transaksi terlambat | **Tidak** | Hanya flag, status tidak berubah, jadi lolos trigger. |
| 15 | `modules/payments/service.ts:22,51–124,248` | Poll, konfirmasi, batal, kedaluwarsa QRIS | **Tidak** | Hanya menyentuh `pending`, yang tidak bisa dihapus. Trigger §1 menjadi pengaman terakhir. |
| 16 | `modules/voids/service.ts:55` `requestVoid` | Void request (API + sync `void_request.create`) | **Wajib** | Transaksi terhapus → `404 NOT_FOUND` (sync: hasil `rejected` dengan kode yang sama), bukan error trigger. |
| 17 | `modules/voids/service.ts:238` `voidDirectly` | Void langsung oleh owner | **Wajib** | `404`. |
| 18 | `modules/voids/service.ts:156` `decideVoid` | Setujui/tolak void | **Tidak** | Transaksi `void_requested` tidak bisa dihapus. |
| 19 | `modules/voids/routes.ts:122` | `GET /void-requests` | **Wajib** | Pada join `transactions`: riwayat void milik transaksi terhapus ikut tersembunyi. |
| 20 | `modules/notifications/notifier.ts:188` `loadTransactions` | Web Push transaksi/void (tunggal & batch) | **Wajib** | Transaksi yang dihapus sebelum notifikasi dikirim tidak dikirim. |
| 21 | `modules/sync/pull.ts:143` `last_number` | Penomoran perangkat | **Tidak** | Nomor terhapus tetap terpakai (§3). |
| 22 | `modules/devices/routes.ts:172` `lastNumber` | Pairing ulang perangkat | **Tidak** | Sama dengan #21. |
| 23 | `modules/transactions/service.ts:277–309` insert | Buat transaksi | — | Insert baru selalu `deleted_at = NULL`. |

Tidak ada view, webhook QRIS, atau notifikasi Telegram yang membaca `transactions` di kode saat ini. Query baru yang membaca `transactions` **wajib** memutuskan aturan hapus secara eksplisit, dan reviewer PR akan menanyakannya.

### 6. Dashboard (ringkas, untuk DEAR-124)
- Tombol **Hapus transaksi** hanya muncul bila `me.role = owner` dan `status ∈ DELETABLE_TRANSACTION_STATUSES` (`@kelola-kasir/contracts`). Untuk `pending`/`void_requested`, tombol dinonaktifkan dengan keterangan.
- Validasi alasan memakai `TRANSACTION_DELETE_REASON` (5–200 setelah trim).
- Setelah hapus/pulihkan, invalidasi cache daftar transaksi, ringkasan, laporan, ringkasan shift, dan Riwayat Hapus.

## Alternatif yang ditolak
- **Hapus fisik + salin ke tabel arsip.** Melanggar keputusan owner (non-destruktif), harus mematikan trigger `no_delete`, dan menyalin item/pembayaran rentan error. Pemulihan juga harus memasukkan ulang baris yang dilindungi trigger imutabilitas.
- **Status baru `deleted` di state machine.** Status lama (`paid`/`voided`/`cancelled`) akan hilang, padahal pemulihan harus mengembalikannya. Semua `CHECK`, trigger, dan klien yang membaca `status` juga harus berubah, termasuk APK yang tidak boleh diubah.
- **Kolom + `audit_logs` saja.** Lihat §1. Riwayat berulang hanya bisa dibaca dari JSON tanpa index.
- **`deleted_at` di `transaction_items`/`payments`.** Tidak perlu karena keduanya selalu dibaca lewat transaksi induk.

## Konsekuensi
- (+) Non-destruktif dan bisa dipulihkan. Riwayat lengkap ada di tabel bertipe dan `audit_logs`. Tidak ada perubahan APK. Biaya Rp0.
- (+) Invarian penting dijaga di DB (kolom konsisten, status beku, riwayat append-only), tidak hanya di kode.
- (−) Setiap query transaksi baru harus ingat `deleted_at IS NULL`. Mitigasinya: inventaris §5, helper `inPeriod`, dan checklist review.
- (−) Owner bisa menghapus transaksi `paid` di shift terbuka sehingga `expected_cash` turun. Ini disengaja (§4) dan tercatat di riwayat serta audit.
- Migrasi hanya menambah kolom nullable, tabel, index, CHECK, dan trigger. Aman dijalankan pada data produksi tanpa downtime. CHECK baru selalu lolos untuk data lama karena semua `deleted_*` bernilai `NULL`.
