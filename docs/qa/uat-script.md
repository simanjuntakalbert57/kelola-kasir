# Skrip UAT Owner (Q-E) — Kelola Kasir MVP

Peserta: **Albert (owner)** + Chief of Staff (pencatat) + 1–2 pegawai. Lingkungan: staging + HP kasir + printer RPP02N. Durasi sekitar 60–90 menit. Sumber: `docs/qa/test-plan.md` §9.

**Prasyarat (harus hijau sebelum UAT):** bug blocker (S1/S2) = 0; regresi otomatis hijau (lihat `docs/qa/test-report-stage6.md`); uji perangkat nyata (`docs/qa/device-test-script.md`) bagian A–D selesai; staging dan APK dari DEAR-19 siap; data uji dibuat baru (tanpa data produksi).

Cara mengisi: Chief of Staff mencatat **Lulus/Gagal** + catatan per langkah di komentar issue. Gagal → bug baru dengan bukti.

| # | Skenario | Langkah | Kriteria lulus | Hasil |
|---|---|---|---|---|
| U-1 | Owner menyiapkan toko | Login dashboard. Buat kategori "Jus Buah", 3 produk (mis. Alpukat 15.000, Jeruk 12.000, Mangga 18.000). Tambah 2 pegawai (PIN 6 digit). Tambah perangkat → kode 8 karakter → masukkan di HP kasir. Isi Pengaturan toko: nama, alamat, footer struk, QRIS | Produk muncul di HP kasir <1 menit. Kode hanya tampil sekali. PIN tidak pernah ditampilkan | |
| U-2 | Hari jualan normal | Pegawai 1 login PIN, **buka shift modal Rp100.000**. Jual **5 transaksi cash** (satu dengan uang lebih → cek kembalian) dan **3 QRIS** (2 dibayar, 1 dibatalkan). Cetak struk tiap transaksi | Total & kembalian benar. Struk lengkap dan sesuai layar. QRIS batal tidak masuk omzet. ≤3 tap per transaksi sederhana | |
| U-3 | Offline | Matikan Wi-Fi/data, jual 3 cash, nyalakan lagi | Semua tersinkron, owner melihat 3 transaksi itu. QRIS nonaktif saat offline | |
| U-4 | Void | Pegawai ajukan void (alasan wajib) untuk 2 transaksi. Owner **setujui 1, tolak 1** di dashboard | Yang disetujui keluar dari omzet & kas; yang ditolak kembali Lunas. Pegawai tidak bisa menyetujui sendiri | |
| U-4b | Void pada shift yang sudah ditutup | Setelah U-5, minta pegawai ajukan void atas transaksi di shift yang sudah ditutup (bila aplikasi mengizinkan) | **Keputusan Albert** diperlukan: default saat ini — kas "seharusnya" shift lama **tidak berubah**, void tercatat terpisah. Catat setuju/ubah | |
| U-5 | Tutup shift dengan selisih | Hitung uang laci, masukkan nominal **Rp5.000 kurang** dari seharusnya, tutup shift | Ringkasan memisahkan cash, QRIS, void; selisih −Rp5.000 tampil merah. Owner melihat di Shift & Kas <1 menit | |
| U-6 | Laporan & ekspor | Owner buka Dashboard dan Transaksi, ekspor **CSV** (dan Excel), cocokkan dengan catatan U-2…U-5 | Omzet, jumlah, split cash/QRIS **sama persis** dengan catatan; file terbuka di Excel/Sheets tanpa error | |
| U-7 | Pembatasan akses | Pegawai coba membuka dashboard owner dan laporan | Ditolak | |
| U-8 | Serah terima shift | Pegawai 1 tutup shift; pegawai 2 login dan buka shift baru | Satu shift aktif per gerai; transaksi tiap pegawai atas namanya | |
| U-9 | Printer bermasalah | Cabut kertas saat mencetak; matikan printer; nyalakan lagi | Transaksi tetap tersimpan; cetak ulang berhasil dengan penanda CETAK ULANG; printer tersambung kembali sendiri | |
| U-10 | Restore backup | Tonton demo QA: backup → restore ke database kosong → `verify-restore.sh` (`docs/ops/backup-restore.md`) | Jumlah transaksi & total rupiah identik. Albert paham cara memulihkan (RPO ≤24 jam, RTO ≤2 jam) | |
| U-11 | Penutup | Albert menilai: kecepatan, kemudahan, hal yang membingungkan | Catatan masukan dikumpulkan jadi backlog | |

## Sign-off
Dicatat di komentar issue DEAR-18 oleh Chief of Staff:
- [ ] Semua U-1…U-10 Lulus, atau kegagalan sudah dinyatakan **diterima** oleh owner (tulis nomornya).
- [ ] Keputusan U-4b (void pada shift tertutup): _____________
- [ ] Tidak ada bug S1/S2 terbuka.
- [ ] **Persetujuan rilis dari Albert**: Ya / Tidak, tanggal, catatan.
