# Test Plan — Kelola Kasir (POS Jus) · MVP v1

Status: Draft v1 · Penyusun: QA Engineer · Tanggal: 2026-10-26
Sumber: PRD v1, TDD **v1.1** (`docs/tdd.md` §2.4–§2.5, R-8), ADR-0001–0009 (termasuk ADR-0009 satu shift aktif per gerai), `docs/api/openapi.yaml`, desain final (DEAR-5), dan 8 keputusan owner.

## 1. Tujuan & Prinsip
- Memastikan semua fitur **Must** (P-xx kasir, O-xx owner) memenuhi PRD, kontrak OpenAPI, dan aturan bisnis PRD §5.
- Prioritas uji mengikuti **alur uang**: transaksi → pembayaran (cash/QRIS) → void → shift/selisih kas → laporan.
- Rilis tidak boleh keluar bila ada defect **S1/S2** terbuka pada alur uang (lihat §10).

## 2. Keputusan Owner yang Mengikat Pengujian
| # | Keputusan | Dampak uji |
|---|---|---|
| 1 | Tidak ada varian/opsi produk; satu produk = satu harga | P-04 & O-05 (varian) **tidak diuji**; uji negatif: API menolak `options` / option-group endpoint tidak ada; item = produk + qty + snapshot harga |
| 2 | Kasir = HP Android portrait 360–430 px; tablet tidak didukung | Uji layout di 360, 393, 430 px; landscape/tablet di luar lingkup |
| 3 | Printer thermal BT ESC/POS 58 mm = **Must** | Toggle "Cetak struk", cetak ulang, layar Printer (K-12): scan/hubung/cetak tes |
| 4 | QRIS statis + konfirmasi manual via `PaymentProvider` | Uji mode `manual`; mode `auto` hanya uji kontrak/mock |
| 5 | Status `cancelled` ditambahkan (Q-1) | State machine 5 status |
| 6 | Tutup shift boleh offline + peringatan keras (Q-3) | Uji offline close → sync |
| 7 | 1 shift aktif per gerai; pegawai lain login di shift sama, transaksi atas nama kasirnya (Q-4) | Uji multi-pegawai, serah terima = tutup lalu buka |
| 8 | Header/footer struk diatur owner (O-10) | Uji propagasi ke struk digital & cetak |

## 3. Kategori Pengujian & Pemilik
| Kategori | Kode | Pemilik | Alat | Task TDD |
|---|---|---|---|---|
| Unit / integration | UT/IT | Dev (BE/MO/FE) | Jest/Vitest, DB test | tiap task (DoD §8.7); QA me-review cakupan §4–§8 |
| API contract | API | QA | schemathesis/Dredd vs `openapi.yaml`, + skenario stateful | Q-B |
| E2E dashboard | E2E | QA | Playwright | Q-C |
| Uji perangkat nyata | DEV | QA | HP Android + printer ESC/POS 58 mm | Q-D |
| UAT | UAT | QA + Owner | skrip UAT §9 | Q-E |
| Non-fungsional | NF | QA/Dev | k6 ringan, stopwatch/tap-count | Q-D/Q-E |

Aturan: test case milik dev (UT/IT) wajib mencakup minimal skenario berprioritas **P0** pada §5 yang bertipe UT/IT; QA memverifikasi keberadaannya saat review PR.

## 4. Lingkungan & Perangkat Uji
| Item | Spesifikasi minimum |
|---|---|
| Android | **≥1 HP Android** (Android 10+, layar 360–430 px lebar logis), idealnya 2 HP (satu RAM ≤3 GB) untuk uji performa & multi-perangkat |
| Printer | **≥1 printer thermal Bluetooth ESC/POS 58 mm** (model rekomendasi TDD R-6); gulungan kertas cadangan |
| Dashboard | Chrome & Firefox terbaru, Safari iOS/Chrome Android (responsif), viewport 1440 / 768 / 390 |
| Backend | Staging: Render Free service kedua + project Neon Free terpisah dari produksi (kuota CU-jam Neon per project; jam instance Render dibagi satu workspace, staging tidur saat idle — ADR-0011); data seed: 1 outlet, 1 owner, 3 pegawai, 8 produk, 3 kategori |
| Data uji | Tanpa data/secret produksi; PIN & kredensial uji dari secret store CI, tidak di-commit |
| QRIS | QR statis uji (sandbox/QR milik toko) + uji pindai di ≥3 e-wallet/m-banking (TDD §5.3) |
| Jaringan | Mode pesawat / Wi-Fi off, throttle 3G, putus-sambung saat request berjalan |
| Waktu | Zona WIB; satu skenario dengan jam perangkat salah >10 menit |

