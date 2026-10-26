# Backlog Ide Produk — Kelola Kasir

Sumber kebenaran tunggal untuk ide produk. Diperbarui setiap ada ide baru atau keputusan Albert.
Terakhir diperbarui: 2026-10-26 (DEAR-24, discovery fase 2) · Pemilik: Product Manager (Ide & Benchmark)

**Status:** `usulan` → `disetujui` / `ditolak` → `dikerjakan`. Keputusan ada di Albert, diteruskan lewat Chief of Staff. `menunggu keputusan Albert` dipakai untuk kandidat MVP dan ide yang mengubah keputusan terkunci.

**Skor RICE** = R × I × C ÷ E. Semua nilai estimasi PM (belum ada data transaksi nyata). Definisi skala dan rincian tiap ide ada di [discovery-fase2.md §4](discovery-fase2.md#4-backlog-ide-fase-2-rice).

## Kandidat MVP

Effort ≤ 0,5 hari, hanya aplikasi kasir, tanpa perubahan kontrak/DB. Rincian di [discovery-fase2.md §7](discovery-fase2.md#7-kandidat-mvp-keputusan-albert-lewat-chief-of-staff).

| # | Kandidat | Effort (estimasi) | Biaya | Status | Catatan |
|---|---|---|---|---|---|
| K-1 | Tombol "Kirim ringkasan shift ke WhatsApp owner" di layar tutup shift | ±0,5 hari | Gratis | menunggu keputusan Albert | Rekomendasi Chief of Staff: tunda, masuk tepat setelah rilis |
| K-2 | Kalkulator pecahan uang saat input kas aktual tutup shift | ±0,5 hari | Gratis | menunggu keputusan Albert | Rekomendasi Chief of Staff: tunda ke fase 2 |

## Ide Fase 2

| # | Ide | Sudut | R | I | C | E (hari) | Skor | Biaya berjalan | Menyentuh keputusan terkunci? | Status | Konsep |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | HPP & laba kotor per menu | Hemat biaya / laba | 8 | 2 | 80% | 2 | **6,4** | Gratis | Tidak | usulan (top 3) | [concepts/hpp-laba-menu.md](concepts/hpp-laba-menu.md) |
| 2 | Laporan & alert otomatis ke Telegram | Hemat waktu + kebocoran | 10 | 2 | 80% | 3 | **5,3** | Gratis (WA opsional ±US$2/bln, estimasi) | Tidak | usulan (top 3) | [concepts/laporan-alert-telegram.md](concepts/laporan-alert-telegram.md) |
| 3 | Kas keluar/masuk di shift | Kebocoran | 8 | 2 | 80% | 3 | **4,3** | Gratis | Tidak (rumus `expected_cash` berubah) | usulan (top 3) | [concepts/kas-keluar-masuk.md](concepts/kas-keluar-masuk.md) |
| 4 | QRIS dinamis via gateway | Kebocoran | 8 | 2 | 80% | 5 | 2,6 | **Berbayar**: MDR ±0,7% omzet QRIS (vs kemungkinan 0% UMI) | **Ya** | menunggu keputusan Albert | — |
| 5 | Rapor kasir: anomali per pegawai | Kebocoran | 6 | 1 | 80% | 2 | 2,4 | Gratis | Tidak | usulan | — |
| 6 | Prakiraan penjualan besok per menu | Data/AI, hemat biaya | 6 | 1 | 50% | 2 | 1,5 | Gratis | Tidak | usulan | — |
| 7 | Rekonsiliasi QRIS dengan mutasi bank (unggah CSV) | Kebocoran | 6 | 2 | 50% | 4 | 1,5 | Gratis | Tidak | usulan | — |
| 8 | Insight mingguan otomatis (AI) | Data/AI | 4 | 1 | 50% | 2 | 1,0 | Gratis (aturan) atau < US$0,10/bln dengan LLM kecil (estimasi) | Tidak | usulan | — |
| 9 | Diskon/promo sederhana, mis. happy hour (O-11) | Omzet | 5 | 1 | 80% | 4 | 1,0 | Gratis | **Ya** ("belum ada diskon") | usulan | — |
| 10 | Target harian pegawai (jumlah cup, bukan omzet) | Omzet | 8 | 0,5 | 50% | 2 | 1,0 | Gratis | Tidak (pegawai tetap tidak melihat omzet) | usulan | — |
| 11 | Penandaan kanal penjualan (walk-in / GoFood / GrabFood / WA) | Omzet, data | 4 | 1 | 50% | 2 | 1,0 | Gratis | Tidak (tanpa harga per kanal) | usulan | — |
| 12 | Stok bahan baku + resep (O-12) | Hemat biaya | 7 | 2 | 50% | 8 | 0,9 | Gratis | Tidak | usulan | — |
| 13 | Kartu stamp digital via nomor HP (beli 10 gratis 1) | Omzet / repeat | 5 | 2 | 50% | 6 | 0,8 | Gratis (struk); WA per pesan bila notifikasi | **Ya** (hadiah = potongan/gratis) | usulan | — |
| 14 | Menu online + pesan/pre-order via WhatsApp | Omzet | 3 | 1 | 50% | 3 | 0,5 | Gratis (Cloudflare Pages) | Tidak | usulan | — |
| 15 | Buka shift offline "sementara" (R-8) | Keandalan | 2 | 1 | 80% | 4 | 0,4 | Gratis | **Ya** ("buka shift wajib online") | usulan | — |

## Rekomendasi Saat Ini

Ide #1, #2, #3 (total ±8 hari-orang, estimasi), urutan eksekusi **C → B → A** (#3 → #2 → #1) supaya alert selisih kas di #2 tidak memicu *false alarm*. Alasan lengkap di [discovery-fase2.md §5](discovery-fase2.md#5-prioritas--rekomendasi-3-ide-teratas).

## Riwayat Keputusan

| Tanggal | Item | Keputusan | Oleh |
|---|---|---|---|
| 2026-10-26 | Backlog awal (15 ide + K-1/K-2) dari discovery fase 2 | Diusulkan, menunggu pilihan Albert | PM |
