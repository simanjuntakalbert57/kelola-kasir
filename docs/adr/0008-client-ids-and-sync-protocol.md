ADR-0008 — ID dari klien (UUIDv7), nomor transaksi per perangkat, protokol sync

Status: Proposed · Tanggal: 2026-10-26

## Konteks
Transaksi cash dan shift bisa dibuat offline lalu dikirim ulang berkali-kali (jaringan putus di tengah request). Nomor transaksi harus unik (PRD §5) tanpa bertanya ke server. Katalog harus sampai ke kasir < 1 menit setelah owner mengubahnya.

## Keputusan
- **ID**: `shifts.id`, `transactions.id`, `transaction_items.id`, `payments.id`, `void_requests.id` dibuat di klien sebagai **UUIDv7** (terurut waktu, aman untuk indeks). Server memakai `INSERT ... ON CONFLICT (id) DO NOTHING` → push idempoten.
- **Nomor transaksi**: `{outlet.code}-{device.code}-{YYMMDD WIB}-{seq 4 digit}`; `seq` counter lokal per perangkat per hari disimpan di SQLite. Unik `(outlet_id, number)`. Bila tabrakan (mis. reinstall app di hari yang sama), server menolak item dengan `NUMBER_CONFLICT`; klien menaikkan seq (berlanjut dari `last_number` yang dikembalikan `/devices/pair` & `/sync/pull`).
- **Pull**: semua tabel katalog punya `updated_seq BIGINT` dari satu sequence global yang di-set trigger pada insert/update; hapus = soft delete (`deleted_at`). `GET /v1/sync/pull?cursor=` mengembalikan perubahan dengan `updated_seq > cursor`, maksimal 500 baris per halaman, plus `next_cursor` dan `has_more`.
- **Push**: `POST /v1/sync/push { mutations: [{ id, type, payload, client_created_at }] }`, `type ∈ shift.open | transaction.create | shift.close | void_request.create | product.mark_sold_out`. Server memproses berurutan dalam satu transaksi DB per mutasi dan membalas status per mutasi: `applied | duplicate | rejected{code}`. Klien menghapus dari outbox kecuali `rejected` (ditampilkan ke pegawai/di-flag).
- **Validasi server**: total & kalkulasi dihitung ulang dari snapshot klien (harus konsisten). Bila harga snapshot ≠ harga katalog saat ini → diterima + `price_mismatch=true` + audit `sync.price_mismatch`. Penjualan nyata tidak ditolak.

## Alternatif
- Nomor dari server (sequence): tidak bisa offline.
- Sync engine pihak ketiga (PowerSync/ElectricSQL): kuat, tetapi menambah biaya & kompleksitas untuk pola append-only sederhana.
- Last-write-wins dua arah: tidak dibutuhkan; kasir tidak mengubah katalog kecuali status habis (operasi idempoten).

## Konsekuensi
- (+) Kirim ulang aman, tidak ada transaksi ganda.
- (+) Satu jalur kode online/offline untuk cash.
- (−) Nomor transaksi tidak berurutan global antar perangkat (berurutan per perangkat) — dapat diterima untuk struk.
