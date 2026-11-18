ADR-0023 — Diskon item per produk/kategori: tabel `discounts` berversi, diskon per baris, validasi versi aturan untuk HP offline, omzet kotor/diskon/bersih

Status: Accepted · Tanggal: 2026-11-18 · Keputusan: Tech Lead · Issue: DEAR-185 (parent DEAR-184, desain DEAR-186) · Biaya tambahan: Rp0

## Konteks
Investor ingin owner mengatur **diskon per produk/kategori** dari dashboard, dan kasir otomatis memakai harga diskon (online maupun offline). Keputusan owner di DEAR-184: diskon tidak ditumpuk (pakai yang paling menguntungkan pelanggan), harga akhir ≥ Rp0 dan dibulatkan ke Rupiah, migrasi non-destruktif, transaksi lama tidak berubah, hanya owner yang membuat/mengubah diskon, manager hanya melihat diskon cabangnya, kasir tidak bisa memberi diskon manual.

Kondisi `main` (`2c64cac`):
- `transactions` sudah punya `discount_amount` dengan CHECK `total = subtotal - discount_amount + tax_amount`. Nilainya selalu 0 karena belum ada UI. Struk dan ekspor transaksi sudah menampilkan baris/kolom "Diskon".
- `transaction_items` hanya punya `unit_price` (snapshot harga), `quantity`, `line_total` dengan CHECK `line_total = unit_price * quantity`. API membandingkan `unit_price` dengan harga katalog (`apps/api/src/modules/transactions/service.ts:206`). Selisih harga **tidak ditolak**, hanya ditandai `price_mismatch` + audit `sync.price_mismatch`.
- Penjualan **tunai selalu lewat outbox** (`/sync/push`, `source = sync`), termasuk saat HP online. Hanya QRIS yang lewat `POST /transactions` (`source = api`). Sync menerima penjualan nyata walau datanya basi, tapi tetap menolak matematika yang salah (`TOTAL_MISMATCH`).
- Katalog **per outlet** (ADR-0020): "Jus Mangga" di Ragunan dan Palmerah adalah dua baris `products` berbeda.
- HP menarik katalog tiap 60 detik (`PULL_INTERVAL_MS`) lewat `/sync/pull` dengan kursor `catalog_seq`. APK lama mengabaikan key `changes` yang tidak dikenal dan entity `deleted` yang tidak dikenal.
- `/dashboard/summary` menghitung Omzet = `SUM(transactions.total)`. Laporan produk menghitung `SUM(transaction_items.line_total)`.

## Keputusan

### 1. Model data (migrasi `0008_discounts` + `0009_discounts_triggers`)
Semua tambahan bersifat aditif. Tidak ada kolom lama yang diubah artinya, dan tidak ada baris lama yang ditulis ulang.

**`discounts`**: satu promo milik owner, bisa berlaku di satu atau beberapa cabang.
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK | dibuat server |
| `name` | text 1–60 | tidak unik, mis. "Promo Mangga" |
| `target_type` | text `product`\|`category` | |
| `type` | text `percent`\|`amount` | |
| `value` | integer | `percent`: 1–100 (persen bulat). `amount`: Rp 1–100.000.000 |
| `starts_on` | date | tanggal mulai, inklusif, zona outlet (WIB) |
| `ends_on` | date NULL | tanggal selesai, inklusif. `NULL` = tanpa batas. CHECK `ends_on >= starts_on` |
| `days_of_week` | smallint[] NULL | ISO 1=Senin … 7=Minggu. `NULL` = setiap hari |
| `time_start`, `time_end` | text `HH:MM` NULL | keduanya terisi atau keduanya `NULL`. `time_start < time_end`, tanpa lewat tengah malam (Fase 1). Jam selesai eksklusif |
| `is_active` | boolean default true | tombol Nonaktifkan |
| `version` | integer default 1 | naik pada setiap perubahan (§3) |
| `created_by`, `updated_by` | uuid → users | |
| `created_at`, `updated_at` | timestamptz | |
| `deleted_at`, `deleted_by`, `delete_reason` | | soft delete, ketiganya terisi bersama (pola ADR-0019) |