## 5. Test Case
Format: **ID · Prioritas (P0 kritis uang/keamanan, P1 Must lain, P2 Should/Could) · Kategori · Langkah/ekspektasi ringkas · Pemetaan**.

### 5.1 Autentikasi, perangkat, RBAC (P-01, O-01, O-06, O-10)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-AUTH-01 | P0 | API/E2E | Owner login email+password benar → access JWT + refresh cookie `HttpOnly; Secure; SameSite=Strict` | O-01 |
| TC-AUTH-02 | P0 | API | 5 password salah → lockout 10 menit; login benar saat lockout ditolak | O-01 |
| TC-AUTH-03 | P1 | API | Refresh token rotasi: token lama dipakai ulang → ditolak | O-01 |
| TC-AUTH-04 | P1 | E2E | Owner buat perangkat → pairing code 8 karakter; dipakai sekali; kedaluwarsa 10 menit; kode kedua kali ditolak | P-01 |
| TC-AUTH-05 | P0 | DEV/API | Kasir pair → `device_token` tersimpan aman; PIN login 6 digit benar → JWT 12 jam `role=cashier` | P-01 |
| TC-AUTH-06 | P0 | API/DEV | 5 PIN salah → `PIN_LOCKED` 5 menit di perangkat tsb; pegawai lain di perangkat sama tidak terkunci | P-01 |
| TC-AUTH-07 | P0 | API | JWT pegawai tanpa `X-Device-Token` aktif → 401/403 | P-01 |
| TC-AUTH-08 | P0 | E2E/API | Owner revoke perangkat → semua sesi pegawai di perangkat gugur; request berikutnya ditolak | P-01 |
| TC-AUTH-09 | P1 | API | PIN unik per outlet: dua pegawai PIN sama → ditolak saat buat/reset | O-06 |
| TC-AUTH-10 | P1 | API | PIN/hash tidak pernah muncul di respons API & log | O-06 |
| TC-RBAC-01 | P0 | API | Token pegawai memanggil `/dashboard/*`, `/reports/*`, `/transactions/export`, `/products` (tulis), `/employees`, `/settings` (tulis), `/devices` → 403 (matriks penuh per endpoint `ownerAuth`) | PRD §5 |
| TC-RBAC-02 | P0 | API | Pegawai `GET /transactions` hanya shift/hari ini di outlet & perangkatnya; parameter `date_from` lama/`employee_id` lain tidak melebarkan scope | P-09 |
| TC-RBAC-03 | P0 | API | Token owner/pegawai outlet A tidak bisa baca/tulis data outlet B (IDOR: transaksi, produk, shift) | multi-outlet |
| TC-RBAC-04 | P0 | API | Pegawai tidak bisa approve/reject void; owner bisa; ringkasan shift hanya shift miliknya | P-10, O-08 |
| TC-RBAC-05 | P1 | E2E | Pegawai dinonaktifkan → tidak muncul di grid login & token lama ditolak | O-06 |
| TC-RBAC-06 | P1 | API | Reset PIN pegawai tercatat `employee.pin_reset` di audit log | O-06 |

