ADR-0003 — Aplikasi kasir: React Native (Expo) offline-first dengan SQLite + outbox

Status: Proposed · Tanggal: 2026-10-26

## Konteks
Kasir dipakai di Android tablet/HP (asumsi D-2). Target < 300 ms per tap dan transaksi ≤ 15 detik. Transaksi cash harus tetap bisa dibuat saat internet putus (P-13, Should), QRIS butuh online. Perlu akses Bluetooth untuk printer thermal (P-08, opsional, D-3).

## Keputusan
- **React Native via Expo** (SDK terbaru, *development build* — bukan Expo Go — agar modul native Bluetooth ESC/POS bisa dipakai).
- Penyimpanan lokal **SQLite** (`expo-sqlite`) dengan Drizzle; token di `expo-secure-store` (Android Keystore).
- Pola **local-first untuk katalog, outbox untuk mutasi**:
  - Katalog, opsi, pegawai aktif, pengaturan toko disalin ke SQLite via `GET /v1/sync/pull` (cursor), tiap 30 detik saat online + saat app ke foreground.
  - Transaksi cash, buka/tutup shift, void request ditulis ke SQLite + tabel `outbox` dalam satu transaksi lokal, lalu dikirim oleh sync worker ke `POST /v1/sync/push` (batch ≤ 50, retry backoff eksponensial).
  - Saat online, transaksi tetap lewat outbox (satu jalur kode); QRIS memakai `POST /v1/transactions` langsung karena butuh server.
- State UI: Zustand untuk keranjang; TanStack Query untuk data server online (riwayat, ringkasan shift).
- Distribusi: EAS Build (APK internal / Play internal testing) + EAS Update.

## Alternatif
- Flutter: performa setara, tetapi bahasa terpisah (Dart) → tidak berbagi `packages/contracts`/`money` dengan API & dashboard.
- PWA: termurah, tetapi akses Bluetooth printer & penyimpanan offline andal di Android kurang konsisten; kiosk mode lebih sulit.
- Native Kotlin: paling andal untuk hardware, tetapi biaya pengembangan tertinggi dan tidak berbagi kode.
- WatermelonDB/PowerSync: sync engine siap pakai, tetapi menambah ketergantungan/biaya; kebutuhan sync kita sederhana (katalog read-only + transaksi append-only).

## Konsekuensi
- (+) Kode bersama dengan API (kalkulasi harga identik), satu bahasa untuk tim.
- (+) Bisa ke iPad nanti tanpa rewrite (jika D-2 berubah).
- (−) Butuh dev build & EAS untuk modul native; QA harus uji di perangkat nyata.
- (−) Sync dibangun sendiri → wajib integration test skenario offline/duplikat (Q-B, Q-D).