**`discount_outlets`**: unit sinkron per cabang. PK `(discount_id, outlet_id)`, `updated_seq` (trigger `kk_touch_updated`, sama dengan `products`), `updated_at`, `removed_at` NULL (cabang dikeluarkan dari promo). Index `(outlet_id, updated_seq)`.

**`discount_targets`**: `(discount_id, outlet_id)` → `discount_outlets`, plus `product_id` NULL → `products` atau `category_id` NULL → `categories`. Tepat satu yang terisi, dan harus sesuai `target_type` (dijaga service). Unique per `(discount_id, product_id)` / `(discount_id, category_id)`. Produk/kategori harus milik `outlet_id` baris itu.

**`discount_history`** (append-only lewat trigger, pola `expense_history`): `id`, `discount_id`, `version`, `action` (`create`\|`update`\|`activate`\|`deactivate`\|`delete`), `snapshot` jsonb, `changes` jsonb NULL (`{ field: { from, to } }`), `reason` NULL (wajib untuk `delete`), `actor_user_id`, `created_at`. Unique `(discount_id, version)`. `snapshot` adalah aturan lengkap **setelah** perubahan: semua kolom di atas plus target per outlet (`{ "<outlet_id>": { product_ids, category_ids } }`). Tabel ini berfungsi sebagai riwayat perubahan di UI sekaligus sumber versi untuk validasi (§3). Setiap perubahan juga menulis `audit_logs` (`discount.created|updated|activated|deactivated|deleted`, `outlet_id` = outlet aktif token).

**Kenapa `discount_outlets` dipisah, bukan satu baris diskon per cabang.** Owner melihat "Promo Mangga" sebagai satu promo walau berlaku di Ragunan dan Palmerah, jadi resource API-nya satu. HP justru butuh satu baris per cabang dengan `updated_seq` sendiri, supaya mengeluarkan Palmerah dari promo bisa dikirim sebagai tombstone ke HP Palmerah (`removed_at`). Setiap perubahan header atau target menjalankan `UPDATE discount_outlets SET updated_at = now() WHERE discount_id = $1`, sehingga semua cabang menerima versi baru lewat kursor sync yang sudah ada.

**`transaction_items`**: kolom baru
| Kolom | Tipe | Catatan |
|---|---|---|
| `discount_id` | uuid NULL → `discounts` | promo yang dipakai |
| `discount_version` | integer NULL | versi aturan yang dipakai HP |
| `discount_name` | text NULL | snapshot nama untuk struk cetak ulang |
| `discount_amount` | bigint NOT NULL DEFAULT 0 | potongan **satu baris** = potongan per unit × `quantity` |

CHECK baru: `discount_amount >= 0 AND discount_amount <= line_total`, `(discount_id IS NULL) = (discount_version IS NULL)`, `discount_id IS NOT NULL OR discount_amount = 0`. `ADD COLUMN … DEFAULT 0 NOT NULL` tidak menulis ulang tabel (PostgreSQL ≥ 11) dan tidak memicu trigger imutabilitas item. Baris lama otomatis `discount_amount = 0`.

**Arti kolom yang sudah ada tidak berubah:**
- `transaction_items.unit_price` tetap = harga normal katalog (sebelum diskon). `line_total = unit_price × quantity` tetap = nilai kotor baris. Akibatnya CHECK lama, perbandingan `price_mismatch`, dan semua baris lama tetap benar. Nilai bersih baris = `line_total - discount_amount`.
- `transactions.subtotal` = Σ `line_total` (kotor).
- `transactions.discount_amount` = **Σ `transaction_items.discount_amount`** di Fase 1. Server menolak transaksi yang tidak memenuhi ini (`TOTAL_MISMATCH`). Kalau nanti ada diskon nota manual (Fase 2), akan ditambah kolom `order_discount_amount`, dan aturannya menjadi Σ item + diskon nota. Tidak perlu migrasi data.
- `transactions.total = subtotal - discount_amount + tax_amount` (CHECK lama).