### 5.2 Shift (P-02, P-12, O-07)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-SHF-01 | P0 | API/DEV | Buat transaksi tanpa shift terbuka → `SHIFT_NOT_OPEN` | P-02 |
| TC-SHF-02 | P0 | API | Buka shift modal kas integer ≥0; modal negatif/desimal/string → 422 | P-02 |
| TC-SHF-03 | P0 | API/DEV | **Satu shift aktif per gerai**: `POST /shifts` saat sudah ada shift terbuka (perangkat/pegawai lain) → `409 SHIFT_ALREADY_OPEN`, tidak membuat duplikat saat race 2 request paralel (unique index). Aplikasi lalu **bergabung** ke shift yang sudah terbuka (tanpa error tersisa, transaksi masuk shift itu) | Q-4, ADR-0009 |
| TC-SHF-04 | P0 | DEV/API | Pegawai B login di shift milik A → transaksi tercatat `employee_id`=B, `shift_id`=shift A; laporan per pegawai benar | Q-4 |
| TC-SHF-05 | P0 | API | `expected_cash = opening_cash + Σ total cash (paid\|void_requested, client_created_at ≤ closed_at)`; `voided`, `cancelled`, QRIS tidak dihitung; `cash_difference = actual − expected` | P-12 |
| TC-SHF-06 | P0 | API | Selisih negatif (kurang), nol, positif (lebih) benar; tipe signed integer | P-12 |
| TC-SHF-07 | P0 | API | Ringkasan tutup shift memisahkan cash, QRIS, transaksi `void_requested`, selisih | P-12 |
| TC-SHF-08 | P0 | API | Tutup shift dua kali → idempoten/`SHIFT_CLOSED`; transaksi baru ke shift tertutup ditolak | P-12 |
| TC-SHF-09 | P0 | DEV | **Tutup shift offline**: peringatan keras tampil; setelah online tersinkron, owner melihat selisih sama persis | Q-3 |
| TC-SHF-10 | P1 | DEV | Serah terima = tutup shift lalu buka shift baru; modal awal shift baru independen | Q-4 |
| TC-SHF-11 | P0 | API | Shift sudah ditutup di server, lalu perangkat offline mengirim transaksi lewat `/sync/push` → **diterima** (`applied`), bukan `SHIFT_CLOSED`; bila `client_created_at > closed_at` ditandai `after_shift_close`; transaksi tidak hilang | TDD §2.4/§2.5 |
| TC-SHF-12 | P0 | E2E | Owner lihat riwayat shift: modal, cash, QRIS, kas aktual, selisih (merah bila negatif) < 1 menit setelah tutup | O-07 |
| TC-SHF-13 | P1 | API | Void yang disetujui setelah shift tutup: perlakuan selisih terdokumentasi & konsisten (lapor bila ambigu) | P-10 |
| TC-SHF-14 | P0 | API | Transaksi telat: cash dengan `client_created_at ≤ closed_at` tiba setelah tutup shift → **dihitung** di `expected_cash` (ringkasan dihitung ulang server); cash dengan `client_created_at > closed_at` **tidak** dihitung di `expected_cash` | §3.2 |
| TC-SHF-15 | P0 | API/E2E | Transaksi `after_shift_close` masuk `late_transaction_count` & `late_cash_amount` di ringkasan shift; owner melihatnya terpisah dan angka cocok dengan daftar transaksi bertanda `after_shift_close` | §2.5 |
| TC-SHF-16 | P0 | API | Transaksi online via `POST /transactions` ke shift yang sudah ditutup → `SHIFT_CLOSED` (pegawai diminta buka shift baru); beda dengan jalur `/sync/push` (TC-SHF-11) | §2.4 |
| TC-SHF-17 | P1 | API/DEV | Shift aktif ikut di `current_shift` pada `/sync/pull` dan `GET /shifts/current`; perangkat lain yang baru online mengetahui shift aktif tanpa membuka shift baru; setelah tutup shift `current_shift` kosong | §2.4/§2.5 |
| TC-SHF-18 | P1 | API | Selisih tutup shift offline vs setelah sinkron: ringkasan awal di perangkat dan ringkasan server dihitung ulang; perbedaan (akibat transaksi telat) terlihat jelas, bukan error | R-3 |

### 5.3 Transaksi, keranjang & uang (P-03, P-05, P-06, P-09)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-TRX-01 | P0 | UT/API | `unit_price × qty = line_total`, `Σ line = subtotal`, `total = subtotal − discount + tax` (discount/tax = 0); server hitung ulang & menolak total klien yang berbeda | §3.2 |
| TC-TRX-02 | P0 | UT/API | **Uang integer**: semua field uang integer Rupiah; desimal (`15000.5`), string, negatif, `NaN`, > `BIGINT` → 422; tidak ada floating error (mis. 3 × 12.500) | PRD §5 |
| TC-TRX-03 | P0 | API | **Snapshot harga**: ubah harga/nama/hapus produk setelah transaksi → transaksi lama, struk, laporan, ekspor tidak berubah | PRD §5 |
| TC-TRX-04 | P0 | API | Request berisi `options`/`option_group` → ditolak/diabaikan sesuai kontrak (tanpa varian) | Keputusan 1 |
| TC-TRX-05 | P0 | API | Nomor transaksi unik `{OUTLET}-{DEV}-{YYMMDD}-{seq4}`; duplikat `(outlet_id, number)` ditolak | §2.4 |
| TC-TRX-06 | P0 | API | Idempoten: `POST` dengan `id` klien sama dikirim 2× → satu transaksi, respons `duplicate`; tidak double-count di shift | §4 |
| TC-TRX-07 | P0 | API | Produk nonaktif/habis → `PRODUCT_UNAVAILABLE` (online); qty 0/negatif/>batas → 422; keranjang kosong → 422 | P-03 |
| TC-TRX-08 | P0 | API | Transaksi `paid` tak bisa diedit: tidak ada `PATCH /transactions`; update langsung ke DB kolom finansial ditolak trigger; `TRANSACTION_NOT_EDITABLE` | PRD §5 |
| TC-TRX-09 | P1 | DEV | Katalog: grid per kategori, pencarian (huruf besar/kecil, spasi), hanya produk aktif & tersedia | P-03 |
| TC-TRX-10 | P1 | DEV | Keranjang: ubah qty, catatan item, hapus item, label pembeli opsional; total tampil live | P-05 |
| TC-TRX-11 | P0 | API | Cash: `cash_tendered < total` → `CASH_INSUFFICIENT`; `= total` kembalian 0; `> total` kembalian = selisih | P-06 |
| TC-TRX-12 | P1 | DEV | Tombol nominal cepat (pas, 20k, 50k, 100k) mengisi nilai benar; kembalian tampil benar | P-06 |
| TC-TRX-13 | P1 | API/DEV | Riwayat: filter metode bayar, detail, badge status & penanda "belum tersinkron" | P-09 |
| TC-TRX-14 | P0 | API | Concurrency: 2 perangkat membuat transaksi bersamaan → nomor unik, total shift benar | A-1 |
| TC-TRX-15 | P1 | API | Waktu: `client_created_at` dipakai laporan; selisih >10 menit dengan server ditandai `clock_skew` di audit | R-4 |
| TC-TRX-16 | P1 | API | Hari bisnis dihitung WIB: transaksi 23:59 vs 00:01 WIB masuk hari yang benar di dashboard | A-2 |

