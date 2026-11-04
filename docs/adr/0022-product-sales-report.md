ADR-0022 — Laporan penjualan per produk: endpoint `/reports/products*`, `outlet_scope`, dan kunci produk lintas cabang

Status: Accepted · Tanggal: 2026-11-04 · Keputusan: Tech Lead · Issue: DEAR-166 (desain DEAR-161, `docs/design/penjualan-produk.html`) · Biaya tambahan: Rp0

## Konteks
Kartu "Penjualan per Produk" menggantikan "Top produk" di Ringkasan (`/`). Kartu ini mengikuti filter periode dan cabang Ringkasan, termasuk "Semua cabang", dan membuka detail produk di `/?produk=<id>`. Desain bagian 7 meminta daftar produk (cup, Rp, % omzet, produk 0 penjualan ikut), detail satu produk, tren per produk, dan ekspor Excel.

Kondisi `main` (`a237455`):
- `GET /reports/sales?group_by=product` hanya untuk outlet aktif, tanpa produk 0 penjualan, tanpa kategori, dan dipakai bersama `group_by=employee|payment_method|day`. Dashboard tidak memakainya.
- `GET /dashboard/top-products` dan `/dashboard/sales-series` hanya untuk outlet aktif. Saat "Semua cabang", UI Ringkasan menampilkan data cabang aktif dengan label nama cabang.
- Katalog **per outlet** (ADR-0020): "Jus Mangga" di Ragunan dan di Palmerah adalah dua baris `products` dengan `id` berbeda. Nama produk tidak unik.
- `transaction_items.product_id` bisa `NULL` (FK `on delete set null`). `product_name` adalah snapshot saat jual.

## Keputusan

### 1. Endpoint baru `/reports/products*`, `/reports/sales` tidak berubah
Parameter khusus produk (`q`, `sort`, `order`) tidak masuk akal untuk `group_by` lain, jadi laporan produk dipisah ke keluarga endpoint sendiri. `/reports/sales` dan `/dashboard/top-products` tetap seperti sekarang (backward-compatible). Top produk tidak lagi dipakai UI, tapi tidak dihapus.

| Endpoint | Isi |
|---|---|
| `GET /reports/products` | Semua produk pada scope + periode: cup, Rp, % omzet, kategori; produk 0 penjualan ikut; `q`, `sort`, `order` |
| `GET /reports/products/{product_id}` | Ringkasan satu produk + delta periode sebelumnya, Tunai/QRIS, per cabang, per kasir, peringkat |
| `GET /reports/products/{product_id}/series` | Tren cup + Rp per jam/hari, zero-filled |
| `GET /reports/products/export` | XLSX (dan CSV) seluruh daftar dengan filter yang sama, tanpa `q` |

Semua memakai `guards.owner` (owner atau manager), `date_from`/`date_to` (WIB, maks 366 hari), dan `outlet_scope=current|all` lewat `resolveOutletScope` (ADR-0020 §2). Endpoint ini menambah baris **Scope** pada tabel ADR-0020.

### 2. Aturan angka = Ringkasan
- Transaksi dihitung bila `status IN ('paid','void_requested')` (`COUNTED_STATUSES`) dan `deleted_at IS NULL`, berdasarkan `client_created_at` dalam hari bisnis WIB. **`void_requested` tetap dihitung** sampai owner memutuskan, sama dengan `/dashboard/summary` dan keputusan DEAR-155. `voided`, `cancelled`, `pending`, dan transaksi terhapus tidak dihitung.
- Cup (`items_sold`) = `SUM(transaction_items.quantity)`. Semua item dihitung sebagai cup (DEAR-153/154); belum ada penanda produk non-minuman.
- Rp per produk (`revenue`) = `SUM(transaction_items.line_total)`. Diskon/pajak tingkat transaksi tidak dibagi ke item, jadi `totals.revenue` bisa sedikit berbeda dari Omzet Ringkasan bila ada diskon/pajak. `share_pct` = `revenue` produk ÷ `totals.revenue` (seluruh produk pada scope + periode, **sebelum** filter `q`), satu desimal, sehingga total kolom % omzet ≈ 100%.
- Periode sebelumnya = panjang yang sama tepat sebelum periode ini (seperti summary). `*_change_pct` = `null` bila periode sebelumnya 0.

### 3. Kunci produk dan "Semua cabang"
- `outlet_scope=current`: satu baris per `products.id` di outlet aktif. Item tanpa `product_id` dikelompokkan per snapshot nama (`key = "name:<nama>"`, `product_id = null`).
- `outlet_scope=all`: satu baris per **nama produk ternormalisasi** (`lower`, trim, spasi ganda dirapatkan) dari nama katalog saat ini; item tanpa `product_id` memakai snapshot nama. "Jus Mangga" Ragunan + Palmerah menjadi satu baris. `key = "name:<nama ternormalisasi>"`.
- Setiap baris membawa `product_id` perwakilan: produk di outlet aktif bila ada, selain itu produk di outlet dengan kode terkecil; `null` bila tidak ada baris katalog (baris tidak bisa diklik). Nama, kategori, dan `catalog_price` diambil dari produk perwakilan.
- Produk 0 penjualan ikut bila `deleted_at IS NULL AND is_active = true`. Produk terhapus/nonaktif hanya muncul bila ada penjualan di periode.
- Detail `GET /reports/products/{product_id}`: `current` → produk harus milik outlet aktif, selain itu `404`. `all` → produk harus milik salah satu outlet tempat caller owner (`404` bila tidak); angka adalah gabungan semua produk di scope dengan nama ternormalisasi yang sama. Jadi `/?produk=<id>` tetap valid saat pengguna berpindah antara satu cabang dan "Semua cabang".

### 4. Manajer
Server memaksa scope: manager hanya dapat `current` (outlet token), `outlet_scope=all` → `403`, dan produk outlet lain → `404`. `by_outlet` hanya diisi saat `all`, sehingga manager tidak pernah menerima angka cabang lain.

### 5. Performa
Tidak ada pagination: katalog per cabang puluhan baris. Daftar = satu agregat item (join `transactions`) + satu query katalog; detail ≤ 5 agregat paralel (tanpa N+1). "Jam paling laris" ditunda (keputusan DEAR-166); bila nanti dibutuhkan, cukup dihitung dari `series?granularity=hour` tanpa endpoint baru.

## Konsekuensi
- UI cukup menyimpan `product_id` di URL; berpindah scope tidak membuat panel detail rusak.
- Dua produk berbeda dengan nama sama di satu cabang tetap dua baris saat `current`, tetapi digabung saat `all`. Ini disengaja: "Semua cabang" membandingkan menu, bukan baris katalog.
- Ganti nama produk di satu cabang saja akan memecah baris "Semua cabang" sampai nama di cabang lain disamakan.
