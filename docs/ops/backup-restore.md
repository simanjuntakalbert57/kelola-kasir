# Backup harian dan restore (B-14)

Status: berlaku untuk MVP (TDD §6, ADR-0011 — menggantikan setup Railway dari ADR-0005). Skrip ada di `ops/backup/`, workflow di `.github/workflows/backup.yml`. Setup akun lengkap: [deploy.md](deploy.md).

Image backup memakai client PostgreSQL 16, jadi project Neon harus **Postgres 16**.

## Ringkasan

| Hal | Nilai |
|---|---|
| Frekuensi | Harian, 01:00 WIB (GitHub Actions `schedule`, `0 18 * * *` UTC) + `workflow_dispatch` untuk jalan manual |
| Isi | `pg_dump --format=custom` seluruh database (termasuk trigger dan tabel audit), lewat URL **direct** Neon (`DATABASE_URL_DIRECT`, bukan `-pooler`) |
| Enkripsi | `age` dengan kunci publik; kunci privat disimpan offline di password manager owner dan Tech Lead |
| Tujuan | Cloudflare R2 (atau Backblaze B2 bila R2 meminta kartu, ADR-0011), bucket khusus backup, prefix `postgres/` |
| Retensi | 30 hari (`RETENTION_DAYS`), dipangkas otomatis oleh `backup.sh` |
| Cadangan tambahan | PITR bawaan Neon Free (6 jam) |
| Target pemulihan | RPO ≤ 24 jam, RTO ≤ 2 jam |

## Setup (sekali)

1. Buat bucket R2 khusus backup (tanpa akses publik) dan API token R2 yang hanya boleh membaca/menulis/menghapus objek di bucket itu.
2. Buat pasangan kunci age di komputer aman (bukan di server): `age-keygen -o kelola-kasir-backup.key`.
   Simpan file `.key` di password manager (dua orang). Hanya **public key** (`age1...`) yang dipakai workflow.
3. Buat role Neon read-only khusus backup. Isi GitHub Actions secrets repo:

   | Secret | Nilai |
   |---|---|
   | `BACKUP_DATABASE_URL` | URL **direct** Neon dengan role backup, `sslmode=require` |
   | `AGE_RECIPIENT` | public key age |
   | `BACKUP_TARGET` | `s3://<bucket>/postgres` |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | token R2 |

   Workflow `.github/workflows/backup.yml` menjalankan `ops/backup/backup.sh` (image `ops/backup/Dockerfile`, client PostgreSQL 16) dengan
   `DATABASE_URL=${{ secrets.BACKUP_DATABASE_URL }}`. Repo publik: dump tidak boleh diunggah sebagai artifact dan tidak boleh tercetak di log.
   Secret hanya di GitHub Actions secrets, tidak pernah di repo.
4. Jalankan workflow sekali lewat `workflow_dispatch` dan pastikan objek `kelola-kasir-<UTC timestamp>.dump.age` muncul di bucket.
5. Alert: workflow gagal → email GitHub ke owner. GitHub menonaktifkan jadwal setelah 60 hari tanpa aktivitas repo, jadi uji restore bulanan
   juga mengecek umur objek terbaru di bucket (< 26 jam).

`backup.sh` gagal keras (exit ≠ 0) bila `pg_dump` gagal atau berkas hasil < 1 KB, sehingga backup kosong tidak dianggap sukses.

## Restore

Selalu restore ke database **kosong** baru (skrip menolak database yang sudah berisi tabel). Jangan pernah restore langsung di atas produksi.

```sh
# 1. unduh backup yang dipilih dari R2 (contoh dengan aws cli)
aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://<bucket>/postgres/kelola-kasir-20261026T200000Z.dump.age .

# 2. buat database kosong (branch/project Neon baru, atau createdb lokal)
createdb kelola_kasir_restore

# 3. dekripsi + restore (kunci privat dari password manager)
AGE_IDENTITY_FILE=./kelola-kasir-backup.key \
  ops/backup/restore.sh kelola-kasir-20261026T200000Z.dump.age "postgres://.../kelola_kasir_restore"

# 4. cek isi dan invarian
ops/backup/verify-restore.sh "postgres://.../kelola_kasir_restore"
```

`verify-restore.sh` menampilkan jumlah tabel (harus 19), jumlah outlet, pegawai, shift, transaksi, total rupiah transaksi `paid`,
jumlah audit log, dan jumlah migrasi terapan; `open_shifts_per_outlet_max` harus ≤ 1.

### Pemulihan produksi (bencana)

1. Hentikan API (suspend service di Render) agar tidak ada tulisan baru.
2. Restore backup terbaru ke instance Postgres baru (langkah di atas) dan jalankan `verify-restore.sh`.
3. Arahkan `DATABASE_URL` (pooled) dan `DATABASE_URL_DIRECT` API ke instance baru, jalankan migrasi (idempoten) lewat URL direct, lalu resume API.
   Alternatif lebih cepat bila kejadian < 6 jam lalu: restore PITR Neon ke branch baru.
4. Aplikasi kasir menyinkronkan ulang transaksi yang belum terkirim (outbox idempoten pada `id` klien), sehingga transaksi setelah titik backup
   yang masih ada di perangkat tidak hilang. Beri tahu owner rentang waktu data yang mungkin hilang (maks. 24 jam, sebelum sinkron ulang).

## Uji restore bulanan (checklist QA/Backend)

- [ ] Unduh backup terbaru, restore ke database kosong, `verify-restore.sh` lolos.
- [ ] Jumlah transaksi dan `paid_total_rupiah` sama dengan produksi pada waktu backup (selisih hanya dari transaksi setelah backup).
- [ ] Jalankan API terhadap hasil restore dan login owner berhasil (`/healthz`, `POST /v1/auth/login`).
- [ ] Catat tanggal, ukuran backup, dan durasi restore di komentar issue uji restore.
- [ ] Hapus database restore sesudahnya (data pelanggan/transaksi tidak dibiarkan di lingkungan uji).

Uji coba pertama (lokal, DEAR-8): backup, restore ke database kosong, dan `verify-restore.sh` berhasil; restore ke database berisi ditolak.