### 5.4 QRIS manual (P-07)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-QRS-01 | P0 | API | `POST /transactions` method qris → `status=pending`, payment `confirmation_mode=manual`, `qr_payload`, `expires_at` (15 menit) | §5.2 |
| TC-QRS-02 | P0 | DEV | QR tampil + nominal besar + hitung mundur; tombol **Sudah Dibayar** & **Batal**; dialog konfirmasi menyebut nominal | §7 UI |
| TC-QRS-03 | P0 | API | `POST /payments/{id}/confirm` → payment & transaksi `paid`; tercatat `confirmed_by` + audit `payment.qris_manual_confirmed` | §5.3 |
| TC-QRS-04 | P0 | API | Confirm dua kali / confirm setelah `cancelled` atau expired → ditolak/idempoten, tidak ada perubahan total | §3.3 |
| TC-QRS-05 | P0 | API | Batal oleh kasir → `cancelled`; transaksi tidak masuk omzet, tidak masuk expected cash | Q-1 |
| TC-QRS-06 | P0 | API | Pending > 15 menit → job menandai `cancelled`/payment `expired`; confirm sesudahnya ditolak | §5.3 |
| TC-QRS-07 | P0 | DEV/API | Offline: tombol QRIS disabled + pesan; API `QRIS_OFFLINE_UNSUPPORTED` bila dipaksa | §2.4 |
| TC-QRS-08 | P1 | DEV | QR (statis bernominal bila diaktifkan) terbaca ≥3 aplikasi e-wallet/m-banking dengan nominal benar; fallback bila ditolak | §5.3 |
| TC-QRS-09 | P1 | E2E | Owner melihat daftar QRIS terkonfirmasi manual per shift (untuk cocokkan mutasi bank); total QRIS terpisah dari kas di ringkasan shift | R-1/R-2 |
| TC-QRS-10 | P1 | API | Mode `auto` (mock provider): webhook valid → paid; signature salah → ditolak; webhook ganda idempoten | §5.4 (kontrak saja) |
| TC-QRS-11 | P1 | API | Owner mengganti gambar/payload QRIS di Pengaturan → transaksi baru memakai payload baru, lama tidak berubah | O-10 |
| TC-QRS-12 | P1 | DEV | App dimatikan/di-background saat QR tampil lalu dibuka → pending dipulihkan, tidak membuat transaksi ganda | P-07 |

### 5.5 State machine transaksi & void (P-10, O-08)
Status: `pending / paid / void_requested / voided / cancelled`.
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-STM-01 | P0 | UT/API | Transisi **valid**: cash→paid; qris→pending→paid; pending→cancelled; paid→void_requested; void_requested→voided; void_requested→paid (tolak); paid→voided (owner langsung) | §3.3 |
| TC-STM-02 | P0 | UT/API | Transisi **tidak valid** ditolak dan tidak mengubah data: voided→paid, cancelled→paid, voided→void_requested, pending→void_requested, pending→voided, cancelled→voided, paid→pending, paid→cancelled | §3.3 |
| TC-STM-03 | P0 | API | CHECK constraint DB menolak nilai status di luar 5 status | §3.2 |
| TC-STM-04 | P0 | API | Pegawai ajukan void wajib alasan; tanpa alasan → 422; transaksi → `void_requested` + audit `transaction.void_requested` | P-10 |
| TC-STM-05 | P0 | API/E2E | Owner approve → `voided`, keluar dari omzet/expected cash; audit `...approved` | O-08 |
| TC-STM-06 | P0 | API/E2E | Owner tolak → kembali `paid`; audit `...rejected` | O-08 |
| TC-STM-07 | P0 | API | Approve via PIN owner di perangkat: PIN salah ditolak & dirate-limit; benar → diaudit; tidak membuat sesi owner | §2.3 |
| TC-STM-08 | P0 | API | `void_requested` tetap dihitung di omzet/expected cash sampai diputuskan; dilaporkan terpisah | §3.2 |
| TC-STM-09 | P0 | API | Void dua kali / approve dua kali (race) → hasil tunggal, tidak double-subtract | §3.3 |
| TC-STM-10 | P0 | API | Audit log append-only: role DB aplikasi tidak bisa `UPDATE/DELETE` audit_logs | §3.2 |
| TC-STM-11 | P1 | API | Audit untuk `product.price_changed`, `product.deleted`, `device.revoked` tertulis dalam transaksi DB yang sama | §3.2 |