### 2. Rumus harga (satu implementasi bersama)
Fungsi murni di `packages/money/src/discount.ts`, dipakai oleh API, APK, dan pratinjau dashboard. Dengan begitu tidak ada tiga versi rumus yang bisa berbeda.
- Potongan per unit:
  - `percent`: `floor((harga × value + 50) / 100)`, yaitu dibulatkan setengah ke atas ke Rupiah.
  - `amount`: `min(value, harga)`.
  - Harga akhir per unit = `harga - potongan` ≥ 0.
- Potongan baris = potongan per unit × `quantity`. Pembulatan dilakukan per unit supaya struk konsisten ("Rp12.000 → Rp9.600 × 3").
- **Berlaku pada instan `t`** bila: `is_active`, tidak dihapus, cabang tidak `removed`, tanggal lokal `t` ∈ [`starts_on`, `ends_on`], hari ISO `t` ∈ `days_of_week` (atau `NULL`), jam lokal `t` ∈ [`time_start`, `time_end`) (atau `NULL`), dan produk ditargetkan: `product_id` ada di target, atau `category_id` produk ada di target.
- **Zona waktu:** waktu lokal dihitung dari `outlets.timezone` dengan offset tetap (WIB +07:00, WITA +08:00, WIT +09:00; Indonesia tanpa DST), **bukan** dari zona HP. Jam HP yang zonanya salah tidak menggeser happy hour. Fungsi menerima `utcOffsetMinutes`, jadi tidak bergantung pada dukungan `Intl` di Hermes.
- **Tidak ditumpuk:** dari semua diskon yang berlaku untuk produk itu, pakai potongan per unit terbesar. Kalau seri, pakai `id` terkecil (deterministik).
- **Kapan dihitung di HP:** keranjang dihitung ulang setiap kali berubah dan setiap menit. Harga dikunci saat kasir menekan **Bayar**. Instan itu menjadi `client_created_at` transaksi, sehingga server memvalidasi dengan instan yang sama.

### 3. Validasi server (`POST /transactions` dan `/sync/push`)
`TransactionItemInput` mendapat field opsional `discount_id`, `discount_version`, `discount_amount` (default 0). APK baru mengirim ketiganya bila ada diskon. `unit_price` tetap harga normal.

Untuk setiap item, setelah `assertTotals` (yang sekarang juga memeriksa Σ diskon item = `discount_amount` transaksi):

| Kelas | Kondisi | `source = api` (QRIS) | `source = sync` (tunai/offline) |
|---|---|---|---|
| **Tanpa diskon** | `discount_id` kosong dan `discount_amount = 0` | terima | terima |
| **Tidak valid** | `discount_amount > 0` tanpa `discount_id`; `discount_id` tanpa `discount_version`; `discount_amount` bukan kelipatan `quantity`; diskon/versi tidak dikenal; snapshot versi itu tidak mencakup outlet perangkat; `discount_amount ≠ potonganPerUnit(unit_price, versi) × quantity` | tolak `422 DISCOUNT_INVALID` | tolak `DISCOUNT_INVALID` |
| **Basi** | Rumus cocok dengan versi yang dikirim, tetapi versi itu tidak berlaku pada `client_created_at` (di luar periode/jadwal, nonaktif, produk/kategori tidak ditarget), **atau** versi itu sudah digantikan lebih dari `DISCOUNT_GRACE` (10 menit) sebelum `client_created_at` | tolak `422 DISCOUNT_STALE` | **terima**, set `price_mismatch = true`, audit `sync.discount_stale` (`after.items[]`: `discount_id`, versi dikirim, versi berlaku, alasan) |
| **Valid** | Rumus cocok dan versi berlaku (versi terbaru, atau digantikan ≤ 10 menit sebelum `client_created_at`) | terima | terima |

