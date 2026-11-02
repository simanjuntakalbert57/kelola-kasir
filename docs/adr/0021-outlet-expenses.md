ADR-0021 — Catatan pengeluaran per cabang: `expense_categories` + `expenses` (soft delete + riwayat), rekap bulanan & laba sederhana

Status: Accepted · Tanggal: 2026-11-02 · Keputusan: Tech Lead (aturan bisnis dari DEAR-133, keputusan owner) · Issue: DEAR-134 (parent DEAR-133) · Implementasi: DEAR-136 (Backend), DEAR-137 (Frontend), Fase 2: DEAR-139 (Mobile) · Biaya tambahan: Rp0

## Konteks
Owner ingin mencatat pengeluaran setiap cabang, seperti buah, es batu, sedotan, listrik, wifi, sewa, dan gaji. Owner juga ingin melihat rekap bulanan per cabang dan gabungan, dengan **omzet − pengeluaran = laba sederhana** (DEAR-133). Keputusan owner:
- Fase 1 hanya dashboard owner/manager. APK kasir tidak berubah.
- Pengeluaran **tidak** mempengaruhi kas shift di Fase 1. Fase 2 (DEAR-139, konsep `docs/product/concepts/kas-keluar-masuk.md`) memungkinkan kasir mencatat kas keluar dari laci, lalu catatan itu masuk ke rekap yang sama.
- Jumlah dalam Rupiah bulat, dengan migrasi non-destruktif.
- Foto nota dikompres ≤200 KB dan disimpan di bucket privat yang sudah ada (ADR-0015).
- Koreksi dengan edit/hapus. Hapus memakai soft delete + riwayat (pola ADR-0019), dan semuanya dicatat di `audit_logs`.
- Manager hanya melihat cabangnya. Kasir tidak bisa melihat pengeluaran maupun omzet.

- **Tidak ada data yang dihapus** (Albert, DEAR-140). JUS1 menjadi Ragunan lewat rename. Transaksi uji coba tetap tersimpan, tetapi tidak boleh mengotori rekap cabang. Karena itu setiap cabang punya **tanggal mulai operasional** (§3).

Multi-cabang (outlet aktif, `outlet_scope=all`) diatur di ADR-0020.

## Keputusan

### 1. Model data (migrasi `0006_multi_outlet_expenses` + `0007_expenses_triggers`)

`expense_categories`, per outlet:
| Kolom | Tipe | Arti |
|---|---|---|
| `id` | uuid | |
| `outlet_id` | uuid → `outlets` | |
| `category_group` | text | `hpp` \| `operasional` \| `tetap` \| `lainnya` (field API: `group`) |
| `name` | text 1–40 | Unik per outlet (case-insensitive) di antara kategori aktif |
| `sort_order` | int | Urutan dalam kelompok |
| `archived_at` | timestamptz null | `NULL` = aktif. Kategori **tidak pernah dihapus**: arsip menyembunyikannya dari pilihan, sedangkan pengeluaran lama tetap memakainya. |
| `created_at`, `updated_at`, `updated_seq` | | `updated_seq` (trigger `kk_touch_updated`) disiapkan untuk sync APK di Fase 2 |

Kategori default di-seed oleh fungsi `kk_seed_expense_categories(outlet_id)` (idempoten: tidak melakukan apa pun kalau outlet sudah punya kategori). Fungsi ini dipanggil migrasi untuk semua outlet yang ada, serta oleh `create-branch-outlet.sql` dan `create-owner`:

| Kelompok | Kategori |
|---|---|
| `hpp` — Bahan jus (HPP) | Buah, Es batu, Gula/sirup/susu, Cup & sedotan/kemasan |
| `operasional` — Operasional | Listrik, Wifi/internet, Air/galon, Gas |
| `tetap` — Tetap | Sewa tempat, Gaji pegawai |
| `lainnya` — Lainnya | Perawatan/perbaikan, Lain-lain |

