ADR-0007 — Pembayaran QRIS lewat abstraksi PaymentProvider

Status: Proposed · Tanggal: 2026-10-26 · Terkait: PRD D-1

## Konteks
D-1 belum diputuskan owner; rekomendasi PRD: MVP pakai QRIS statis toko (konfirmasi manual pegawai), arsitektur siap QRIS dinamis (Midtrans/Xendit) yang otomatis mendeteksi lunas. Alur kasir tidak boleh berubah saat pindah mode.

## Keputusan
- Interface `PaymentProvider { name, confirmationMode, createCharge, getStatus, cancel, parseWebhook? }` di modul `payments`.
- Implementasi MVP: `StaticQrisProvider` (`confirmation_mode=manual`), memakai payload QRIS statis dari pengaturan toko; opsional menyisipkan nominal (tag EMVCo 54 + CRC16 ulang) setelah lolos uji lintas aplikasi pembayaran.
- Fase 2: `MidtransQrisProvider` / `XenditQrisProvider` (`confirmation_mode=auto`) + `POST /v1/webhooks/payments/{provider}` dengan verifikasi signature dan idempotensi `provider_ref`.
- Pemilihan provider per outlet lewat `outlet_settings.qris_mode`.
- Kontrak API ke kasir identik: `POST /v1/transactions` (method `qris`) → `payment{id, status, qr_payload, confirmation_mode, expires_at}` → `POST /v1/payments/{id}/confirm` (manual) atau polling `GET /v1/payments/{id}` (auto) → `POST /v1/payments/{id}/cancel`.
- Transaksi QRIS dibuat `pending`; kedaluwarsa 15 menit → `cancelled` (payment `expired`).
- Kredensial gateway hanya di environment variable platform.

## Alternatif
- Langsung integrasi gateway di MVP: butuh verifikasi merchant & MDR sebelum owner memutuskan.
- Tanpa abstraksi (if/else di controller): migrasi fase 2 akan menyentuh alur kasir.

## Konsekuensi
- (+) Ganti mode = ubah setting, tanpa rilis aplikasi kasir.
- (−) Mode statis rawan salah konfirmasi → mitigasi audit + laporan QRIS manual per shift.