Alasan pembagian ini:
- **Tidak valid** tidak mungkin dihasilkan APK yang jujur, karena APK menghitung dari snapshot yang sama dengan fungsi yang sama dan `unit_price` yang ia kirim sendiri. Ini setara dengan `TOTAL_MISMATCH`, jadi tetap ditolak walau lewat sync. Inilah yang memenuhi kriteria "API menolak harga diskon yang tidak sesuai aturan".
- **Basi** adalah kondisi wajar HP offline: aturan berubah, tetapi HP belum menariknya. Uang sudah diterima, jadi lewat sync penjualan **tidak pernah dibuang** (prinsip `/sync/push`). Penjualan ditandai dan diaudit supaya owner bisa melihatnya di Transaksi (badge `price_mismatch` yang sudah ada). Lewat API (QRIS, HP pasti online), pembayaran belum terjadi. Server menolak, lalu APK menarik katalog, menghitung ulang keranjang, menampilkan "Harga promo berubah" dengan total baru, dan kasir mengulang pembayaran.
- **Grace 10 menit** = `MAX_CLOCK_SKEW_MS`. Angka ini menutup jeda tarik katalog 60 detik, toleransi jam HP, dan antrean outbox singkat saat online.
- **Versi** dibaca dari `discount_history` (`snapshot` versi N, kapan digantikan = `created_at` versi N+1). Tidak perlu tabel versi terpisah, dan versi lama tidak pernah hilang.
- Server **tidak** memaksa "diskon terbaik". Bila HP tidak memakai diskon yang sebenarnya berlaku (APK lama, atau HP belum menarik promo baru), transaksi diterima tanpa tanda. Pelanggan membayar harga normal, jadi tidak ada kerugian bagi toko. Pilihan diskon terbaik dijamin oleh fungsi bersama dan diuji QA.
- **APK lama** tidak mengirim field diskon, sehingga selalu masuk kelas "tanpa diskon": diterima, harga normal, tidak ada error. Kompatibel penuh. Konsekuensinya, HP yang belum diperbarui menjual tanpa promo. Untuk itu: `/sync/pull` dan `/sync/push` membaca header `X-App-Version` (APK baru mengirimnya) lalu memperbarui `devices.app_version`. `GET /discounts` mengembalikan `outdated_devices` (perangkat aktif dengan versi < `DISCOUNT_MIN_APP_VERSION`, atau tanpa versi), dan dashboard menampilkan peringatan "HP K01 belum mendukung diskon, perbarui aplikasi".
- Pengecekan katalog yang sudah ada (`price_mismatch` saat `unit_price ≠ harga katalog`, `PRODUCT_UNAVAILABLE`) tidak berubah.

### 4. Sinkron ke APK
- `GET /sync/pull` menambah `changes.discounts: DiscountRule[]` dari `discount_outlets` outlet perangkat dengan `updated_seq > kursor`. Antrean, `limit`, dan kursor digabung dengan kategori/produk seperti sekarang (`catalog_seq` yang sama).
- `DiscountRule` = `id` (id diskon), `version`, `name`, `type`, `value`, `target_type`, `product_ids` / `category_ids` **outlet ini saja**, `starts_on`, `ends_on`, `days_of_week`, `time_start`, `time_end`, `utc_offset_minutes` (dari `outlets.timezone`).
- Tombstone `changes.deleted: { entity: 'discount', id }` dikirim bila diskon dihapus, dinonaktifkan, atau cabang ini dikeluarkan (`removed_at`). Diaktifkan lagi → dikirim ulang sebagai record. Snapshot penuh (tanpa kursor) hanya berisi diskon aktif yang belum lewat `ends_on`. Diskon yang sudah lewat masa berlakunya tidak perlu tombstone: HP mengabaikannya lewat rumus §2 dan boleh menghapusnya secara lokal.
- **Upgrade APK:** APK lama sudah memajukan kursor melewati baris diskon yang ia abaikan. Karena itu, migrasi SQLite APK baru yang membuat tabel `discounts` **wajib mengosongkan kursor** (`META.cursor`), sehingga tarikan berikutnya adalah snapshot penuh.
- Struk lokal (`printing/localReceipt.ts`) dan riwayat lokal memakai snapshot item (`discount_name`, `discount_amount`), bukan aturan saat ini.

