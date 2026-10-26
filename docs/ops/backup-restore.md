# Backup harian dan restore (B-14)

Status: berlaku untuk MVP (TDD §6, ADR-0005). Skrip ada di `ops/backup/`.

## Ringkasan

| Hal | Nilai |
|---|---|
| Frekuensi | Harian, 03:00 WIB (cron Railway `0 20 * * *` UTC) |
| Isi | `pg_dump --format=custom` seluruh database (termasuk trigger dan tabel audit) |
| Enkripsi | `age` dengan kunci publik; kunci privat disimpan offline di password manager owner dan Tech Lead |
| Tujuan | Cloudflare R2, bucket khusus backup, prefix `postgres/` |
| Retensi | 30 hari (`RETENTION_DAYS`), dipangkas otomatis oleh `backup.sh` |
| Cadangan tambahan | Snapshot volume Postgres di Railway |
| Target pemulihan | RPO ≤ 24 jam, RTO ≤ 2 jam |

## Setup (sekali)

1. Buat bucket R2 khusus backup (tanpa akses publik) dan API token R2 yang hanya boleh membaca/menulis/menghapus objek di bucket itu.
2. Buat pasangan kunci age di komputer aman (bukan di server): `age-keygen -o kelola-kasir-backup.key`.
   Simpan file `.key` di password manager (dua orang). Hanya **public key** (`age1...`) yang dipakai server.
3. Di Railway buat service cron dari `ops/backup/Dockerfile` (root `ops/backup`), jadwal `0 20 * * *`, dengan variabel:

   | Variabel | Nilai |
   |---|---|
   | `DATABASE_URL` | referensi ke Postgres (private network) |
   | `AGE_RECIPIENT` | public key age |
   | `BACKUP_TARGET` | `s3://<bucket>/postgres` |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | token R2 |
   | `RETENTION_DAYS` | opsional, default 30 |

   Secret hanya diisi lewat secret manager Railway, tidak pernah di repo.
4. Jalankan service sekali secara manual dan pastikan objek `kelola-kasir-<UTC timestamp>.dump.age` muncul di bucket.
5. Pasang alert: bila cron gagal (exit code ≠ 0) Railway mengirim notifikasi; tambahkan juga monitor "objek terbaru di bucket < 26 jam" (Better Stack/UptimeRobot heartbeat).

`backup.sh` gagal keras (exit ≠ 0) bila `pg_dump` gagal atau berkas hasil < 1 KB, sehingga backup kosong tidak dianggap sukses.

## Restore

Selalu restore ke database **kosong** baru (skrip menolak database yang sudah berisi tabel). Jangan pernah restore langsung di atas produksi.

```sh
# 1. unduh backup yang dipilih dari R2 (contoh dengan aws cli)
aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://<bucket>/postgres/kelola-kasir-20261026T200000Z.dump.age .

# 2. buat database kosong (Railway: service Postgres baru, atau createdb lokal)
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

1. Hentikan API (scale ke 0) agar tidak ada tulisan baru.
2. Restore backup terbaru ke instance Postgres baru (langkah di atas) dan jalankan `verify-restore.sh`.
3. Arahkan `DATABASE_URL` API ke instance baru, jalankan `node dist/db/migrate.js` (idempoten) lalu start API.
4. Aplikasi kasir menyinkronkan ulang transaksi yang belum terkirim (outbox idempoten pada `id` klien), sehingga transaksi setelah titik backup
   yang masih ada di perangkat tidak hilang. Beri tahu owner rentang waktu data yang mungkin hilang (maks. 24 jam, sebelum sinkron ulang).

## Uji restore bulanan (checklist QA/Backend)

- [ ] Unduh backup terbaru, restore ke database kosong, `verify-restore.sh` lolos.
- [ ] Jumlah transaksi dan `paid_total_rupiah` sama dengan produksi pada waktu backup (selisih hanya dari transaksi setelah backup).
- [ ] Jalankan API terhadap hasil restore dan login owner berhasil (`/healthz`, `POST /v1/auth/login`).
- [ ] Catat tanggal, ukuran backup, dan durasi restore di komentar issue uji restore.
- [ ] Hapus database restore sesudahnya (data pelanggan/transaksi tidak dibiarkan di lingkungan uji).

Uji coba pertama (lokal, DEAR-8): backup, restore ke database kosong, dan `verify-restore.sh` berhasil; restore ke database berisi ditolak.