### 5.6 Offline → online (P-13)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-OFF-01 | P0 | DEV | Shift **dibuka saat online**, lalu mode pesawat: login PIN lokal, transaksi cash 5×; badge "5 belum tersinkron"; QRIS disabled | P-13, R-8 |
| TC-OFF-02 | P0 | DEV/API | Online kembali: auto-sync ≤30 dtk; semua `applied`; jumlah, nomor, total, `client_created_at` sama dengan di perangkat | P-13 |
| TC-OFF-03 | P0 | DEV/API | Putus koneksi **di tengah** push batch → retry tidak menggandakan (idempoten UUIDv7); tidak ada transaksi hilang | §2.4 |
| TC-OFF-04 | P0 | API | Harga produk berubah saat kasir offline → server **menerima** snapshot klien, `price_mismatch=true`, audit `sync.price_mismatch` | §2.4 |
| TC-OFF-05 | P0 | API | Produk dinonaktifkan saat offline → diterima + ditandai, tidak ditolak | §2.4 |
| TC-OFF-06 | P0 | API/DEV | Mutasi `rejected` (mis. kode validasi/payload tidak valid pada `/sync/push`, **bukan** `SHIFT_CLOSED`) tetap di outbox, di-flag dan ditampilkan ke pegawai agar bisa ditindaklanjuti; mutasi `applied`/`duplicate` dihapus dari outbox | ADR-0008 |
| TC-OFF-07 | P0 | DEV | Aplikasi di-kill/restart/baterai habis saat offline → outbox SQLite utuh, tidak ada data hilang | R-3 |
| TC-OFF-08 | P0 | DEV/API | Dua perangkat offline membuat transaksi masing-masing → nomor tidak bentrok, total shift gabungan benar | A-1 |
| TC-OFF-09 | P1 | DEV | Perangkat dicabut (revoke) saat offline → setelah online sesi gugur dan cache PIN dihapus; transaksi offline sebelumnya diperlakukan sesuai kebijakan (catat hasil) | R-5 |
| TC-OFF-10 | P1 | DEV | Pull katalog: owner tambah/ubah/nonaktifkan produk → muncul di kasir < 1 menit (online); tombstone menghapus produk lama | PRD §6 |
| TC-OFF-11 | P1 | DEV | Jam perangkat salah >10 menit → peringatan jam di aplikasi; audit `clock_skew` | R-4 |
| TC-OFF-12 | P1 | DEV | Reconnect flapping (on/off berulang) tidak menimbulkan duplikat atau crash | NF |
| TC-OFF-13 | P0 | DEV/API | **Negatif**: buka shift saat offline ditolak dengan pesan jelas (mis. "Buka shift butuh internet; sambungkan lalu coba lagi"); tidak ada shift/outbox terbentuk; transaksi tetap tidak bisa dibuat; setelah online buka shift berhasil | R-8, ADR-0009 |

