ADR-0010 — Cetak struk thermal ESC/POS 58 mm di aplikasi kasir; produk tanpa varian

Status: Accepted · Tanggal: 2026-10-26 (keputusan owner D-3 dan "tanpa opsi produk", DEAR-5/DEAR-6)

## Konteks
Owner memutuskan cetak struk thermal Bluetooth menjadi Must: ada toggle "Cetak struk" di layar Cash dan QRIS, cetak ulang, dan layar Printer (K-12) untuk pindai/hubungkan/cetak tes. Header/footer struk diatur owner. Owner juga memutuskan produk tidak punya varian/opsi (ukuran, gula, es, topping); satu produk = satu harga. Aplikasi kasir offline-first (ADR-0003), jadi struk harus tetap bisa dicetak tanpa internet.

## Keputusan
- **Cetak dari aplikasi kasir**, bukan dari server: modul native Bluetooth Classic (SPP) di Expo dev build, printer ESC/POS 58 mm (32 kolom). Dibungkus antarmuka `ReceiptPrinter` (`scan`, `connect`, `printLines`, `printTest`) supaya library bisa diganti setelah uji printer nyata (M-11).
- **Isi struk diformat di klien** dari SQLite (transaksi) + pengaturan toko tersinkron (`display_name`, `address`, `phone`, `receipt_header`, `receipt_footer`). Formatter berupa fungsi murni dan di-unit-test. `GET /v1/transactions/{id}/receipt` tetap ada untuk struk digital, cetak ulang lintas perangkat, dan pratinjau dashboard.
- **Cetak tidak pernah memblokir transaksi**: transaksi disimpan dulu, lalu dicetak. Gagal cetak → banner + "Coba lagi"/"Lewati"; cetak ulang diberi tanda `CETAK ULANG`.
- **Tanpa varian**: tabel `option_groups`, `options`, `product_option_groups`, `transaction_item_options` dihapus; `products.price` tunggal; item transaksi = produk + qty + snapshot `product_name`/`unit_price`.

## Alternatif
- Cetak lewat server/print service: tidak jalan saat offline dan butuh jaringan lokal ke printer.
- Web Bluetooth/PWA: dukungan Bluetooth Classic tidak ada; printer 58 mm murah umumnya hanya SPP.
- Mempertahankan model varian "untuk nanti": menambah kompleksitas UI/API yang tidak dipakai; bisa ditambah lagi lewat ADR baru bila dibutuhkan.

## Konsekuensi
- (+) Struk tercetak walau offline; alur cash tetap 3 tap.
- (+) Model data dan UI katalog lebih sederhana (M-7, F-5 dihapus).
- (−) Butuh printer uji fisik dan QA di perangkat nyata (Q-D); variasi merek printer (R-6).
- (−) Izin Bluetooth Android 12+ (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`) harus ditangani dengan baik.