`expenses`:
| Kolom | Tipe | Arti |
|---|---|---|
| `id` | uuid | UUIDv7. Boleh dikirim klien untuk create idempoten (ADR-0008); kalau tidak, dibuat API. |
| `outlet_id` | uuid → `outlets` | |
| `category_id` | uuid | FK komposit `(category_id, outlet_id)` → `expense_categories (id, outlet_id)`: kategori **wajib** dari outlet yang sama, dijaga oleh DB |
| `spent_on` | date | Tanggal bisnis pengeluaran (zona outlet). Rekap mengelompokkan berdasarkan kolom ini, bukan `created_at`. |
| `description` | text 1–200 | mis. "Mangga 10 kg" |
| `amount` | bigint | Rupiah bulat, 1 … 1.000.000.000 (CHECK) |
| `funding_source` | text | `drawer` (Kas laci cabang) \| `owner` (Uang owner) |
| `receipt_image_key` | text null | Key objek di bucket privat: `<outlet_id>/expense_receipt/<uuid>.<ext>` |
| `source` | text | `dashboard` (Fase 1) \| `cash_movement` (dicadangkan untuk Fase 2) |
| `created_by`, `created_at`, `updated_by`, `updated_at` | | `*_by` → `users` |
| `deleted_at`, `deleted_by`, `delete_reason` | null | Soft delete. CHECK: ketiganya terisi bersama atau kosong bersama (sama seperti ADR-0019). |

Index: `(outlet_id, spent_on desc) WHERE deleted_at IS NULL` (daftar dan rekap), `(outlet_id, deleted_at)` (Riwayat Hapus), `(category_id)`.

`outlets.operations_started_on` (`date NULL`, migrasi `0006`): hari bisnis pertama cabang benar-benar beroperasi (DEAR-140). `NULL` = tidak ada batas. Aturannya di §3.

`expense_history` (append-only): `id`, `outlet_id`, `expense_id`, `action` (`create`|`update`|`delete`|`restore`), `changes jsonb` (khusus `update`: `{field: {from, to}}`), `reason` (wajib untuk `delete`), `actor_user_id`, `created_at`.

Invarian yang dijaga DB (trigger `0007`, sudah diuji di PostgreSQL 16):
- `expenses` tidak bisa di-`DELETE`.
- Selama `deleted_at` terisi, baris tidak bisa diubah sama sekali kecuali dipulihkan (`expenses_deleted_frozen`).
- `outlet_id`, `source`, `created_by`, dan `created_at` imutabel.
- `expense_history` append-only (`UPDATE`/`DELETE`/`TRUNCATE` ditolak, memakai `kk_append_only` dari ADR-0019).

**Kenapa ada `expense_history` padahal ada `audit_logs`.** Alasannya sama dengan ADR-0019: detail pengeluaran butuh riwayat bertipe dan ber-index per baris. Bedanya, di sini **edit** juga direkam, karena jumlah uang yang dikoreksi perlu jejak yang bisa dibaca owner, bukan hanya JSON forensik. `audit_logs` tetap diisi dengan before/after.

### 2. Endpoint (detail di `docs/api/openapi.yaml`, tag `expenses`)
| Endpoint | Akses | Fungsi |
|---|---|---|
| `GET /expense-categories?include_archived` | owner, manager | Kategori outlet aktif |
| `POST /expense-categories` | **owner** | Tambah kategori. Nama bentrok → `409 EXPENSE_CATEGORY_NAME_TAKEN`. |
| `PATCH /expense-categories/{id}` | **owner** | Ganti nama/kelompok/urutan, `archived` true/false. Mengganti kelompok ikut memindahkan pengeluaran lama di rekap (disengaja: kelompok adalah klasifikasi, bukan data transaksi). |
| `GET /expenses` | owner, manager | Filter `date_from`/`date_to` (pada `spent_on`), `category_id`, `group`, `funding_source`, `q`, `status=active\|deleted` (deleted: owner saja), `outlet_scope`, cursor. Respons berisi `summary {count, total_amount}` untuk seluruh filter. |
| `POST /expenses` | owner, manager | Selalu ke outlet aktif. `id` opsional untuk idempotensi: isi sama → `200`, isi beda → `409 ID_REUSED`. |
| `GET /expenses/export?format=csv\|xlsx` | owner, manager | Filter sama dengan daftar. Sheet kedua `Rekap` (xlsx). Diaudit sebagai `expenses.exported`. |
| `GET /expenses/{id}` | owner, manager | `ExpenseDetail` + `history`. Pencarian lintas outlet member (ADR-0020 §2). Yang terhapus hanya untuk owner. |
| `PATCH /expenses/{id}` | owner, manager | Koreksi. Terhapus → `409 EXPENSE_DELETED`. Kalau tidak ada perubahan → `200` tanpa riwayat. |
| `DELETE /expenses/{id}` body `{reason}` | **owner** | Soft delete, idempoten. Alasan 5–200 karakter. |
| `POST /expenses/{id}/restore` body `{note?}` | **owner** | Pulihkan |
| `GET /reports/expenses?month_from&month_to&outlet_scope&include_pre_operations` | owner, manager | Rekap bulanan (§3) |
| `GET/PATCH /settings` field `operations_started_on` | baca: owner, manager; ubah: **owner** | Tanggal mulai operasional cabang aktif (§3). Manager yang mengirim field ini → `403`, tidak ada yang tersimpan. |
| `POST /uploads` purpose `expense_receipt` | owner, manager | Maksimal 300 KiB, `outlet_id` opsional (ADR-0020) |

