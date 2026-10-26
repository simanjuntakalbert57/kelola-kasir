# Skrip Uji Perangkat Nyata (Q-D) — Kelola Kasir MVP

Untuk: Albert (owner) sebagai pelaksana, QA sebagai pembimbing. Lingkungan: **staging** + APK dari DEAR-19. Pemetaan test case: `docs/qa/test-plan.md` §5.

## Persiapan
| Item | Keterangan |
|---|---|
| HP | ≥1 HP Android 10+ (idealnya 2; satu RAM ≤3 GB). Catat merek, model, versi Android |
| Printer | **RPP02N** thermal 58 mm ESC/POS (Bluetooth Classic). Kertas cadangan 1 gulung |
| Build | APK debug/rilis dari DEAR-19. Catat versi dan tanggal |
| Server | URL staging dari DEAR-19. Staging bisa tidur: transaksi pertama bisa lambat sampai 90 dtk (T-17) |
| Data seed | 1 outlet, 3 pegawai (PIN dibagikan lewat kanal aman, jangan ditulis di issue), 8 produk, 3 kategori, QRIS statis aktif |
| Perekam | Rekam layar (60 fps) untuk T-01; foto struk untuk setiap uji cetak |

Cara mengisi: jalankan langkah berurutan, tulis **Lulus / Gagal / N/A** dan catatan. Untuk setiap **Gagal**: foto/video, lalu QA membuat bug (severity S1–S4, `test-plan.md` §10). Unggah bukti sebagai lampiran komentar di issue DEAR-18.

## A. Kecepatan transaksi (TC-NF-01)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| T-01 | Login, shift terbuka, layar katalog. Mulai rekam. Tap produk → Cash → "Pas". Ulangi **20×** (10× oleh Albert, 10× oleh pegawai yang baru dilatih 5 menit) | Setiap transaksi ≤3 tap. Median ≤15 dtk, p90 ≤20 dtk (stopwatch/frame-by-frame dari sentuhan pertama sampai layar sukses) | |
| T-02 | Ulangi dengan 2 produk berbeda, 10× | ≤4 tap; median ≤15 dtk | |
| T-03 | QRIS: tap produk → QRIS | Layar QR tampil ≤10 dtk | |

Catat tabel waktu (detik) per transaksi di komentar.

## B. Offline → online (TC-OFF, TC-SHF-09)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| D-01 | Online: buka shift (modal Rp100.000). Aktifkan **mode pesawat** | Aplikasi tetap bisa dipakai; tombol QRIS nonaktif dengan pesan jelas (TC-QRS-07) | |
| D-02 | Offline: login PIN lokal, jual cash 5× | Badge "5 belum tersinkron" | |
| D-03 | Matikan mode pesawat | ≤30 dtk semua tersinkron; owner melihat 5 transaksi sama (nomor, total, jam) di dashboard | |
| D-04 | Offline, jual 2×, **matikan paksa aplikasi** (swipe dari recent), buka lagi | Transaksi offline masih ada, tidak hilang (TC-OFF-07) | |
| D-05 | Jual saat sinyal naik-turun (nyala/mati berkali-kali) | Tidak ada transaksi ganda/hilang (TC-OFF-12) | |
| D-06 | Mode pesawat **sebelum** buka shift, lalu coba buka shift | Ditolak dengan pesan jelas, tidak ada shift terbentuk; setelah online berhasil (TC-OFF-13) | |
| D-07 | Offline: tutup shift | Peringatan keras tampil; setelah online owner melihat selisih sama persis (TC-SHF-09) | |
| D-08 | Ubah harga produk di dashboard saat HP offline, jual produk itu, online | Transaksi diterima dengan harga yang dilihat kasir (snapshot), ditandai selisih harga (TC-OFF-04) | |
| D-09 | Ubah jam HP maju >10 menit | Peringatan jam di aplikasi (TC-OFF-11) | |

## C. QRIS manual (TC-QRS)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| Q-01 | Jual → QRIS | QR + nominal besar + hitung mundur; tombol **Sudah Dibayar** dan **Batal**; dialog konfirmasi menyebut nominal (TC-QRS-02) | |
| Q-02 | Pindai QR dengan ≥3 aplikasi (mis. GoPay, OVO/DANA, m-banking) | Nama toko dan nominal benar di semua aplikasi (TC-QRS-08). Catat yang gagal | |
| Q-03 | Bayar, lalu tap **Sudah Dibayar** | Transaksi Lunas; muncul di dashboard sebagai QRIS terkonfirmasi manual | |
| Q-04 | Jual → QRIS → **Batal** | Status Batal, tidak masuk omzet maupun kas laci | |
| Q-05 | Jual → QRIS, **biarkan >15 menit** | Otomatis Batal/kedaluwarsa; tombol konfirmasi tidak bisa dipakai | |
| Q-06 | Jual → QRIS, background/matikan aplikasi saat QR tampil, buka lagi | Pending dipulihkan, tidak membuat transaksi ganda (TC-QRS-12) | |

