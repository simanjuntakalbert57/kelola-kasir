ADR-0018 — Impor produk massal dari CSV / Excel: pratinjau tanpa state + simpan dengan unggah ulang

Status: Accepted · Tanggal: 2026-10-30 · Keputusan: Tech Lead (aturan bisnis dari DEAR-111, keputusan owner) · Issue: DEAR-112 (parent DEAR-111) · Desain: DEAR-113 (template + layar Impor) · Biaya tambahan: Rp0

## Konteks
Owner ingin menambah banyak produk sekaligus: unduh template → isi di Excel / Google Sheets / HP → unggah → cek pratinjau → simpan (DEAR-111). Keputusan owner yang sudah ditetapkan di DEAR-111:
- Produk dengan nama sama (tidak peka huruf besar/kecil) di gerai yang sama **diperbarui**, bukan dobel. Tidak ada produk yang dihapus lewat impor.
- Maks. **500 baris** dan **2 MB** per file. Semua-atau-tidak-sama-sekali dalam 1 transaksi DB, dicatat di audit log. Hanya owner.
- Foto produk tidak lewat file. APK kasir tidak berubah; produk sampai ke kasir lewat `/sync/pull` yang sudah ada.

Batasan teknis:
- File mentah **tidak boleh disimpan** di server (berisi data bisnis; tidak ada alasan menyimpannya).
- Yang disimpan harus **persis** yang owner lihat di pratinjau. Kalau katalog berubah di antara pratinjau dan simpan (owner lain mengedit, tab lain), hasil pratinjau tidak berlaku lagi.
- Dashboard memanggil API lewat proxy Cloudflare Pages yang hanya meneruskan header tertentu (`apps/dashboard/src/proxy/apiProxy.ts`), jadi token tidak bisa dikirim lewat header kustom.
- `exceljs` sudah menjadi dependensi API (ekspor transaksi).

## Keputusan

### 1. Endpoint (detail di `docs/api/openapi.yaml`, tag `catalog`)
| Endpoint | Fungsi |
|---|---|
| `GET /v1/products/import/template?format=xlsx\|csv` | Unduh template. Dibuat server dengan `exceljs` (tanpa file statis), jadi kolom selalu sama dengan parser. |
| `POST /v1/products/import/preview` | `multipart/form-data`, field `file`. **Dry-run**: parse + validasi + cocokkan dengan katalog, tidak menulis apa pun. Mengembalikan ringkasan, hasil per baris, dan `import_token`. |
| `POST /v1/products/import/commit` | `multipart/form-data`, field `file` (file **yang sama**) + `import_token`. Menjalankan ulang parse + validasi yang sama, memverifikasi token, lalu menerapkan semuanya dalam 1 transaksi. |

Semua endpoint: `ownerAuth`, role owner saja (`guards.owner`), gerai = `principal.outletId`.

### 2. Pratinjau tanpa state; simpan dengan unggah ulang file
Server tidak menyimpan file maupun hasil pratinjau. Dashboard menyimpan objek `File` di memori dan mengirimnya lagi saat **Simpan**.

`import_token` = `v1.<expires_unix>.<catalog_seq>.<sha256_file_hex>.<hmac>`, dengan `hmac = base64url(HMAC-SHA256(key, "v1|outlet_id|user_id|sha256_file|catalog_seq|expires_unix"))`.
- `key` = HKDF-SHA256 dari `PIN_FINGERPRINT_SECRET` dengan `info = "kelola-kasir/product-import-token"` → **tidak ada secret baru**.
- `catalog_seq` = `max(updated_seq)` dari `categories` dan `products` gerai itu (termasuk baris soft-deleted). `updated_seq` diambil dari sequence global yang naik di setiap perubahan, jadi perubahan katalog apa pun pada gerai ini mengubah nilainya.
- Masa berlaku **30 menit**.
- Token hanya diberikan bila `summary.error = 0` dan ada sesuatu untuk disimpan (`create + update > 0`); selain itu `null`.