- Pegawai/device → `403` di semua endpoint di atas. Guard memakai `guards.owner` (owner+manager), dan `ownerOnly` seperti `transactions/routes.ts` untuk yang khusus owner. Untuk endpoint by-id, role diambil dari membership di outlet milik baris itu.
- Validasi: `description` dan `name` di-trim. `spent_on` antara 2020-01-01 dan hari ini (zona outlet). `category_id` harus kategori **aktif** dari outlet yang sama: tidak ditemukan / outlet lain → `400 VALIDATION_ERROR`, diarsipkan → `422 EXPENSE_CATEGORY_ARCHIVED`.
- `receipt_url` diterima hanya kalau berbentuk `{API_PUBLIC_BASE_URL}/v1/media/{outlet_id baris}/expense_receipt/{uuid}.{jpg|png|webp}`. Kalau tidak → `422 INVALID_RECEIPT_URL`. Yang disimpan adalah key-nya, lalu respons membangun ulang URL. `null` menghapus nota. Objek lama tidak dihapus dari bucket di Fase 1 (biaya penyimpanan ≈ Rp0).
- Setiap tulis dilakukan dalam satu transaksi DB: baris `expenses` + `expense_history` + `writeAudit` (`expense.created|updated|deleted|restored`, `expense_category.created|updated`).
- Kode error baru: `EXPENSE_DELETED` (409), `EXPENSE_CATEGORY_ARCHIVED` (422), `EXPENSE_CATEGORY_NAME_TAKEN` (409), `INVALID_RECEIPT_URL` (422).
- Konstanta bersama di `@kelola-kasir/contracts`: `EXPENSE_GROUPS`, `EXPENSE_GROUP_LABELS`, `EXPENSE_FUNDING_SOURCES`, `EXPENSE_FUNDING_SOURCE_LABELS`, `EXPENSE_LIMITS`, `EXPENSE_DELETE_REASON`, `EXPENSE_REPORT_MAX_MONTHS`, `OUTLET_SCOPES`.

