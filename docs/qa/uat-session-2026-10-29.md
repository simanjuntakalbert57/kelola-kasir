# Skrip Sesi UAT Owner — Kamis 29 Okt 2026, 10.00 WIB (±1,5 jam)

Build: APK `kelola-kasir-0.1.0-staging-43f9356.apk` (= `main` @ `43f9356`). Koneksi HP: `https://kelola-kasir.pages.dev/v1`. Perangkat: HP Android + printer RPP02N.
Peserta: Albert (pelaksana), Chief of Staff (pencatat), QA (pemandu). Ini ringkasan urutan sesi; rujukan detail: `uat-script.md` (U-x), `device-test-script.md` (T/D/Q/P/S), `test-plan.md` §5.11 (TC-KRJ).

**Aturan sesi:** isi kolom Hasil dengan **L** (lulus) / **G** (gagal) / **N/A**. Untuk setiap **G**: foto/video + catatan satu kalimat. QA langsung membuat tiket `[Bug]` di bawah DEAR-18 dan meng-assign ke engineer pemilik area (alur komentar 26 Okt). Blocker = transaksi gagal, uang/data salah, struk tidak tercetak, sinkron hilang.

## 0. Persiapan (10 menit, 10.00–10.10)
| # | Langkah | Hasil |
|---|---|---|
| 0-1 | Pasang APK di atas; buka aplikasi; masukkan kode perangkat dari dashboard (Pegawai & Perangkat → Tambah perangkat) | |
| 0-2 | Login owner di `kelola-kasir.pages.dev`. Pastikan ada ≥8 produk, 3 kategori, QRIS aktif (kode QRIS terisi), 2 pegawai | |
| 0-3 | Layar Printer → scan → hubungkan RPP02N → Cetak tes (struk terbaca, 32 kolom) | |
| 0-4 | Transaksi pertama bisa lambat bila server idle; tunggu sampai 90 dtk, jangan ketuk ulang | |

## 1. Keranjang (TC-KRJ, 15 menit)
| # | Langkah | Diharapkan | Hasil |
|---|---|---|---|
| TC-KRJ-08 | Tambah ≥15 baris produk berbeda ke keranjang. Buka tab Keranjang. Gulir naik/turun, termasuk gulir cepat. Lalu ketuk kolom catatan/nama pembeli sehingga keyboard terbuka | Footer (jumlah item, TOTAL, Cash, QRIS) tetap terlihat, tidak tertutup tab bar/keyboard/navigation bar. Baris terakhir bisa digulir penuh | |
| TC-KRJ-18 | Aktifkan mode pesawat. Ubah qty di Keranjang, cek badge, bayar Cash dari Keranjang | Keranjang, badge, dan bayar Cash tetap jalan; transaksi masuk antrean "belum tersinkron". Matikan pesawat → tersinkron, muncul di dashboard | |
| TC-KRJ-19 | Lihat tab bar (Jual, Keranjang, Riwayat, Shift). Isi keranjang 12, lalu ≥100 item. Perbesar font sistem (Pengaturan Android → Ukuran font) | Label tidak terpotong/bertumpuk, badge tidak menutupi label, tombol mudah diketuk | |
| Bonus | Setelah bayar sukses (Cash dan QRIS), cek keranjang kosong & badge hilang (TC-KRJ-03). "Kosongkan" minta konfirmasi (TC-KRJ-11/12) | | |

## 2. Alur uang di HP (Q-D, 30 menit)
| # | Rujukan | Langkah ringkas | Hasil |
|---|---|---|---|
| 2-1 | U-2, T-01 | Pegawai 1 login PIN, buka shift modal Rp100.000. 5 cash (satu dengan uang lebih → cek kembalian). Hitung tap dan waktu: Jual → Cash → Uang Pas ≤3 tap, ≤15 dtk | |
| 2-2 | Q-01..Q-04 | 3 QRIS: 2 "Sudah Dibayar", 1 "Batal". Pindai QR dengan ≥2 aplikasi (nama toko & nominal benar). Batal tidak masuk omzet | |
| 2-3 | P-03, P-06, P-07 | Toggle Cetak struk ON → struk otomatis (isi sama dengan layar). Cetak ulang dari Riwayat (ada CETAK ULANG). Foto struk | |
| 2-4 | P-09 | Cabut kertas saat cetak → transaksi tetap Lunas, ada error + coba lagi | |
| 2-5 | D-01..D-03 (U-3) | Offline 3 cash lalu online: semua tersinkron ≤30 dtk, owner melihat 3 transaksi, QRIS nonaktif saat offline | |
| 2-6 | U-4 | Pegawai ajukan void (alasan wajib) 2 transaksi; owner setujui 1, tolak 1 di dashboard | |
| 2-7 | U-5, D-07 | Tutup shift dengan uang laci Rp5.000 kurang → selisih −Rp5.000 merah; owner melihat di Shift & Kas | |
| 2-8 | U-8 | Pegawai 2 login dan buka shift baru (satu shift aktif per gerai) | |

## 3. Dashboard & laporan (10 menit)
| # | Rujukan | Langkah | Hasil |
|---|---|---|---|
| 3-1 | U-6 | Ekspor CSV/Excel Transaksi; cocokkan omzet, jumlah, split cash/QRIS dengan catatan 2-1…2-7 | |
| 3-2 | U-7 | Akun pegawai membuka dashboard owner → ditolak | |
| 3-3 | U-4b | **Keputusan Albert:** void atas transaksi di shift yang sudah ditutup. Default: kas shift lama tidak berubah, void tercatat terpisah. Setuju / ubah: ______ | |

## 4. Restore backup (U-10)
Status: **backup harian belum aktif** (menunggu Albert mengisi bucket + kunci age, lihat komentar Tech Lead 26 Okt). Dua kemungkinan:
- Jika backup sudah aktif sebelum sesi: Albert menjalankan restore di laptop dengan kunci privatnya, dipandu QA (`docs/ops/backup-restore.md` § Restore), lalu `verify-restore.sh` → jumlah transaksi & total rupiah identik.
- Jika belum: U-10 dicatat **Tertunda**, bukan Gagal. Bukti restore lokal tetap TC-NF-06 (lulus, laporan stage 6). Masuk daftar syarat go-live.

## 5. Dilewati / dicatat khusus
- Upload foto produk: **skip** (storage nonaktif), bukan gagal.
- Tidak di sesi ini: p90 20× transaksi, uji 4 jam, struk 10 beruntun, non-ASCII, cold start 15 menit (`device-test-script.md`). QA jadwalkan terpisah bila Albert setuju.

## 6. Penutup
Albert menilai kecepatan, kemudahan, hal membingungkan (U-11). Sign-off di `uat-script.md` (bagian Sign-off). Rekap go/no-go: Sabtu 31 Okt, paling lambat 16.00 WIB.