### 5.7 Printer thermal & struk (P-08, K-12, O-10)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-PRN-01 | P0 | DEV | Layar Printer: scan → daftar → hubungkan → status terhubung; izin Bluetooth Android 12+ (`BLUETOOTH_SCAN/CONNECT`) diminta benar, penolakan ditangani | K-12 |
| TC-PRN-02 | P0 | DEV | Cetak tes menghasilkan struk terbaca 58 mm (lebar 32 kolom), tidak terpotong | K-12 |
| TC-PRN-03 | P0 | DEV | Toggle "Cetak struk" di layar Cash & QRIS: ON → cetak otomatis setelah paid; OFF → tidak cetak; preferensi tersimpan | P-08 |
| TC-PRN-04 | P0 | DEV | Isi struk: nama toko, alamat, nomor transaksi, tanggal WIB, pegawai, item/qty/harga snapshot, total, metode, tunai/kembalian, footer; nominal sama dengan layar | O-10 |
| TC-PRN-05 | P0 | DEV | QRIS pending/cancelled **tidak** mencetak struk lunas | P-07 |
| TC-PRN-06 | P1 | DEV | Cetak ulang dari riwayat → struk identik (snapshot), diberi penanda "SALINAN" bila didefinisikan desain | P-08 |
| TC-PRN-07 | P0 | DEV | Printer mati/di luar jangkauan/kertas habis saat cetak → transaksi **tetap tersimpan sebagai paid**, error jelas + opsi coba lagi; tidak ada transaksi ganda | R-6 |
| TC-PRN-08 | P1 | DEV | Reconnect otomatis setelah app restart; gonta-ganti printer | K-12 |
| TC-PRN-09 | P1 | DEV | Nama produk panjang & karakter non-ASCII/emoji: wrap benar, tidak mengacaukan perintah ESC/POS | P-08 |
| TC-PRN-10 | P1 | DEV | Struk digital (share WhatsApp/gambar) tetap tersedia & identik dengan cetak; offline tetap bisa | P-08 |
| TC-PRN-11 | P1 | E2E/DEV | Owner ubah header/footer/nama toko/alamat di Pengaturan → struk berikutnya (digital & cetak) memakai nilai baru; struk lama tidak berubah | O-10 |

### 5.8 Dashboard owner (O-02, O-03, O-04, O-05, O-06, O-07, O-10)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-DSH-01 | P0 | API/E2E | Omzet hari ini = Σ total `paid` + `void_requested`; **tidak** termasuk `pending`, `cancelled`, `voided`; dicocokkan terhadap dataset seed bernilai diketahui | O-02 |
| TC-DSH-02 | P0 | API | Jumlah transaksi, rata-rata (pembulatan terdokumentasi, integer), split cash vs QRIS konsisten dengan daftar transaksi | O-02 |
| TC-DSH-03 | P1 | API | Produk terlaris (qty & omzet) dan grafik per jam/hari benar di batas hari WIB | O-02 |
| TC-DSH-04 | P1 | E2E | Dashboard < 3 dtk dengan 500 trx/hari × 30 hari; responsif 1440/768/390 | NF |
| TC-LST-01 | P0 | E2E/API | Filter tanggal, pegawai, metode, status (5 status) berkombinasi benar; paginasi cursor tanpa duplikat/lompat | O-03 |
| TC-LST-02 | P0 | API | Ekspor CSV/XLSX: jumlah baris & total sama dengan layar; format uang integer; karakter khusus (koma, kutip, newline) ter-escape; hindari CSV/formula injection (`=`, `+`, `@`) | O-03 |
| TC-LST-03 | P1 | E2E | Detail transaksi menampilkan item snapshot, pembayaran, riwayat status/audit | O-03 |
| TC-PRD-01 | P0 | E2E/API | CRUD produk: buat (nama, harga integer ≥0, kategori, foto, aktif); validasi nama kosong/harga negatif/desimal | O-04 |
| TC-PRD-02 | P0 | API | Ubah harga → audit `product.price_changed`; transaksi lama tak berubah (lihat TC-TRX-03) | O-04 |
| TC-PRD-03 | P1 | E2E | Produk baru/ubah/nonaktif muncul di kasir < 1 menit | O-04 |
| TC-PRD-04 | P1 | API | Upload foto: tipe & ukuran dibatasi (presigned), file non-gambar ditolak | O-04 |
| TC-PRD-05 | P1 | E2E | Kategori CRUD; hapus kategori berisi produk ditangani (ditolak/dipindahkan sesuai kontrak) | O-05 |
| TC-PRD-06 | P1 | API | Tidak ada endpoint/UI option-group (varian dihapus) | Keputusan 1 |
| TC-EMP-01 | P1 | E2E | Tambah pegawai, set PIN 6 digit (validasi 5/7 digit, huruf), nonaktifkan, reset PIN | O-06 |
| TC-SET-01 | P1 | E2E | Pengaturan toko: nama, alamat, logo, footer struk, data QRIS; validasi & persist | O-10 |
| TC-DEV-01 | P1 | E2E | Tambah perangkat menampilkan kode 8 karakter; daftar & revoke perangkat | P-01 |

### 5.9 Fitur Should (diuji bila masuk rilis)
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-SHD-01 | P2 | API/DEV | Tandai produk habis sementara (P-11) → tersinkron ke owner & kasir lain < 1 menit | P-11 |
| TC-SHD-02 | P2 | E2E/API | Laporan penjualan per produk/pegawai/metode/hari; total = dashboard | O-09 |
| TC-SHD-03 | P2 | API | Daftar void-request owner; approve/reject massal tidak ada | O-08 |

