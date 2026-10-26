ADR-0009 — Satu shift aktif per gerai, tutup shift offline

Status: Accepted · Tanggal: 2026-10-26 (keputusan owner Q-3/Q-4, DEAR-6)

## Konteks
TDD v1 mengusulkan satu shift per perangkat. Owner memutuskan: satu shift aktif per gerai; pegawai lain boleh login di shift yang sama dan setiap transaksi dicatat atas nama kasirnya; serah terima = tutup lalu buka shift (Q-4). Tutup shift boleh dilakukan saat offline dengan peringatan keras dan disinkron belakangan (Q-3). Kas fisik di gerai satu laci, sehingga rekonsiliasi per gerai lebih sesuai daripada per perangkat.

## Keputusan
- `shifts` tidak lagi terikat ke satu perangkat: kolom `opened_device_id`/`closed_device_id` hanya informasi. Unique partial index `shifts (outlet_id) WHERE status = 'open'` menjamin satu shift terbuka per outlet.
- **Buka shift wajib online** (`POST /v1/shifts`). Bila sudah ada shift terbuka → `409 SHIFT_ALREADY_OPEN`; aplikasi bergabung ke shift tersebut. Shift aktif juga dikirim lewat `current_shift` di `/v1/sync/pull`.
- `transactions.employee_id` = pegawai yang login saat transaksi dibuat. Ringkasan shift memuat rincian per kasir (`by_employee`).
- **Tutup shift** bisa online (`POST /v1/shifts/{id}/close`) atau offline (mutasi `shift.close` di outbox, `closed_offline=true`). Server menghitung ulang ringkasan saat menerapkan penutupan; `expected_cash` hanya memakai transaksi dengan `client_created_at ≤ closed_at`.
- Transaksi offline yang tiba setelah shift ditutup **tetap diterima** (penjualan nyata tidak dibuang). Bila dibuat setelah `closed_at`, transaksi ditandai `after_shift_close` dan dilaporkan di `late_transaction_count`/`late_cash_amount`. `POST /v1/transactions` online ke shift yang sudah tutup tetap ditolak `SHIFT_CLOSED`.

## Alternatif
- Shift per perangkat (TDD v1): rekonsiliasi kas tidak cocok dengan satu laci kas bersama; ditolak owner.
- Buka shift juga boleh offline: berisiko dua shift terbuka bersamaan dan butuh logika penggabungan. Ditunda ke fase 2 bila R-8 sering terjadi.
- Menolak transaksi yang tiba setelah shift tutup: menghilangkan penjualan nyata; tidak dapat diterima.

## Konsekuensi
- (+) Satu laci kas = satu rekonsiliasi; serah terima jelas.
- (+) Transaksi tetap tercatat per kasir.
- (−) Tidak bisa mulai berjualan bila internet mati sebelum shift dibuka (R-8). Mitigasi: data seluler sebagai cadangan.
- (−) Ringkasan shift yang ditutup offline bisa berubah setelah sinkron; UI wajib menampilkan peringatan dan status "menunggu sinkron".