Commit:
1. Parse + validasi ulang file (aturan §3–§5 sama persis). Ada error baris → `422 IMPORT_HAS_ERRORS` (UI seharusnya tidak sampai ke sini).
2. Token rusak, HMAC salah, atau `sha256`/user/gerai tidak cocok → `400 IMPORT_TOKEN_INVALID`.
3. Token kedaluwarsa → `409 IMPORT_STALE`.
4. Mulai transaksi, `select pg_advisory_xact_lock(hashtext('product-import:' || outlet_id))` supaya dua impor di gerai yang sama berjalan bergiliran, hitung ulang `catalog_seq`. Kalau berbeda dari token → `409 IMPORT_STALE` ("Katalog berubah sejak pratinjau. Unggah ulang untuk melihat pratinjau terbaru.").
5. Terapkan rencana (§6), tulis audit, commit.

Kenapa tidak menyimpan hasil pratinjau di tabel sementara: butuh migrasi + pembersihan TTL, dan tetap perlu pengecekan katalog berubah. Unggah ulang maksimal 2 MB sekali lagi itu murah, dan file tidak pernah menyentuh disk.

Kenapa `multipart/form-data` dan bukan body mentah + header: proxy Pages hanya meneruskan header yang ada di daftar, sedangkan `content-type` multipart sudah diteruskan. Multipart juga membawa nama file untuk deteksi format. API menambah `@fastify/multipart` (plugin resmi Fastify, MIT) dengan batas `files: 1`, `fields: 2`, `fileSize: 2 MiB`, didaftarkan **hanya** di dua route impor.

### 3. Format file
| | CSV | XLSX |
|---|---|---|
| Deteksi | Nama berakhiran `.csv`, **bukan** diawali `PK\x03\x04` | Nama berakhiran `.xlsx` **dan** diawali `PK\x03\x04` |
| Ditolak | — | `.xls` (biner lama), `.xlsm`/`.xlsb`, atau `.xlsx` yang berisi `xl/vbaProject.bin` (makro) → `422 IMPORT_FILE_UNREADABLE` |
| Lainnya | → `415 UNSUPPORTED_MEDIA_TYPE` | |

Format ditentukan dari nama file + magic bytes, **bukan** `Content-Type` part (Windows sering mengirim `application/vnd.ms-excel` untuk `.csv`).

**CSV**
- Encoding UTF-8, dengan atau tanpa BOM. Kalau byte-nya bukan UTF-8 valid (Excel lama "CSV (Comma delimited)"), dibaca sebagai Windows-1252 + peringatan `ENCODING_FALLBACK`.
- Pemisah dideteksi dari baris header: `;`, `,`, atau tab, yaitu yang menghasilkan kolom wajib terbanyak (seri → `;` lalu `,`). Kutipan RFC 4180 (`"a;b"`, `""` = `"`) dan CRLF/LF didukung. Disarankan `csv-parse/sync` (MIT) dengan `delimiter` hasil deteksi, `relax_column_count: true`, `bom: true`.
- Template CSV ditulis UTF-8 + BOM, pemisah **`;`**, CRLF, agar langsung terbuka per kolom di Excel ber-locale Indonesia.

**XLSX**
- Dibaca dengan `exceljs` (`workbook.xlsx.load(buffer)`). Sebelum itu, cek central directory ZIP: total ukuran tak terkompresi ≤ **20 MB** dan ≤ **100 entri**; lebih dari itu → `IMPORT_FILE_UNREADABLE` (lindungi dari zip bomb).
- Sheet: yang bernama `Produk` (tidak peka huruf besar/kecil), kalau tidak ada maka sheet **pertama** yang bukan `Petunjuk`.
- **Nilai saja, rumus tidak pernah dievaluasi**: sel rumus memakai hasil tersimpan (`cell.result`). Rumus tanpa hasil tersimpan, atau hasil error (`#REF!`, dll.) → error baris `FORMULA_NOT_ALLOWED`. Hyperlink → teksnya. Rich text → gabungan teks. Tanggal → error tipe untuk kolom tersebut.
- Baris dibaca sampai baris terakhir yang berisi nilai, maks. 5.000 baris fisik (lebih dari itu → `IMPORT_TOO_MANY_ROWS`).