### 5. Laporan: definisi angka
Per transaksi yang dihitung (aturan ADR-0022 §2: `paid` + `void_requested`, tidak dihapus, `client_created_at` dalam hari bisnis WIB):
- **Omzet kotor** (`gross_sales`) = Σ `subtotal` = Σ harga normal × qty.
- **Diskon** (`discount_total`) = Σ `transactions.discount_amount`.
- **Omzet bersih** = kotor − diskon. Field `revenue` yang sudah ada (Σ `total` = kotor − diskon + pajak) **tetap** menjadi angka utama "Omzet". Pajak masih 0, jadi `revenue` = omzet bersih. Rekap pengeluaran (ADR-0021), shift, dan seri penjualan memakai `total`, sehingga otomatis bersih dan tidak berubah.

Dampak per endpoint:
| Endpoint | Perubahan |
|---|---|
| `GET /dashboard/summary` | + `gross_sales`, `discount_total` (top-level dan `by_outlet`). `revenue` tetap. Kartu: "Omzet Rp X" + "Kotor Rp Y · Diskon Rp Z" |
| `GET /reports/products`, `/{id}`, `/{id}/series`, `/export` | `revenue` per produk menjadi **bersih** = Σ(`line_total − discount_amount`). + `gross_revenue`, `discount_amount` per baris, `totals`, dan detail. `share_pct` dari bersih. Ekspor: `Produk, Kategori, Cup, Kotor (Rp), Diskon (Rp), Bersih (Rp), % omzet, Periode, Cabang`. Sekarang `totals.revenue` = Omzet Ringkasan (selama pajak 0), sehingga catatan selisih di ADR-0022 §2 hilang |
| `GET /dashboard/top-products` | `revenue` bersih |
| `GET /reports/sales` | `group_by=product` memakai bersih. Semua grup + `gross_revenue`, `discount_amount` |
| `GET /reports/discounts` (baru) + `/export` | per promo: transaksi, cup, total diskon, omzet bersih item ber-promo. `outlet_scope` |
| `GET /transactions/export` | per transaksi tidak berubah (`Subtotal` = kotor, `Diskon`, `Total`). `detail=true`: + `Diskon`, `Total bersih`, `Promo` setelah `Total baris` |
| `GET /transactions/{id}`, receipt | item + `discount_id`, `discount_name`, `discount_amount`. `share_text`: baris "  Promo Mangga  -Rp2.400" di bawah item, "Hemat Rp X" di bawah total |

Sebelum ada diskon, semua angka baru identik dengan angka lama (`discount_amount = 0`). Tidak ada perubahan yang terlihat sampai owner membuat promo pertama.

### 6. API `/discounts` (tag `discounts`)
| Endpoint | Akses | Isi |
|---|---|---|
| `GET /discounts` | owner, manager | filter `status` (`active`\|`scheduled`\|`ended`\|`inactive`\|`deleted`), `outlet_scope`, + `outdated_devices` |
| `POST /discounts` | owner | buat. Cabang ditentukan dari target |
| `GET /discounts/{id}` | owner, manager | detail + `history` |
| `PATCH /discounts/{id}` | owner | wajib `version` (optimistic lock, `409 DISCOUNT_VERSION_CONFLICT`). `is_active: false` = Nonaktifkan |
| `DELETE /discounts/{id}` | owner | soft delete dengan `reason` |
| `GET /discounts/target-options` | owner | produk/kategori semua cabang owner, dikelompokkan per nama ternormalisasi (aturan ADR-0022 §3) untuk pemilih "Semua cabang" |