### 3. Rekap bulanan dan laba sederhana (`GET /reports/expenses`)
- Periode `month_from`..`month_to` (`YYYY-MM`, maksimal 12 bulan, default bulan ini). Setiap bulan dan setiap outlet dalam scope selalu muncul, dengan angka 0 kalau kosong.
- **Pengeluaran**: `expenses` yang `deleted_at IS NULL`, dikelompokkan berdasarkan bulan dari `spent_on`.
- **Omzet**: **sama persis** dengan aturan `GET /dashboard/summary`, yaitu status `paid` atau `void_requested`, `deleted_at IS NULL` (ADR-0019), dan bulan dari `client_created_at` di zona outlet. Issue menulis "transaksi paid". `void_requested` ikut dihitung supaya angka Rekap dan Ringkasan tidak pernah berbeda untuk periode yang sama. Transaksi `void_requested` masih uang yang diterima sampai void disetujui. Implementasi wajib memakai helper `inPeriod`/predikat yang sama dengan `loadSummary`, bukan menyalin SQL.
- **Tanggal mulai operasional (DEAR-140).** Default-nya, per outlet, omzet **dan** pengeluaran hanya dihitung mulai `operations_started_on` (`client_created_at` / `spent_on` ≥ tanggal itu, zona outlet):
  - Bulan yang memuat tanggal itu dihitung **parsial** (mulai tanggal itu sampai akhir bulan). Bulan sebelumnya bernilai 0. Sel outlet membawa `counted_from` (tanggal mulai kalau sel dihitung parsial atau seluruhnya sebelum mulai, `null` kalau dihitung penuh) supaya dashboard bisa menulis "dihitung mulai 10 Nov" atau "belum beroperasi".
  - `NULL` = tidak ada batas. `include_pre_operations=true` mengabaikan tanggal ini (untuk melihat masa uji coba).
  - Riwayat transaksi, Ringkasan (`/dashboard/summary`), laporan penjualan, ekspor transaksi, dan daftar pengeluaran (`GET /expenses`) **tidak** terpengaruh dan tetap menampilkan semua data. Konsekuensinya, untuk bulan mulai operasional, omzet Rekap bisa lebih kecil daripada Ringkasan untuk periode yang sama. Ini disengaja (owner menyetujui di review PR #91). Untuk bulan yang seluruhnya sesudah tanggal mulai, atau dengan `include_pre_operations=true`, angkanya tetap sama persis.
  - Ekspor pengeluaran (`GET /expenses/export`) memakai aturan yang sama di kedua sheet, sehingga total sheet `Pengeluaran` sama dengan sheet `Rekap`.
  - Hanya owner yang bisa mengubahnya, lewat `PATCH /settings` (halaman Pengaturan, cabang aktif) atau parameter skrip ops `rename-outlet.sql`/`create-branch-outlet.sql`. Rentang 2020-01-01 s.d. hari ini + 366 hari (boleh diisi sebelum go-live). Perubahan diaudit di `settings.updated` (before/after) dan sengaja mengubah rekap bulan-bulan sebelumnya.
  - Pengeluaran dengan `spent_on` sebelum tanggal mulai tetap boleh dicatat (mis. belanja persiapan), tetapi tidak masuk Rekap default. Form menampilkan peringatan kecil.
  - Implementasi: batas bawah per outlet ditambahkan sebagai predikat pada dua agregasi yang sama (`GREATEST(awal periode, operations_started_on)` per outlet), bukan query terpisah per outlet.
- **Laba sederhana** = omzet − total pengeluaran (`SignedRupiah`, bisa negatif). Ini bukan laporan laba-rugi akuntansi: tidak ada penyusutan, stok, atau akrual. Dashboard menampilkan label "Laba sederhana" dengan keterangan itu.
- Setiap sel (`ExpenseReportCell`) berisi `revenue`, `transaction_count`, `expense_total`, `expense_count`, `profit`, `by_group`, `by_funding_source`, dan `by_category[]`. Struktur respons: `months[] → per_outlet[] + total`, plus `total` untuk seluruh periode. Sel gabungan lintas outlet menyatukan kategori dengan kelompok + nama yang sama (case-insensitive), dengan `category_id = null`.
- Query: satu agregasi `expenses GROUP BY outlet, bulan, kategori` dan satu agregasi `transactions GROUP BY outlet, bulan`, lalu digabung di JS. Keduanya memakai index `(outlet_id, spent_on)` dan `transactions_outlet_created_idx`. Tidak ada N+1 per outlet atau per bulan.
- Ekspor Excel: sheet `Pengeluaran` (baris) + `Rekap` (angka yang sama dengan endpoint ini, termasuk aturan tanggal mulai operasional). Ekspor transaksi yang sudah ada tidak berubah. Menu Ekspor di dashboard mendapat pilihan baru "Pengeluaran".

### 4. Kesiapan Fase 2 (kas keluar dari laci oleh kasir, DEAR-139)
Fase 2 **menulis ke tabel `expenses` yang sama**, sehingga rekap, ekspor, dan daftar tidak perlu diubah:
- Mutasi sync baru `cash_movement.create` (ID UUIDv7 dari HP, idempoten seperti transaksi). Untuk kas keluar berkategori, server membuat baris `expenses` dengan `source = 'cash_movement'`, `funding_source = 'drawer'`, dan `id` = id mutasi.
- Migrasi Fase 2: `created_by` menjadi nullable + `created_by_employee_id` (CHECK: tepat satu terisi sesuai `source`), `shift_id` → `shifts` (wajib untuk `cash_movement`), dan kas masuk dicatat di tabel `cash_movements` terpisah yang tidak masuk rekap pengeluaran.
- `computeShiftTotals`: `expected_cash` dikurangi pengeluaran `source = 'cash_movement'` di shift itu yang tidak terhapus. Aturan cutoff shift tertutup mengikuti ADR-0019 §4. Pengeluaran `dashboard` dengan `funding_source = 'drawer'` **tetap tidak** mempengaruhi kas shift, karena owner mencatatnya belakangan dan tidak terikat shift.
- Kategori untuk HP sudah punya `updated_seq` sehingga bisa ikut `/sync/pull`.
Semua itu di luar PR ini. Yang disiapkan sekarang hanya `source`, `updated_seq`, dan `id` dari klien.

### 5. Dashboard (ringkas, untuk DEAR-137; desain dari DEAR-135)
- Menu **Pengeluaran** (owner & manager) berisi tab Daftar, Rekap, dan Kategori (Kategori: owner saja). Pemilih cabang mengikuti ADR-0020 §5, dan "Semua cabang" tersedia di Daftar dan Rekap.
- Form: tanggal (default hari ini), kategori (aktif, dikelompokkan), keterangan, jumlah (input Rupiah), sumber dana (radio), dan foto nota (opsional). Foto dikompres di browser ke ≤200 KB (`EXPENSE_LIMITS.receiptTargetBytes`, maks. sisi 1280 px, JPEG/WebP), lalu `POST /uploads` dan `PUT`.
- Hapus (owner) memakai dialog alasan seperti Hapus transaksi. Riwayat Hapus pengeluaran = `GET /expenses?status=deleted`.
- Setelah tulis, invalidasi daftar, rekap, dan detail pengeluaran. Setelah ganti cabang, `queryClient.clear()` (ADR-0020).
- Nota dibuka lewat `receipt_url` (redirect presigned, ADR-0015).

## Alternatif yang ditolak
- **Kategori global (tanpa `outlet_id`).** Owner ingin bisa menambah atau mengganti nama per cabang, dan pola data lain di sistem ini juga per outlet. Rekap gabungan tetap rapi karena kelompoknya tetap (4 nilai) dan kategori digabung berdasarkan nama.
- **Kelompok sebagai tabel sendiri.** Empat nilai tetap yang dipakai untuk label dan logika laporan cukup dijaga dengan CHECK + enum OpenAPI.
- **`expenses` tanpa riwayat edit (hanya `audit_logs`).** Lihat §1.
- **Hapus fisik pengeluaran.** Melanggar keputusan owner dan pola ADR-0019.
- **Omzet hanya `paid`.** Lihat §3. Angkanya akan berbeda dengan Ringkasan.
- **Tabel terpisah untuk kas keluar Fase 2 yang di-UNION di laporan.** Setiap query (daftar, ekspor, rekap, filter, cursor) harus memakai UNION. Satu tabel dengan kolom `source` lebih sederhana dan tetap bisa dibedakan.

## Konsekuensi
- (+) Satu sumber data pengeluaran untuk Fase 1 dan Fase 2. Invarian penting dijaga DB (kategori satu outlet, tidak bisa hapus fisik, beku saat terhapus, riwayat append-only). Biaya Rp0.
- (+) Rekap dan Ringkasan memakai aturan omzet yang sama. Selisih hanya mungkin di bulan sebelum/saat tanggal mulai operasional, dan itu terlihat lewat `counted_from`.
- (+) Data uji coba tidak perlu dihapus untuk mendapat rekap bersih (DEAR-140).
- (−) Endpoint by-id pengeluaran mencari lintas outlet member, berbeda dengan endpoint by-id lain (ADR-0020 §2). Aturan ini harus diuji eksplisit: manager outlet A → `404` untuk pengeluaran outlet B.
- (−) Mengganti kelompok kategori mengubah rekap bulan-bulan sebelumnya. Ini disengaja dan terlihat di audit `expense_category.updated`.
- Migrasi hanya menambah tabel, index, CHECK, trigger, fungsi seed, satu kolom ber-default (`previous_codes`), dan satu kolom nullable (`operations_started_on`). Aman pada data produksi tanpa downtime.