### 5.10 Non-fungsional
| ID | P | Kat | Skenario & ekspektasi | Peta |
|---|---|---|---|---|
| TC-NF-01 | P0 | DEV | **Target ≤3 tap / ≤15 dtk per transaksi** (lihat §7) | PRD §1 |
| TC-NF-02 | P1 | DEV | Respons tap < 300 ms pada HP RAM kecil; tidak ada jaringan di jalur tap (uji mode pesawat) | PRD §6 |
| TC-NF-03 | P1 | DEV | Layout 360, 393, 430 px portrait: tidak ada teks terpotong, target sentuh ≥ 44 px, kontras tema gelap terbaca di bawah cahaya terang | Keputusan 2 |
| TC-NF-04 | P0 | API | Keamanan dasar: JWT kedaluwarsa/dimanipulasi, SQLi/XSS pada nama produk/catatan/label pembeli, rate limit login, CORS, header keamanan, tanpa secret di respons/log | §6 |
| TC-NF-05 | P1 | UAT | UI Bahasa Indonesia, format `Rp 12.500`, zona WIB konsisten di kasir, dashboard, struk, ekspor | PRD §6 |
| TC-NF-06 | P0 | UAT | Uji **restore backup**: pulihkan dump ke lingkungan terpisah, jumlah & total transaksi sama | §5/§8 Q-E |
| TC-NF-07 | P1 | API | Beban ringan: 500 transaksi/hari, puncak 30 trx/menit, p95 `POST /transactions` < 500 ms | A-1 |
| TC-NF-08 | P2 | DEV | Baterai/memori: sesi 4 jam penggunaan tanpa crash/ANR | NF |

## 6. Pemetaan Cakupan Fitur PRD → Test Case
| Fitur | Test case |
|---|---|
| P-01 | TC-AUTH-04…10, TC-DEV-01, TC-OFF-09 |
| P-02 | TC-SHF-01…04, TC-SHF-10, TC-SHF-17, TC-OFF-13 |
| P-03 | TC-TRX-07, TC-TRX-09, TC-OFF-10 |
| P-04 (dihapus) | TC-TRX-04, TC-PRD-06 (uji negatif) |
| P-05 | TC-TRX-10 |
| P-06 | TC-TRX-01, 02, 11, 12 |
| P-07 | TC-QRS-01…12, TC-STM-01/02 |
| P-08 | TC-PRN-01…11 |
| P-09 | TC-RBAC-02, TC-TRX-13 |
| P-10 | TC-STM-04…09, TC-SHF-13 |
| P-11 | TC-SHD-01 |
| P-12 | TC-SHF-05…09, 11, 14…16, 18 |
| P-13 | TC-OFF-01…13, TC-SHF-09 |
| O-01 | TC-AUTH-01…03 |
| O-02 | TC-DSH-01…04 |
| O-03 | TC-LST-01…03 |
| O-04 | TC-PRD-01…04 |
| O-05 (kategori saja) | TC-PRD-05, TC-PRD-06 |
| O-06 | TC-EMP-01, TC-RBAC-05/06, TC-AUTH-09/10 |
| O-07 | TC-SHF-12, TC-QRS-09 |
| O-08 | TC-STM-05…07, TC-SHD-03 |
| O-09 | TC-SHD-02 |
| O-10 | TC-SET-01, TC-PRN-11, TC-QRS-11 |
| Aturan PRD §5 | TC-TRX-02/03/08, TC-STM-01…03/10, TC-RBAC-01 |

O-11/O-12 (Could, fase 2) di luar lingkup; hanya diverifikasi bahwa `discount_amount`/`tax_amount` bernilai 0 (TC-TRX-01).

## 7. Prosedur Uji Target ≤3 Tap / ≤15 Detik (TC-NF-01)
- **Skenario baku**: kasir sudah login & shift terbuka, di layar katalog. Pesanan 1 produk favorit, qty 1, bayar **cash pas** (A) dan **QRIS** (B).
- **Hitung tap**: tap produk (1) → tombol Bayar/Cash (2) → "Pas"/konfirmasi (3) [target ≤3; maksimum diterima 4 untuk 2 item berbeda]. Tap "Cetak struk" tidak dihitung bila toggle default ON.
- **Hitung waktu**: rekam layar (60 fps) dari sentuhan pertama sampai layar sukses; ukur frame-by-frame. **Sampel ≥20 transaksi** oleh 2 orang berbeda (1 orang baru dilatih 5 menit).
- **Lulus**: median ≤15 dtk dan p90 ≤ 20 dtk untuk skenario A dan 2-item; QRIS diukur terpisah (bergantung pembeli) sampai layar QR tampil ≤ 10 dtk.
- Bukti: video + tabel hasil di komentar issue Q-D.

