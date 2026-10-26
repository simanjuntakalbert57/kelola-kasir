# Discovery Fase 2 — Kelola Kasir (Gerai Jus)

Status: usulan (menunggu keputusan Albert) · Penyusun: Product Manager (Ide & Benchmark) · Tanggal: 2026-10-26 · Issue: DEAR-24
Sumber internal: PRD v1 (DEAR-3), `docs/tdd.md` v1.2, `docs/design/README.md`, `docs/qa/test-plan.md`, `apps/api/src/lib/qris.ts`, `apps/api/src/modules/shifts/summary.ts`.

## 1. Ringkasan Eksekutif

- **Tema fase 2 yang direkomendasikan: "tahu untung, kendalikan uang tunai, tanpa harus buka dashboard".** MVP sudah menjawab *berapa omzet*. Fase 2 sebaiknya menjawab *berapa untungnya, ke mana uang laci pergi, dan apa yang janggal hari ini*. Semuanya bisa dibangun tanpa biaya hosting tambahan.
- **3 ide teratas (RICE tertinggi, semuanya gratis):** (A) **HPP & laba kotor per menu**, skor 6,4, ±2 hari; (B) **laporan & alert otomatis ke Telegram** (tutup shift, selisih kas, void, rekap 22.00), skor 5,3, ±3 hari; (C) **kas keluar/masuk di shift** supaya belanja es/buah dari laci tidak terbaca sebagai selisih, skor 4,3, ±3 hari. Ketiganya tidak menyentuh keputusan terkunci, dan aplikasi kasir hanya berubah di C.
- **Celah pasar yang bisa kita isi:** Majoo menjual laporan closing ke WhatsApp sebagai add-on **Rp499.000/outlet/bulan**, dan HPP baru tersedia di paket Rp499.000/bulan. Telegram Bot API gratis, jadi pola yang sama bisa kita berikan dengan biaya US$0.
- **Peringatan soal QRIS dinamis:** sejak 1 Des 2024 MDR QRIS untuk usaha mikro (UMI) **0% untuk transaksi ≤ Rp500.000**, sedangkan gateway seperti Midtrans mengenakan **0,7%**. Pindah ke QRIS dinamis bisa mengubah biaya dari Rp0 menjadi ±0,7% omzet QRIS. Karena itu ide ini saya taruh di peringkat 4 dan menunggu data porsi QRIS serta status UMI toko.
- **2 kandidat MVP (≤ 0,5 hari, hanya di aplikasi kasir, tanpa ubah kontrak):** tombol **"Kirim ringkasan shift ke WhatsApp owner"** dan **kalkulator pecahan uang** di layar tutup shift. Keputusan tetap di Albert lewat Chief of Staff, dan keduanya aman untuk dilewati bila jadwal 2 Nov ketat.

## 2. Konteks & Batasan

**Pengguna**
- **Albert (owner)**: satu gerai jus. Memantau dari dashboard web (sering dari HP), belanja buah sendiri atau lewat pegawai. Waktunya terbatas karena mengurus operasional.
- **Pegawai kasir**: 1–3 orang bergantian shift, memakai HP Android portrait dan printer Bluetooth RPP02N. Mereka butuh alur cepat (Cash 3 tap) dan tidak boleh melihat omzet keseluruhan (PRD §5).

**Kondisi produk saat MVP rilis (±2 Nov 2026)**: katalog satu harga, Cash/QRIS statis dengan konfirmasi manual (nominal sudah disisipkan ke QR lewat tag 54, `apps/api/src/lib/qris.ts`), offline-first untuk cash, satu shift per gerai dengan hitung selisih kas, void dengan persetujuan owner, dashboard omzet, ekspor CSV/XLSX, struk thermal dan struk WhatsApp. Hosting gratis (Render Free, Neon Free, Cloudflare Pages/R2).

**Celah yang sudah tercatat di PRD/TDD dan menjadi bahan fase 2**: O-11 diskon/promo, O-12 stok bahan baku dan resep, R-1/R-2 rekonsiliasi QRIS manual, R-8 buka shift wajib online, QRIS dinamis (§5.4), dan loyalti/member serta GoFood/GrabFood yang masuk "di luar lingkup MVP" (PRD §3.3).

**Batasan yang dijaga di semua ide** (keputusan terkunci): satu produk satu harga tanpa varian; QRIS statis dengan konfirmasi manual sampai Albert memutuskan pindah ke dinamis; kasir offline-first dengan alur Cash 3 tap; buka shift wajib online dan satu shift aktif per gerai; hosting tetap gratis kecuali Albert menyetujui biaya; belum ada pajak/diskon. Ide yang menyentuh salah satu batasan ini ditandai jelas di backlog.

**Keterbatasan dokumen ini**: belum ada data transaksi nyata karena MVP belum rilis. Semua angka Reach/Impact/Effort adalah **estimasi PM**, bukan data pasar. Pertanyaan di §8 dibuat untuk mengisi celah itu.

