# Laporan Hasil Uji — Stage 6 (Q-C, sebagian Q-D/Q-E)

Build: `main` @ `241a42e` (PR #4–#18). Penguji: QA Engineer. Tanggal: 2026-10-26. Lingkungan: macOS, Node 24.19, PostgreSQL 16.15 lokal, tanpa staging.

## Ringkasan
| Lapisan | Hasil |
|---|---|
| API unit/integrasi (dev, `apps/api`) | **299/299 lulus**, 20 berkas; coverage 92,5% statement (transactions/payments/sync ≥80%) |
| Dashboard unit (dev, `apps/dashboard`) | **34/34 lulus** |
| **E2E Playwright (Q-C, baru)** | Chromium **44 lulus + 3 gagal-diharapkan (bug terbuka)**; Firefox 2/2, WebKit (Safari) 2/2, mobile-chrome (Pixel 7) 7/7 |
| Uji restore backup (TC-NF-06) | **Lulus** (lihat bawah) |
| Uji perangkat nyata (Q-D) | **Belum dijalankan** (butuh HP + printer RPP02N + staging DEAR-19): skrip siap |
| UAT owner (Q-E) | **Belum dijalankan**: skrip siap |

Bug blocker (S1/S2): **0 terbuka**. DEAR-27 (S2) dan DEAR-28 sudah diperbaiki di `main` (PR #19, #21); `test.fail`-nya dihapus dan test kini lulus. DEAR-26 (S3) juga sudah di `main` (PR #20), `test.fail`-nya dihapus. Terbuka: DEAR-30 (S3, QRIS hanya-gambar).

## Bug ditemukan
| Issue | Sev | Ringkas | Test (gagal-diharapkan) |
|---|---|---|---|
| DEAR-26 | S3 (diperbaiki, PR #20) | Tautan shift → transaksi tidak memfilter shift | `shifts.spec.ts` |
| DEAR-27 | S2 (diperbaiki, PR #19) | "Hanya yang selisih" hanya menyaring halaman termuat (50 shift terbaru); selisih lama tersembunyi | `zz-pagination.spec.ts` |
| DEAR-28 | S3 (diperbaiki, PR #21) | Daftar void terpotong di 50 permintaan, tanpa paginasi | `zz-pagination.spec.ts` |
| DEAR-30 | S3 | QRIS hanya-gambar disimpan tanpa peringatan, tapi semua penjualan QRIS ditolak 503 ("Tanamkan nominal" ikut menyesatkan) | `qris-settings.spec.ts` (`test.fail`) |

Test ditandai `test.fail(true, 'DEAR-xx')`: suite hijau, dan otomatis merah saat bug diperbaiki (hapus baris itu).

## Hasil per test case (otomatis)
| Test case | Hasil | Catatan |
|---|---|---|
| TC-AUTH-01 | Lulus | JWT, cookie `kk_refresh` HttpOnly + SameSite=Strict; Chromium, Firefox, WebKit, mobile |
| TC-AUTH-02 | Lulus | 5 salah → "Terlalu banyak percobaan"; password benar saat terkunci ditolak |
| TC-AUTH-04, TC-DEV-01 | Lulus | Kode pairing 8 karakter hanya tampil sekali |
| TC-AUTH-08 | Lulus | Cabut perangkat → token perangkat ditolak |
| TC-AUTH-09 | Lulus | PIN sama dalam satu outlet ditolak |
| TC-RBAC-04 | Lulus | Pegawai tidak bisa approve void (403) |
| TC-RBAC-05 | Lulus | Pegawai nonaktif hilang dari grid login perangkat |
| TC-DSH-01 | Lulus | Omzet = paid + void_requested = Rp150.000; pending/cancelled tidak dihitung |
| TC-DSH-02 | Lulus | 7 transaksi, 5 cash · 2 QRIS, rata-rata **Rp21.428** (21.428,57 dibulatkan ke bawah; pembulatan perlu didokumentasikan) |
| TC-PRD-01/02/05/06 | Lulus | CRUD produk, validasi harga (0, desimal, negatif, teks), kategori, tidak ada UI/endpoint varian |
| TC-TRX-03 | Lulus | Ubah harga produk tidak mengubah transaksi lama |
| TC-LST-01 | Lulus | Filter metode/status/pegawai berkombinasi; empty state & reset |
| TC-LST-02 | Lulus | Ekspor CSV (8 baris = layar, nama pembeli, tanpa desimal) dan XLSX; unduh berjalan di Chromium, Firefox, WebKit (tidak ada masalah `revokeObjectURL` pada headless, perlu dicek di Safari iOS nyata) |
| TC-LST-03 | Lulus | Detail: item snapshot, total, tunai/kembalian |
| Pencarian >60 karakter | Lulus | Tidak menimbulkan error 400 di UI |
| TC-EMP-01 | Lulus | PIN 6 digit; PIN tidak pernah ditampilkan |
| TC-SET-01 | Lulus | Nama/alamat/footer tersimpan dan pratinjau struk ikut berubah; QRIS tidak valid ditolak |
| TC-SHF-05/07/12 | Lulus | Shift 1: seharusnya 142.000, aktual 137.000, selisih −5.000; QRIS terpisah |
| TC-STM-05/06 | Lulus | Approve → `voided`, omzet 150.000 → 126.000; tolak → kembali Lunas |
| TC-STM-09 | Lulus | Approve ulang idempoten (200, tanpa double-subtract); approve setelah tolak → 409 |
| TC-SHF-13 (item 7 CoS) | Lulus | Void pada shift tertutup: expected cash shift lama tidak berubah (142.000). Perilaku default (a) terkonfirmasi; **butuh konfirmasi Albert saat UAT (U-4b)** |
| Tautan shift → transaksi | **Gagal** | DEAR-26 |
| Filter selisih >1 halaman | **Gagal** | DEAR-27 |
| Void >1 halaman | **Gagal** | DEAR-28 |

Cakupan oleh suite dev (lulus, 299 test): TC-SHF-01…, TC-TRX-*, TC-QRS-*, TC-OFF (sisi server), TC-STM-*, TC-RBAC-01…03 dan db-invariants. Verifikasi keberadaan skenario P0 per PR tetap lewat review PR.

## Belum tercakup — status
| Item | Status |
|---|---|
| "Tanamkan nominal" saat hanya gambar QRIS diisi | **Sudah dalam E2E** (`qris-settings.spec.ts`); menemukan DEAR-30 |
| Struk 32 kolom, baris panjang | **Menunggu staging + HP/printer** (skrip perangkat P-07) |
| Cold start Render Free (90 dtk) | **Menunggu staging** (skrip perangkat S-05) |
| Q-D: seluruh `TC-PRN`, `TC-OFF` perangkat, `TC-QRS-02/07/08/12`, `TC-NF-01/02/03/08`, `TC-SHF-09` | **Menunggu staging DEAR-19, APK, HP, printer RPP02N, jadwal Albert**. Skrip: `docs/qa/device-test-script.md` |
| Q-E UAT | **Menunggu jadwal Albert**; skrip `docs/qa/uat-script.md` |
| Safari iOS nyata untuk ekspor; TC-DSH-04 (performa); TC-NF-07 (k6) | Belum (butuh perangkat/staging) |
| Backup nyata ke R2/Neon | **Menunggu staging/secret DEAR-19** |

## Uji restore backup (TC-NF-06) — Lulus
Sumber: database hasil E2E (2 outlet, 3 pegawai, 54 shift, 59 transaksi, Rp708.000 paid, 192 audit log).
1. `backup.sh` (target `local:`, enkripsi age) → 91.806 byte.
2. `restore.sh` ke database kosong baru: selesai <1 dtk.
3. `verify-restore.sh` sumber vs hasil restore: **identik** (19 tabel, jumlah baris, total rupiah, audit log, 3 migrasi; `open_shifts_per_outlet_max`=1).
4. Restore ke database berisi **ditolak** ("target database is not empty").
5. API dijalankan di atas hasil restore: `/healthz` ok, login owner 200.
Belum diuji: backup nyata ke R2 dan database Neon (menunggu staging/secret dari DEAR-19).