- **Cabang = asal target.** Body berisi `product_ids` atau `category_ids` (1–200). Cabang promo adalah outlet dari id-id itu. Semua outlet tersebut harus outlet tempat caller ber-role `owner`, selain itu `403`. Produk/kategori yang tidak dikenal atau terhapus → `422 DISCOUNT_TARGET_INVALID`. Untuk "Semua cabang", UI memakai `target-options`: memilih "Jus Mangga" mengirim id produk itu di setiap cabang. Produk baru yang ditambahkan **kemudian** di satu cabang tidak ikut otomatis pada target produk (owner perlu mengedit promo). Pada target kategori, produk baru di kategori itu ikut otomatis.
- **Status turunan** (tidak disimpan), dievaluasi pada tanggal lokal hari ini: `deleted` → `inactive` (`is_active = false`) → `scheduled` (hari ini < `starts_on`) → `ended` (`ends_on` < hari ini) → `active`. "Aktif" berarti dalam periode. Jadwal jam (happy hour) tidak mengubah status. UI menampilkan jadwal terpisah.
- **Manager**: `GET` saja. Hanya diskon yang mencakup outlet token, dan respons dipotong ke outlet itu (`outlets` dan target cabang lain tidak dikirim). `outlet_scope=all` → `403`. Diskon cabang lain → `404`. Tulis → `403`.
- **Kasir/perangkat**: tidak punya akses `/discounts`. Aturan hanya datang lewat `/sync/pull`.
- `id` dibuat server. `POST` tidak idempoten (dashboard online). Tombol simpan dinonaktifkan selama request berjalan.
- Setiap perubahan dijalankan dalam satu transaksi DB: `version + 1`, baris `discount_history`, `audit_logs`, sentuh `discount_outlets`. PATCH yang tidak mengubah apa pun → `200` tanpa versi baru.

## Alternatif yang ditolak
- **Menurunkan `unit_price` menjadi harga diskon** (dengan kolom `original_unit_price`). Laporan produk lama otomatis bersih, tetapi perbandingan `price_mismatch` dengan katalog harus diubah, `subtotal` berubah arti dari kotor ke bersih, baris "Diskon" di struk/ekspor yang sudah ada tetap 0, dan kolom harga normal baru harus diisi untuk baris lama. Model yang dipilih menjaga semua arti kolom lama.
- **Diskon item dibagi rata ke `transactions.discount_amount` saja** (tanpa kolom per baris). Laporan per produk dan per promo jadi mustahil.
- **Satu baris diskon per cabang (`group_id`).** Sync lebih sederhana, tetapi header terduplikasi, edit "Semua cabang" menjadi N update, dan riwayat terpecah. `discount_outlets` memberi sync per cabang tanpa menduplikasi header.
- **Validasi ketat juga di sync (tolak semua harga basi).** Penjualan tunai yang uangnya sudah diterima akan hilang dari server. Itu melanggar prinsip outbox.
- **Grace window tanpa versi (cukup "aturan apa pun yang berlaku dalam 24 jam terakhir").** Server harus menebak aturan mana yang dipakai HP, dan perubahan nilai (20% → 10%) tidak bisa dibedakan dari manipulasi. Dengan versi eksplisit, server tahu persis aturan mana yang dipakai.
- **Server memaksa diskon terbaik.** Akan menolak semua penjualan dari APK lama selama promo berjalan.

## Konsekuensi
- (+) APK lama tetap berjalan tanpa error (harga normal). Data lama tidak disentuh. Laporan identik sampai promo pertama dibuat. Biaya Rp0.
- (+) Satu fungsi rumus untuk API/APK/dashboard. Server bisa membuktikan aturan mana yang dipakai HP lewat `discount_version`.
- (+) Laporan produk dan Ringkasan kini sepakat (bersih).
- (−) Butuh rilis APK baru (kursor direset sekali saat upgrade). Selama ada HP lama, promo tidak berlaku di HP itu. Dashboard memperingatkannya lewat `outdated_devices`.
- (−) Lewat sync, harga promo basi diterima (ditandai). Owner yang mengubah promo saat HP offline akan melihat beberapa transaksi bertanda di Transaksi.
- (−) Arti `revenue` di `/reports/products*`, `/dashboard/top-products`, dan `/reports/sales?group_by=product` berubah dari kotor ke bersih. Nilainya sama selama belum ada diskon, jadi tidak ada data historis yang berubah.
- (−) Target produk "Semua cabang" tidak otomatis mencakup produk bernama sama yang ditambahkan kemudian. Target kategori mencakupnya.
- Field baru di respons yang sudah ada ditulis **opsional** di OpenAPI pada PR ini, supaya contract test tidak gagal sebelum Backend selesai. PR Backend memindahkannya ke `required` dan menghapus operasi baru dari `tests/contract/pending-operations.txt`.