## 3. Benchmarking

Legenda verifikasi: ✅ = halaman resmi; ⚠️ = sumber pihak ketiga; ❓ = belum terverifikasi atau asumsi PM. Harga per outlet per bulan tanpa PPN, kecuali disebut lain. Riset dilakukan 26 Okt 2026, jadi harga bisa sudah berubah.

### 3.1 Kompetitor POS

| Produk | Fitur/Pola | Adaptasi untuk kita | Verif. | Sumber |
|---|---|---|---|---|
| **Majoo** | Resep & bahan baku di semua paket; **HPP (rata-rata) mulai paket Advance Rp499.000**; laporan closing & rekonsiliasi kasir di semua paket; **add-on "Integrasi Laporan WhatsApp" Rp499.000/outlet/bulan** (laporan penjualan + closing otomatis) | HPP ringan per menu tanpa resep lengkap (Konsep A). Laporan closing ke chat lewat Telegram gratis (Konsep B). Kalau harus WhatsApp, biayanya hanya per pesan, bukan paket. | ✅ | [1] |
| **Moka (GoTo)** | Paket Rp299.000 / Rp499.000 / Rp799.000; "Manajemen Bahan Baku", loyalty, struk email/SMS | Patokan harga: fitur yang dijual Moka sebagai paket berbayar bisa kita bangun bertahap untuk satu gerai. Belum terverifikasi paket mana yang memuat fitur apa. | ✅ harga, ❓ per paket | [2] |
| **Loyverse** | Gratis: stok item **dan komponen** + peringatan stok menipis, loyalty, struk email yang **diantre saat offline**; shift dengan kas seharusnya vs kas dihitung, ditambah **Pay In / Pay Out** | Pola Pay In/Out diadaptasi menjadi kas keluar/masuk berkategori, bisa offline lewat outbox (Konsep C). Pola stok komponen untuk ide stok bahan (#12). | ✅ | [3][4][5] |
| **Pawoon** | Tier gratis dibatasi 7 transaksi/hari; Basic ±Rp149.000, Pro ±Rp299.000 | Hanya konteks harga. Halaman resmi menolak akses (403). | ⚠️ | [6] |
| **Olsera** | Katalog website di paket Premium; online ordering, marketplace, self order di paket Pro (Rp1,99–2,69 juta/tahun harga promo) | Menu online statis + tombol pesan via WhatsApp (#14) tanpa membangun toko online. | ✅ | [7] |
| **Square** | Square AI: asisten percakapan di dashboard dan aplikasi, memakai data **cuaca**, event lokal, dan ulasan untuk keputusan menu/stok. Square Loyalty mulai US$45/lokasi/bulan | Insight mingguan otomatis (#8). Cuaca relevan untuk jus, tetapi pengaruhnya ke penjualan masih **hipotesis**. Loyalty cukup kartu stamp berbasis nomor HP (#13), tidak perlu sistem poin. | ✅ | [8][9][10] |
| **Toast** | Toast IQ (Okt 2025): asisten AI yang bisa bertindak dari chat (tandai menu habis, ubah harga). Prompt nomor satu pengguna adalah **daily briefing**; 26% resto bertanya soal optimasi menu. Recipe costing (xtraCHEF) dengan laporan margin per produk | Rekap harian otomatis (Konsep B) menjawab kebutuhan *daily briefing*. Nanti: aksi dari chat (approve void, tandai habis). Laporan margin per produk (Konsep A). | ✅ | [11][12][13] |
| **Opaper** (ID) | Laporan shift dengan saldo awal dan setoran tutup | Konfirmasi bahwa laporan shift adalah standar; diferensiasi kita ada di alert dan kas keluar. | ✅ | [14] |

### 3.2 Produk non-POS & regulasi

| Produk | Fitur/Pola | Adaptasi untuk kita | Verif. | Sumber |
|---|---|---|---|---|
| **Paloma365 / Poster POS** (luar ID) | Bot Telegram gratis untuk omzet harian dan alert risiko | Pola langsung untuk Konsep B. Tidak ditemukan POS Indonesia yang mengirim laporan ke Telegram, jadi ini peluang diferensiasi. | ✅ | [15][16] |
| **Telegram Bot API** | Gratis; batas ±1 pesan/detik per chat | Kanal notifikasi default (US$0). | ✅ | [17] |
| **WhatsApp Cloud API** | Tarif per pesan sejak 1 Jul 2025. **Mulai 1 Okt 2026** pesan utility di dalam jendela layanan ikut dikenai biaya. Tarif Indonesia pihak ketiga: utility ±US$0,0288, marketing ±US$0,0473 | WhatsApp jadi kanal opsional berbayar. Estimasi 2 pesan/hari ≈ 60 pesan/bulan ≈ US$1,7/bulan (**estimasi** dari tarif yang belum terverifikasi). | ✅ aturan, ⚠️ tarif | [18][19] |
| **WhatsApp Business app** | Katalog ±500 item, quick replies, broadcast 256 penerima | Albert bisa memakai broadcast manual untuk promo tanpa API. Ide #14 mengarahkan pesanan ke chat WhatsApp gerai. | ⚠️ | [20] |
| **Kopi Kenangan** | Poin cashback dari order di app atau **scan QR di kasir**; pre-order dengan pilihan jam ambil dan area pickup | Stamp dikumpulkan lewat nomor HP yang diinput kasir, tanpa app pelanggan (#13). Pre-order lewat WhatsApp (#14). Dua sumber resmi berbeda soal nama/struktur poin. | ✅/⚠️ | [21][22] |
| **Fore Coffee** | Order via app untuk pickup/delivery | Konfirmasi pola pre-order. Detail tier poin belum terverifikasi. | ✅/❓ | [23] |
| **GoBiz / GrabMerchant** | Promo per item (GoBiz, sumber tidak resmi); laporan settlement harian (halaman Grab Malaysia) | Penandaan kanal penjualan (#11) dan pola laporan settlement untuk rekonsiliasi (#7). | ⚠️ | [24][25] |
| **Bank Indonesia – MDR QRIS** | **0% untuk usaha mikro (UMI) pada transaksi ≤ Rp500.000** sejak 1 Des 2024. Merchant non-UMI 0,7%. MDR tidak boleh dibebankan ke pembeli | Dengan transaksi jus yang kecil, QRIS statis toko UMI kemungkinan **Rp0**. Ini menurunkan prioritas QRIS dinamis berbayar (#4). Rilis resmi BI belum ditemukan, jadi angka ini dari pemberitaan. | ⚠️ | [26][27] |
| **Midtrans / Xendit** | Midtrans QRIS 0,7% + webhook bertanda tangan `signature_key`. Xendit QR dinamis dengan `callback_url`, settlement T+2 hari kerja (biaya belum terverifikasi) | Implementasi `PaymentProvider` mode `auto` (TDD §5.4) sudah siap secara arsitektur. Keputusan utamanya ada di biaya dan settlement. | ✅ | [28][29][30] |
| **Google Sheets / Looker Studio** | Owner kecil biasanya mengolah ekspor di spreadsheet | Ekspor CSV/XLSX sudah ada di MVP (O-03). Nanti bisa ditambah tautan CSV terjadwal untuk Looker Studio. Tidak diriset, jadi ini **asumsi PM** dan masuk catatan saja, bukan ide prioritas. | ❓ | — |

**Kesimpulan benchmarking**
1. **HPP, laporan ke chat, dan rekonsiliasi kas adalah fitur berbayar** di POS lokal (Majoo Rp499.000/bulan per fitur/paket). Untuk satu gerai, kita bisa membangun versi ringannya dengan biaya US$0.
2. **AI di POS global dimulai dari *daily briefing*, bukan chatbot.** Rekap harian yang baik lebih bernilai dulu daripada asisten tanya-jawab.
3. **Loyalty kompetitor biasanya butuh app pelanggan atau paket mahal.** Untuk gerai jus tunggal, kartu stamp lewat nomor HP sudah cukup, tetapi nilainya bergantung pada porsi pelanggan langganan (belum ada data).
4. **QRIS dinamis tidak gratis**, sementara QRIS statis untuk UMI kemungkinan 0%. Masalah "salah konfirmasi" bisa ditekan dulu dengan alert dan rekonsiliasi.

## 4. Backlog Ide Fase 2 (RICE)

**Cara membaca skor.** Skor = R × I × C ÷ E. Semua nilai estimasi PM, dan hanya berguna untuk membandingkan ide di daftar ini.
- **R (Reach)**: seberapa sering fitur terasa di operasional gerai, skala 1–10 (10 = setiap hari dipakai/terasa oleh owner atau semua transaksi).
- **I (Impact)**: 3 = sangat besar, 2 = besar, 1 = sedang, 0,5 = kecil, 0,25 = minimal.
- **C (Confidence)**: 100% / 80% / 50%. Rendah bila bergantung pada data yang belum ada (mis. porsi pelanggan langganan).
- **E (Effort)**: hari-orang engineering total (BE + Mobile + FE + QA), estimasi kasar.

Kolom **Arsitektur** merujuk pada sistem sekarang: kasir offline-first (SQLite + outbox), monorepo TypeScript, kontrak `docs/api/openapi.yaml`. Kolom **Biaya** = biaya berjalan per bulan.

### 4.1 Tabel RICE (urut skor)

| # | Ide | Sudut | R | I | C | E (hari) | Skor | Biaya berjalan | Menyentuh keputusan terkunci? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **HPP & laba kotor per menu** | Hemat biaya / laba | 8 | 2 | 80% | 2 | **6,4** | Gratis | Tidak |
| 2 | **Laporan & alert otomatis ke Telegram** | Hemat waktu + kebocoran | 10 | 2 | 80% | 3 | **5,3** | Gratis (WA opsional ±US$2/bln, estimasi) | Tidak |
| 3 | **Kas keluar/masuk di shift** | Kebocoran | 8 | 2 | 80% | 3 | **4,3** | Gratis | Tidak (rumus `expected_cash` berubah) |
| 4 | QRIS dinamis via gateway | Kebocoran | 8 | 2 | 80% | 5 | 2,6 | **Berbayar**: MDR 0,7% omzet QRIS (vs kemungkinan 0% UMI) | **Ya**, butuh keputusan Albert (direncanakan fase 2) |
| 5 | Rapor kasir: anomali per pegawai | Kebocoran | 6 | 1 | 80% | 2 | 2,4 | Gratis | Tidak |
| 6 | Prakiraan penjualan besok per menu | Data/AI, hemat biaya | 6 | 1 | 50% | 2 | 1,5 | Gratis | Tidak |
| 7 | Rekonsiliasi QRIS dengan mutasi bank (unggah CSV) | Kebocoran | 6 | 2 | 50% | 4 | 1,5 | Gratis | Tidak |
| 8 | Insight mingguan otomatis (AI) | Data/AI | 4 | 1 | 50% | 2 | 1,0 | Gratis (aturan) atau < US$0,10/bln dengan LLM kecil (estimasi) | Tidak |
| 9 | Diskon/promo sederhana, mis. happy hour (O-11) | Omzet | 5 | 1 | 80% | 4 | 1,0 | Gratis | **Ya** ("belum ada diskon") |
| 10 | Target harian pegawai (jumlah cup, bukan omzet) | Omzet | 8 | 0,5 | 50% | 2 | 1,0 | Gratis | Tidak, tetapi perlu dijaga agar pegawai tidak melihat omzet (PRD §5) |
| 11 | Penandaan kanal penjualan (walk-in / GoFood / GrabFood / WA) | Omzet, data | 4 | 1 | 50% | 2 | 1,0 | Gratis | Tidak (tanpa harga per kanal) |
| 12 | Stok bahan baku + resep (O-12) | Hemat biaya | 7 | 2 | 50% | 8 | 0,9 | Gratis | Tidak |
| 13 | Kartu stamp digital via nomor HP (beli 10 gratis 1) | Omzet / repeat | 5 | 2 | 50% | 6 | 0,8 | Gratis (struk); WA per pesan bila notifikasi | **Ya** (hadiah = potongan/gratis) |
| 14 | Menu online + pesan/pre-order via WhatsApp | Omzet | 3 | 1 | 50% | 3 | 0,5 | Gratis (Cloudflare Pages) | Tidak |
| 15 | Buka shift offline "sementara" (R-8) | Keandalan | 2 | 1 | 80% | 4 | 0,4 | Gratis | **Ya** ("buka shift wajib online") |

Catatan skor: E sudah termasuk QA. Ide yang menyentuh alur uang (3, 4, 7, 9, 13) diberi effort lebih besar karena butuh test case P0 baru (test plan §10).

### 4.2 Rincian per ide

**#1 HPP & laba kotor per menu**: konsep lengkap di [concepts/hpp-laba-menu.md](concepts/hpp-laba-menu.md).
- *Masalah*: owner tahu omzet, tetapi tidak tahu laba per menu. Harga buah berfluktuasi.
- *Solusi*: field HPP per produk, snapshot di item transaksi, laba kotor dan margin di dashboard dan laporan.
- *Referensi*: Majoo HPP (paket Rp499.000), Toast recipe costing.
- *Arsitektur*: 2 kolom baru dan field di kontrak owner. Kasir dan sync tidak berubah.
- *Risiko*: HPP yang diisi asal-asalan membuat laba menyesatkan. Mitigasi: tampilkan cakupan HPP dan pengingat pembaruan.

**#2 Laporan & alert otomatis ke Telegram**: konsep lengkap di [concepts/laporan-alert-telegram.md](concepts/laporan-alert-telegram.md).
- *Masalah*: owner harus aktif membuka dashboard. Selisih kas dan void baru ketahuan belakangan.
- *Solusi*: bot Telegram yang mengirim ringkasan tutup shift, alert, dan rekap harian.
- *Referensi*: add-on WhatsApp Majoo Rp499.000/bulan, daily briefing Toast IQ, bot Paloma365.
- *Arsitektur*: kirim berbasis event saat request diproses, rekap harian lewat GitHub Actions cron (pola backup). Tabel `notification_channels` dan `notification_log`. Kasir tidak berubah.
- *Risiko*: API Render tidur (cold start) saat cron; token bot bocor karena repo publik. Mitigasi: timeout panjang di cron, token hanya di secret env.

**#3 Kas keluar/masuk di shift**: konsep lengkap di [concepts/kas-keluar-masuk.md](concepts/kas-keluar-masuk.md).
- *Masalah*: uang laci untuk belanja es/buah terbaca sebagai selisih minus.
- *Solusi*: catatan kas keluar/masuk berkategori yang bisa dibuat offline dan masuk ke `expected_cash`.
- *Referensi*: Loyverse Pay In/Pay Out, closing kasir Majoo.
- *Arsitektur*: mutasi outbox baru, tabel `cash_movements`, rumus ringkasan shift berubah, 1 sheet baru di kasir.
- *Risiko*: pegawai menyamarkan kebocoran sebagai "pengeluaran". Mitigasi: foto nota, alert Telegram, rekap per kategori.

**#4 QRIS dinamis via gateway**
- *Masalah*: konfirmasi manual rawan salah atau fraud (R-1).
- *Solusi*: provider Midtrans/Xendit dengan webhook. Layar kasir sudah mendukung mode `auto`.
- *Referensi*: TDD §5.4, dokumentasi Midtrans/Xendit.
- *Arsitektur*: sudah disiapkan (`PaymentProvider`), tinggal provider + webhook + verifikasi merchant.
- *Biaya*: 0,7% per transaksi (Midtrans). Dengan QRIS statis UMI kemungkinan 0% untuk transaksi ≤ Rp500.000. Sebagai ilustrasi saja: omzet QRIS Rp10 juta/bulan → ±Rp70.000/bulan. Settlement T+1/T+2 juga memengaruhi arus kas.
- *Risiko*: biaya rutin dan ketergantungan pada gateway. Jalankan ide #2, #5, dan #7 dulu untuk mengukur seberapa sering salah konfirmasi terjadi, lalu putuskan berdasarkan data.

**#5 Rapor kasir: anomali per pegawai**
- *Masalah*: pola kebocoran (void sering, QRIS dibatalkan, selisih berulang) tersebar di beberapa layar.
- *Solusi*: satu tabel per pegawai berisi transaksi, void, QRIS dibatalkan, QRIS manual, dan rata-rata selisih kas, dengan penanda di atas ambang.
- *Referensi*: pola laporan per pegawai di POS umum, alert risiko Paloma365.
- *Arsitektur*: query agregat dari data yang sudah ada, 1 endpoint laporan dan 1 halaman dashboard.
- *Risiko*: bisa terasa menuduh pegawai. Mitigasi: hanya terlihat oleh owner, dengan bahasa netral.

**#6 Prakiraan penjualan besok per menu**
- *Masalah*: belanja buah berdasarkan feeling, sehingga bisa sisa busuk atau kehabisan.
- *Solusi*: perkiraan jumlah cup per menu untuk besok, dari rata-rata hari yang sama dalam 4 minggu terakhir, dikirim di rekap harian (#2). Bila resep (#12) sudah ada, berubah menjadi daftar belanja.
- *Referensi*: Square AI (cuaca, event), Toast IQ.
- *Arsitektur*: perhitungan statistik sederhana di API, tanpa ML dan tanpa biaya.
- *Risiko*: data < 4 minggu belum akurat. Butuh minimal 4–6 minggu data MVP.

**#7 Rekonsiliasi QRIS dengan mutasi bank**
- *Masalah*: owner mencocokkan QRIS manual dengan mutasi bank satu per satu (R-2).
- *Solusi*: owner mengunggah CSV mutasi atau laporan merchant QRIS, lalu sistem mencocokkan nominal dan waktu (±10 menit) dan menandai yang tidak cocok.
- *Referensi*: laporan settlement GrabMerchant.
- *Arsitektur*: endpoint unggah dan parser per format bank. Format mutasi tiap bank berbeda, jadi butuh contoh file dari Albert.
- *Risiko*: nominal yang sama di waktu berdekatan sulit dibedakan. Confidence rendah sampai format bank diketahui.

**#8 Insight mingguan otomatis (AI)**
- *Masalah*: owner tidak sempat membaca grafik.
- *Solusi*: setiap Senin dikirim 3–5 kalimat insight (menu naik/turun, jam ramai, margin), dibuat dari angka yang sudah dihitung. Versi awal berbasis aturan, versi lanjut memakai LLM kecil hanya untuk merangkai kalimat. Angka tetap dihitung kode, bukan LLM.
- *Referensi*: Square AI, Toast IQ.
- *Arsitektur*: lanjutan dari #2, tanpa perubahan kasir.
- *Biaya*: versi aturan gratis. Versi LLM diperkirakan < US$0,10/bulan untuk 4 panggilan (estimasi PM).
- *Risiko*: halusinasi bila LLM diberi data mentah. Mitigasi: LLM hanya menerima angka teragregasi, dan setiap angka di pesan divalidasi ulang oleh kode.

**#9 Diskon/promo sederhana (O-11)**
- *Masalah*: tidak ada alat untuk mendorong jam sepi.
- *Solusi*: promo per transaksi (persen/nominal) atau happy hour terjadwal.
- *Referensi*: promo GoBiz.
- *Arsitektur*: kolom `discount_amount` sudah ada (TDD A-3), tetapi kasir perlu UI dan aturan offline. Alur Cash 3 tap harus tetap 3 tap bila tanpa promo.
- *Risiko*: diskon manual rawan disalahgunakan. Butuh keputusan Albert karena menyentuh keputusan "belum ada diskon".

**#10 Target harian pegawai**
- *Masalah*: pegawai tidak punya tujuan harian yang jelas.
- *Solusi*: progress bar jumlah cup (bukan Rupiah) di kasir, dengan target yang diatur owner.
- *Arsitektur*: field target di pengaturan dan hitung lokal dari SQLite.
- *Risiko*: bisa membocorkan perkiraan omzet. Pegawai juga bisa merasa tertekan. Confidence rendah.

**#11 Penandaan kanal penjualan**
- *Masalah*: bila Albert berjualan di GoFood/Grab/WA, penjualannya tidak tercatat atau tercampur.
- *Solusi*: chip kanal opsional di keranjang (default walk-in) dan laporan per kanal. Tanpa harga per kanal, supaya "satu produk satu harga" tetap terjaga.
- *Arsitektur*: kolom `channel` di transaksi dan field di outbox.
- *Risiko*: tidak berguna bila tidak ada kanal online. Bergantung pada pertanyaan #3.

**#12 Stok bahan baku + resep (O-12)**
- *Masalah*: buah busuk atau habis, dan pemakaian bahan tidak terkontrol.
- *Solusi*: daftar bahan, resep per menu (gram/ml), stok berkurang otomatis per transaksi, stok opname, dan peringatan menipis.
- *Referensi*: resep & bahan baku Majoo, stok komponen Loyverse, actual-vs-theoretical Toast.
- *Arsitektur*: beberapa tabel baru dan pemotongan stok di server saat transaksi diterima. Pemotongan juga harus jalan untuk transaksi offline yang tiba belakangan.
- *Risiko*: beban input tinggi untuk owner, karena buah alami bervariasi (berat, kematangan). Lebih baik dimulai dari HPP (#1) dan kas keluar kategori buah (#3).

**#13 Kartu stamp digital via nomor HP**
- *Masalah*: tidak ada alasan khusus bagi pelanggan untuk kembali.
- *Solusi*: kasir mengetik nomor HP (opsional, 1 tap tambahan), struk menampilkan "Stamp 7/10", dan stamp ke-10 memberi 1 jus gratis.
- *Referensi*: poin Kopi Kenangan lewat scan QR di kasir, Square Loyalty (US$45+/bulan).
- *Arsitektur*: tabel `customers` (nomor HP di-hash/minimal) dan `stamp_ledger`. Offline: stamp dihitung server saat sinkron, sehingga saldo di kasir bisa tertinggal.
- *Risiko*: data pribadi (UU PDP), tambahan tap di jam ramai, dan butuh keputusan diskon/hadiah. Nilainya bergantung pada porsi pelanggan langganan, yang belum diketahui.

**#14 Menu online + pre-order via WhatsApp**
- *Masalah*: pelanggan sekitar (kantor/kos) ingin pesan dulu lalu ambil.
- *Solusi*: halaman menu publik (dari katalog, read-only) dengan tombol "Pesan via WhatsApp" berisi teks pesanan siap kirim. Kasir tetap menginput pesanan secara manual.
- *Referensi*: katalog website Olsera, pre-order Kopi Kenangan, katalog WhatsApp Business.
- *Arsitektur*: endpoint katalog publik (dengan cache) dan halaman statis di Cloudflare Pages. Tanpa pembayaran online.
- *Risiko*: traffic publik ke API free tier. Mitigasi: halaman statis di-generate saat katalog berubah.

**#15 Buka shift offline "sementara"**
- *Masalah*: internet mati saat buka toko membuat kasir tidak bisa berjualan (R-8).
- *Solusi*: shift lokal sementara yang digabung server ke shift aktif saat online.
- *Arsitektur*: logika merge yang kompleks dan bertentangan dengan invariant satu shift per gerai.
- *Risiko*: tinggi. Hanya layak dikerjakan bila data MVP menunjukkan kejadian ini sering.

## 5. Prioritas & Rekomendasi 3 Ide Teratas

| Peringkat | Ide | Alasan |
|---|---|---|
| 1 | **A. HPP & laba kotor per menu** (#1) | Skor tertinggi dan effort terkecil. Menjawab pertanyaan bisnis paling mendasar yang belum terjawab MVP: *apakah gerai ini untung, dan dari menu apa*. Hanya menyentuh API dan dashboard, jadi risiko ke kasir nol. Juga menjadi fondasi untuk prakiraan (#6), stok (#12), dan insight (#8). |
| 2 | **B. Laporan & alert otomatis ke Telegram** (#2) | Reach maksimal (terasa setiap hari). Mengubah dashboard dari *pull* menjadi *push*, dan menjadi kanal pengiriman untuk ide lain (#5, #6, #8). Pesaing lokal menjual fitur ini Rp499.000/bulan, sedangkan biaya kita US$0. |
| 3 | **C. Kas keluar/masuk di shift** (#3) | Membuat metrik inti MVP (selisih kas) bisa dipercaya. Tanpa fitur ini, setiap belanja es/buah dari laci muncul sebagai "selisih", dan alert di Konsep B menjadi bising. Pola offline-first dan outbox yang sudah ada bisa dipakai ulang. |

**Urutan eksekusi yang disarankan**: C → B → A, atau B → C → A bila tim ingin cepat terasa oleh Albert. Total ±8 hari-orang (estimasi). C sebaiknya dikerjakan sebelum atau bersamaan dengan B supaya alert selisih kas tidak memicu *false alarm*. A bisa paralel karena tidak bersinggungan dengan kasir.

**Kenapa ide lain belum masuk 3 besar**
- *QRIS dinamis (#4)*: ada biaya rutin, dan bisa membalik biaya MDR dari kemungkinan 0% menjadi 0,7%. Sebaiknya diputuskan setelah ada data porsi QRIS dan frekuensi salah konfirmasi (dari #2/#5).
- *Loyalty (#13) dan diskon (#9)*: menyentuh keputusan "belum ada diskon", dan nilainya bergantung pada data pelanggan langganan yang belum ada.
- *Stok bahan (#12)*: nilainya tinggi, tetapi effort besar dan beban input owner berat. Lebih aman masuk lewat HPP (#1), lalu kas keluar kategori buah (#3), baru stok penuh.

## 6. Konsep Detail

Konsep lengkap untuk 3 ide teratas disimpan terpisah:

| Konsep | Ide | File |
|---|---|---|
| A | HPP & Laba Kotor per Menu | [concepts/hpp-laba-menu.md](concepts/hpp-laba-menu.md) |
| B | Laporan & Alert Otomatis ke HP Owner (Telegram dulu, WhatsApp nanti) | [concepts/laporan-alert-telegram.md](concepts/laporan-alert-telegram.md) |
| C | Kas Keluar/Masuk di Shift (pengeluaran dari laci) | [concepts/kas-keluar-masuk.md](concepts/kas-keluar-masuk.md) |

## 7. Kandidat MVP (keputusan Albert lewat Chief of Staff)

Dua usulan di bawah ini memenuhi syarat: effort ≤ 0,5 hari, hanya menyentuh aplikasi kasir, tanpa perubahan kontrak OpenAPI atau skema DB, dan tidak mengubah keputusan terkunci. **Keduanya bukan bagian dari ruang lingkup MVP sampai Albert memutuskan lewat Chief of Staff**, dan aman untuk dilewati bila jadwal rilis 2 Nov ketat.

| # | Kandidat | Masalah | Solusi | Effort (estimasi) | Dampak | Risiko |
|---|---|---|---|---|---|---|
| K-1 | **"Kirim ringkasan shift ke WhatsApp owner"** di layar ringkasan tutup shift (K-11) | Owner baru tahu selisih kas setelah membuka dashboard | Tombol yang membuka share sheet Android dengan teks ringkasan (kasir, modal, cash, QRIS, kas aktual, selisih, jumlah transaksi, penanda "ditutup offline"). Memakai ulang mekanisme share WhatsApp struk (M-11). | ±0,5 hari (Mobile) + uji singkat QA | Owner langsung menerima closing di WhatsApp tanpa biaya API. Sekaligus menguji minat Albert terhadap Konsep B. | Bergantung pada pegawai menekan tombol (tidak otomatis). Data yang dibagikan sama dengan yang sudah terlihat di layar kasir, jadi tidak membuka data baru. |
| K-2 | **Kalkulator pecahan uang** di input kas aktual tutup shift | Menghitung uang laci secara manual sering salah, sehingga muncul selisih palsu | Opsi "Hitung per pecahan" (100rb, 50rb, …, koin): pegawai mengisi jumlah lembar dan total terisi otomatis ke `actual_cash`. Hanya UI lokal; yang dikirim ke API tetap `actual_cash`. | ±0,5 hari (Mobile) | Selisih palsu karena salah hitung berkurang, dan tutup shift lebih cepat. | Kecil. Rincian pecahan tidak tersimpan di server (bisa ditambah di fase 2). |

Yang **tidak** saya usulkan sebagai kandidat MVP: penyisipan nominal ke QRIS statis (sudah ada di `apps/api/src/lib/qris.ts`), dan semua ide yang butuh tabel atau endpoint baru.

## 8. Pertanyaan untuk Albert

Maksimal tiga, diurutkan dari yang paling mengubah prioritas:

1. **Volume & porsi QRIS:** kira-kira berapa transaksi per hari dan berapa persen dibayar QRIS? Apakah QRIS toko terdaftar sebagai **Usaha Mikro (UMI)**? Jawabannya menentukan apakah QRIS dinamis (#4) layak dibayar dan seberapa mendesak rekonsiliasi (#7).
2. **Uang laci & bahan:** seberapa sering uang laci dipakai belanja (es, buah, gas), dan siapa yang belanja buah? Apakah Albert sudah tahu perkiraan HPP per menu? Jawabannya mengonfirmasi urutan Konsep C dan A, dan menentukan apakah kategori "Belanja buah" masuk versi pertama.
3. **Arah 6–12 bulan:** mana yang paling mungkin terjadi: (a) buka gerai kedua, (b) jualan lewat GoFood/GrabFood/WhatsApp, atau (c) membangun pelanggan langganan (kantor/kos sekitar)? Jawabannya menentukan apakah ide kanal (#11), pre-order (#14), atau loyalty (#13) naik peringkat, dan apakah fitur multi-gerai perlu dipersiapkan.

## 9. Sumber

Diakses 26 Okt 2026. ⚠️ = pihak ketiga.

1. Majoo – Harga: https://majoo.id/harga
2. Moka – Harga: https://www.mokapos.com/harga
3. Loyverse – Pricing: https://loyverse.com/pricing (juga https://loyverse.com/en-us/pricing)
4. Loyverse – Email receipt: https://help.loyverse.com/help/how-send-e-mail-receipt-client
5. Loyverse – Shift management: https://help.loyverse.com/help/shift-management-loyverse-pos ; Shift report: https://help.loyverse.com/help/shift-report-sales-summary-pos
6. ⚠️ HitPay – Perbandingan POS Indonesia: https://hitpayapp.com/blog/pos-system-indonesia-comparison
7. Olsera – Pricing: https://www.olsera.com/id/pricing
8. Square AI open beta: https://squareup.com/us/en/press/square-ai-open-beta
9. Square AI di aplikasi mobile: https://squareup.com/us/en/press/square-releases-ai
10. Square Loyalty: https://square.com/us/en/software/loyalty
11. Toast IQ: https://pos.toasttab.com/blog/on-the-line/toast-iq
12. Toast IQ trends report: https://pos.toasttab.com/news/toast-iq-restaurant-trends-report-ai-assistant
13. Toast recipe costing: https://pos.toasttab.com/products/recipe-costing ; inventory: https://pos.toasttab.com/products/inventory-management
14. Opaper – Laporan shift: https://intercom.help/pt-opaper-international-indonesia/en/articles/11408480-laporan-shift-aplikasi-opaper
15. Paloma365 bot: https://paloma365.com/en/tuvis
16. Poster POS bot: https://joinposter.com/en/applications/revenue-dash-tracker-bot
17. Telegram Bot FAQ: https://core.telegram.org/bots/faq
18. WhatsApp Cloud API pricing: https://developers.facebook.com/docs/whatsapp/pricing
19. ⚠️ SleekFlow – tarif WhatsApp: https://help.sleekflow.io/id_ID/pricing
20. ⚠️ Qiscus – fitur WhatsApp Business: https://www.qiscus.com/en/blog/whatsapp-business-features/
21. Kopi Kenangan: https://kopikenangan.com
22. Kopi Kenangan App Store: https://apps.apple.com/app/id1458086649
23. Fore Coffee App Store: https://apps.apple.com/app/id1438745141
24. ⚠️ UKM Indonesia – tips GoFood/GoBiz: https://ukmindonesia.id/baca-deskripsi-posts/8-tips-berbisnis-kuliner-di-gofood-terapkan-hal-berikut-untuk-jangkau-lebih-banyak-konsumen
25. GrabMerchant (Malaysia): https://www.grab.com/my/merchant/pay/
26. ⚠️ Bisnis.com – MDR QRIS 0% ≤ Rp500.000 mulai 1 Des 2024: https://ekonomi.bisnis.com/read/20241016/9/1808129/mulai-1-desember-2024-transaksi-qris-maksimal-rp500000-bebas-biaya-di-pedagang-kecil
27. ⚠️ Jalin – MDR QRIS: https://www.jalin.co.id/en-en/news/produk-layanan/what-is-the-qris-mdr-fee-and-how-much-is-it
28. Midtrans – biaya QRIS: https://docs.midtrans.com/docs/what-is-the-applicable-transaction-fee-for-qris
29. Midtrans – webhook: https://docs.midtrans.com/docs/https-notification-webhooks
30. Xendit – QR codes: https://archive.developers.xendit.co/api-reference/qr-codes/ ; https://docs.xendit.co/docs/qr

Belum terverifikasi dan tidak dipakai sebagai dasar keputusan: fitur per paket Moka, harga resmi Pawoon, detail poin Fore, fitur GoBiz pre-order, dan tarif resmi WhatsApp Indonesia.