### 4. Header
- Header = **baris tidak kosong pertama**. Nama kolom dinormalisasi: trim, huruf kecil, buang spasi/`_`/`*`, buang teks dalam kurung (`Harga (Rp)` → `harga`).
- Kolom: `nama`, `kategori`, `harga` (wajib), `favorit`, `aktif` (opsional). Urutan bebas.
- Kolom wajib tidak ada atau kolom ganda → `422 IMPORT_COLUMNS_INVALID` dengan `errors[]` (`path` = nama kolom). Kolom lain diabaikan + peringatan `UNKNOWN_COLUMN`.

### 5. Baris dan nilai
- Nomor baris = **nomor baris di spreadsheet** (header biasanya baris 1), supaya "Baris 7" sama dengan yang owner lihat di Excel. Baris yang semua selnya kosong diabaikan tetapi tetap dihitung dalam penomoran.
- Lebih dari **500** baris data tidak kosong → `422 IMPORT_TOO_MANY_ROWS` (tidak diproses sama sekali).
- Teks: NFC, trim, spasi berurutan menjadi satu, NBSP dianggap spasi.

| Kolom | Aturan | Kode error baris |
|---|---|---|
| `nama` | wajib, 1–60 karakter, tidak boleh diawali `= + - @` (formula injection) | `REQUIRED`, `TOO_LONG`, `UNSAFE_TEXT` |
| `kategori` | wajib, 1–40 karakter, aturan awalan sama | `REQUIRED`, `TOO_LONG`, `UNSAFE_TEXT` |
| `harga` | wajib, bilangan bulat 0–1.000.000.000. Sel angka XLSX harus bulat. Teks: buang spasi, awalan `Rp`/`Rp.` (tidak peka huruf besar/kecil), akhiran `,00`/`,-`; lalu harus `^\d+$` atau `^\d{1,3}(\.\d{3})+$` (titik = pemisah ribuan). Jadi `15000`, `15.000`, `Rp15.000`, `Rp 15.000,00` diterima; `15,5`, `15.5`, `-1`, `1.5000` ditolak. | `REQUIRED`, `INVALID_PRICE` |
| `favorit`, `aktif` | opsional. `ya`/`y`/`yes`/`true`/`1` dan `tidak`/`t`/`no`/`false`/`0` (tidak peka huruf besar/kecil), atau boolean XLSX | `INVALID_BOOLEAN` |

Nilai opsional kosong: produk **baru** pakai default (`favorit = tidak`, `aktif = ya`); produk yang **diperbarui** tetap memakai nilai lamanya (sel kosong tidak menimpa).

### 6. Pencocokan dan rencana
Kunci nama = teks ternormalisasi (§5) lalu `toLowerCase()`. Muat semua produk & kategori gerai yang `deleted_at IS NULL` (satu kali query masing-masing).
- **Duplikat di dalam file** (kunci `nama` sama) → semua baris itu error `DUPLICATE_IN_FILE` ("Nama sama dengan baris 4").
- **Produk**: 0 produk cocok → `create`. 1 produk cocok → `update` bila ada perbedaan pada `price`, `category_id`, `is_favorite`, `is_active`, dan `unchanged` bila tidak ada. Lebih dari 1 produk lama cocok (data lama tidak unik) → `AMBIGUOUS_MATCH`. Nama produk lama **tidak diubah** (beda huruf besar/kecil saja tidak dianggap perubahan). `is_sold_out`, `image_url`, `sort_order` tidak pernah disentuh.
- **Kategori**: cocok dengan kunci yang sama. Tidak ada → kategori baru (`category_is_new: true`; satu kategori baru untuk semua baris yang menyebut nama itu). Lebih dari 1 kategori lama cocok → pakai yang pertama menurut `sort_order, created_at, id` (tidak memblokir owner).
- Produk dan kategori baru: `sort_order = 0` (sama dengan `POST /products`/`/categories`), nama disimpan sesuai teks ternormalisasi dari file.