## D. Printer RPP02N (TC-PRN)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| P-01 | Layar Printer → scan → pilih RPP02N → hubungkan. Android 12+: izin Bluetooth diminta; coba **tolak** izin sekali | Status terhubung; penolakan izin ditangani dengan pesan (TC-PRN-01) | |
| P-02 | Cetak tes | Struk terbaca, lebar 32 kolom, tidak terpotong (TC-PRN-02) | |
| P-03 | Toggle "Cetak struk" ON, bayar cash | Struk tercetak otomatis; isi lengkap: nama toko, alamat, no. transaksi, tanggal WIB, pegawai, item/qty/harga, total, tunai/kembalian, footer; angka sama dengan layar (TC-PRN-03/04). **Foto struk** | |
| P-04 | Toggle OFF, bayar cash | Tidak mencetak; preferensi tersimpan setelah restart aplikasi | |
| P-05 | QRIS pending lalu batal | Tidak mencetak struk lunas (TC-PRN-05) | |
| P-06 | Cetak ulang dari Riwayat | Struk identik + penanda CETAK ULANG (TC-PRN-06) | |
| P-07 | Header/footer/nama toko **panjang** (≥40 karakter) dan nama produk panjang ("Jus Alpukat Susu Cokelat Extra Large Spesial") | Dibungkus rapi, tidak berantakan (TC-PRN-09). Foto | |
| P-08 | Nama produk/pembeli berkarakter non-ASCII (é, ñ, emoji 🍹, huruf Arab/Mandarin bila ada) | Tercetak benar atau diganti aman; perintah printer tidak kacau | |
| P-09 | Cabut kertas / kertas habis saat mencetak | Transaksi **tetap tersimpan Lunas**; error jelas + coba lagi; tidak ada transaksi ganda (TC-PRN-07) | |
| P-10 | Matikan printer **saat sedang mencetak** | Sama seperti P-09 | |
| P-11 | Matikan-nyalakan printer; lalu restart aplikasi | Auto-reconnect tanpa scan ulang (TC-PRN-08) | |
| P-12 | Cetak **10 struk berturut-turut** cepat (antrean ramai) | Semua tercetak utuh, urutan benar, tidak ada yang hilang/campur | |
| P-13 | Struk digital (bagikan WhatsApp/gambar) | Tersedia & identik dengan cetak; juga saat offline (TC-PRN-10) | |

## E. Layout & performa (TC-NF-02/03/08)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| L-01 | Periksa layar utama di lebar 360/393/430 px (atau HP yang ada) | Tidak ada teks terpotong, target sentuh ≥44 px | |
| L-02 | Tema gelap di bawah cahaya terang/di luar ruangan | Terbaca jelas | |
| L-03 | Mode pesawat: ulangi 10 transaksi | Respons tap <300 ms; tidak ada jaringan di jalur tap | |
| L-04 | Pakai 4 jam (atau simulasi 100 transaksi) | Tidak crash/ANR; baterai wajar | |

## F. Multi-pegawai & shift (TC-SHF-03/04/10, T-17)
| # | Langkah | Hasil diharapkan | Hasil |
|---|---|---|---|
| S-01 | Pegawai A buka shift di HP 1; pegawai B login di HP 2 (atau HP yang sama) | B bergabung ke shift A; tidak ada error "shift sudah terbuka" yang tertinggal (TC-SHF-03) | |
| S-02 | B jual 2 transaksi | Tercatat atas nama B di shift A; laporan per pegawai di dashboard benar | |
| S-03 | Serah terima: A tutup shift, B buka shift baru | Modal awal shift baru independen | |
| S-04 | Tutup shift dengan ada void tertunda **dan** QRIS pending | Ringkasan memisahkan cash, QRIS, void tertunda, selisih; pending ditangani sesuai desain (online dan offline) | |
| S-05 | Cold start: biarkan staging idle ≥15 menit, lalu transaksi pertama | Berhasil dalam ≤90 dtk tanpa duplikat; pesan menunggu jelas | |

## Hasil
Ringkas di komentar: jumlah Lulus/Gagal/N/A per bagian, daftar bug (link), lampiran video T-01 dan foto struk P-03/P-07/P-12. Kriteria keluar: semua test case **P0** lulus, tidak ada S1/S2 terbuka.