## 8. Strategi Otomasi & CI
| Lapisan | Cakupan | Alat | Pemicu |
|---|---|---|---|
| API contract (Q-B) | Semua operasi `openapi.yaml`: skema respons, kode status, `problem+json` stabil; fuzz ringan | schemathesis (+ Dredd untuk contoh) | tiap PR ke `main` |
| API stateful | TC-SHF/TRX/STM/QRS/OFF (sisi server) lewat skenario berurutan + hitung ulang uang | pytest/Vitest + client OpenAPI | tiap PR |
| E2E dashboard (Q-C) | TC-AUTH-01, TC-PRD, TC-LST, TC-DSH, TC-SHF-12, TC-STM-05/06, TC-SET-01 | Playwright (Chromium + Firefox; 1 run mobile viewport) | tiap PR / nightly penuh |
| Perangkat nyata (Q-D) | TC-OFF, TC-PRN, TC-QRS-02/07/08, TC-SHF-09, TC-NF-01/02/03 | manual terjadwal + skrip adb untuk offline | per build rilis |
| UAT (Q-E) | Skrip §9 | manual bersama owner | sebelum rilis |
Aturan: data uji dibuat via API/seed idempoten; tiap test membersihkan datanya; kredensial dari secret CI; tidak ada secret di repo.

## 9. UAT Bersama Owner
Peserta: Albert (owner) + 1–2 pegawai. Lingkungan: staging dengan HP & printer uji.
| # | Skrip UAT | Kriteria lulus |
|---|---|---|
| U-1 | Owner buat produk, kategori, pegawai, daftarkan HP kasir | Produk muncul di HP < 1 menit |
| U-2 | Pegawai buka shift (modal Rp 100.000), jual 5 cash + 3 QRIS (1 dibatalkan), cetak struk | Total, kembalian, struk benar |
| U-3 | Matikan Wi-Fi, jual 3 cash, nyalakan lagi | Semua tersinkron, owner melihat |
| U-4 | Pegawai ajukan void; owner approve & tolak masing-masing 1 | Omzet & kas terkoreksi |
| U-5 | Tutup shift dengan selisih sengaja (−Rp 5.000) | Owner lihat selisih < 1 menit |
| U-6 | Owner ekspor CSV, cocokkan dengan catatan U-2…U-5 | Sama persis |
| U-7 | Pegawai coba buka halaman/laporan owner | Ditolak |
| U-8 | Uji restore backup (TC-NF-06) | Data identik |
Sign-off tertulis owner dicatat di issue Q-E.

## 10. Kriteria Masuk, Keluar & Severity
**Masuk**: TDD/openapi disetujui; build staging terdeploy; data seed tersedia; perangkat uji siap.
**Keluar (siap rilis)**: 100% P0 lulus; ≥95% P1 lulus tanpa S1/S2; regression penuh dijalankan pada build kandidat rilis; UAT ditandatangani; restore backup terbukti.

| Severity | Definisi | Contoh |
|---|---|---|
| S1 Kritis | Uang salah/hilang, kebocoran data, bypass RBAC, crash di alur bayar | total salah, transaksi hilang saat sync, pegawai lihat omzet |
| S2 Tinggi | Fitur Must tak berfungsi, ada workaround sulit | printer tak mencetak, shift tak bisa ditutup |
| S3 Sedang | Fitur sebagian, UI/validasi salah, ada workaround | filter salah, teks terpotong |
| S4 Rendah | Kosmetik/teks | typo, spasi |
Bug dilaporkan sebagai issue: judul ringkas, langkah reproduksi, expected vs actual, severity, build/perangkat, lampiran bukti.

## 11. Risiko Pengujian & Asumsi
- Printer/QRIS bergantung perangkat fisik & e-wallet nyata → butuh jadwal & printer dari owner (Q-D).
- Pengujian offline dengan HP fisik sulit diotomasi → manual terstruktur + skrip adb.
- Mode QRIS `auto` hanya diuji dengan mock sampai owner memilih gateway.
- Perlakuan void yang disetujui setelah shift ditutup (TC-SHF-13) dan transaksi offline dari perangkat yang dicabut (TC-OFF-09) belum jelas di TDD v1.1 → minta klarifikasi Tech Lead.
- Buka shift wajib online (R-8): bila internet mati sebelum buka toko, kasir tidak bisa berjualan; diuji di TC-OFF-13 dan dicatat sebagai risiko operasional UAT.

## 12. Jadwal Mengikuti TDD §8.5
Q-A (dokumen ini) → Q-B (setelah B-8, T-2) → Q-C (setelah F-3, F-4, F-7) → Q-D (setelah M-13) → Q-E (setelah semua Must).