### 7. Menyimpan
- Satu transaksi: buat kategori baru → insert produk baru (batch) → update produk yang berubah. Trigger yang sudah ada menaikkan `updated_seq`, jadi `/sync/pull` kasir mengambil perubahan tanpa kode tambahan.
- Audit log (transaksi yang sama, `writeAudit`):
  - satu entri `product.imported` (`entity_type = 'product_import'`, `meta`: `file_sha256`, `format`, `rows`, `created`, `updated`, `unchanged`, `categories_created`);
  - `product.price_changed` per produk yang harganya berubah (`before`/`after` sama seperti `PATCH /products/:id`), agar riwayat harga tetap lengkap.
  - Nama file **tidak** dicatat (bisa berisi data pribadi).
- Respons `200 ProductImportResult` berisi jumlah per aksi. Commit file yang sama dua kali: commit kedua mendapat `IMPORT_STALE` (katalog sudah berubah). Pratinjau ulang akan menunjukkan semua `unchanged` dan tidak memberi token, jadi impor ulang tidak pernah membuat produk dobel.

### 8. Keamanan & batas
- Hanya owner; employee/device → `403`. Rate limit: 20 permintaan/menit per user untuk `preview` + `commit`.
- Ukuran: `fileSize` 2 MiB di multipart → `413 IMPORT_FILE_TOO_LARGE`. Body proxy Pages dibuffer (maks. ~2 MB, aman).
- File hanya diproses di memori, tidak ditulis ke disk/R2, tidak di-log. Log request hanya mencatat ukuran, format, dan jumlah baris.
- Teks berawalan `= + - @` ditolak, sehingga ekspor/template berikutnya tidak membawa formula. Respons tidak menggemakan isi sel lebih dari 60/40 karakter.
- Template: header + 2 baris contoh dari desain DEAR-113, sheet `Petunjuk`, kolom `harga` berformat `#,##0`, validasi data daftar `ya,tidak` di `favorit`/`aktif`, baris header dibekukan. `Content-Disposition: attachment; filename="template-impor-produk.xlsx"` (atau `.csv`), `Cache-Control: no-store`.

## Alternatif yang ditolak
- **Parse di browser, kirim JSON ke endpoint bulk**: aturan parsing harus diduplikasi di FE dan BE (BE tetap wajib memvalidasi), dan `exceljs` menambah ±1 MB ke bundle dashboard.
- **Simpan hasil pratinjau di DB (`import_jobs`)**: butuh migrasi + job pembersihan; tidak memberi keuntungan pada 500 baris.
- **Upsert by `id` / SKU**: produk belum punya SKU, dan owner berpikir dengan nama produk. Bisa ditambah nanti sebagai kolom opsional tanpa mengubah alur.
- **Sebagian tersimpan (lewati baris error)**: ditolak owner (DEAR-111: semua atau tidak sama sekali).

## Konsekuensi
- Kode error baru di `ErrorCode`: `IMPORT_FILE_TOO_LARGE`, `IMPORT_FILE_UNREADABLE`, `IMPORT_COLUMNS_INVALID`, `IMPORT_TOO_MANY_ROWS`, `IMPORT_HAS_ERRORS`, `IMPORT_TOKEN_INVALID`, `IMPORT_STALE`.
- Dependensi baru di API: `@fastify/multipart`, `csv-parse` (keduanya MIT). Tidak ada migrasi, tidak ada secret/env baru, biaya Rp0. APK kasir tidak berubah.
- Nama produk tetap **tidak** dibuat unik di DB (data lama mungkin sudah dobel); impor melaporkan `AMBIGUOUS_MATCH` untuk kasus itu.
- Impor 500 baris = ±3 query baca + ≤ 3 statement tulis batch dalam 1 transaksi; target p95 commit < 2 detik di VPS.
