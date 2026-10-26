# Backup harian dan restore (B-14)

Status: berlaku untuk MVP (TDD §6, ADR-0012). Skrip ada di `ops/backup/`, dijalankan di VPS oleh `ops/vps/backup-now.sh` (service `backup` di `ops/vps/compose.yaml`). Setup akun lengkap: [deploy.md](deploy.md).

Image backup memakai client PostgreSQL 16, sama dengan versi database di VPS.

## Ringkasan

| Hal | Nilai |
|---|---|
| Frekuensi | Harian, 01:00 WIB (timer systemd `kelola-kasir-backup.timer`, dipasang `ops/vps/setup.sh`) + manual `backup-now.sh` |
| Isi | `pg_dump --format=custom` seluruh database (termasuk trigger dan tabel audit), dengan role read-only `backup_ro` |
| Enkripsi | `age` dengan kunci publik; kunci privat disimpan offline di password manager owner dan Tech Lead |
| Tujuan | **Di luar VPS**: Cloudflare R2 (atau Backblaze B2 bila R2 meminta kartu, ADR-0011), bucket khusus backup, prefix `postgres/` |
| Retensi | 30 hari (`RETENTION_DAYS`), dipangkas otomatis oleh `backup.sh` |
| Pemantauan | Ping ke healthchecks.io setelah setiap backup sukses; tidak ada ping 26 jam → email ke owner |
| Cadangan tambahan | Snapshot VPS hPanel (opsional, manual) |
| Target pemulihan | RPO ≤ 24 jam, RTO ≤ 2 jam |

## Setup (sekali)

Langkah lengkap ada di [deploy.md](deploy.md) langkah 2–5 dan 9. Ringkasnya:

1. Buat bucket khusus backup (tanpa akses publik) dan API token yang hanya bisa membaca/menulis/menghapus objek di bucket itu.
2. Buat pasangan kunci age di komputer aman (bukan di server): `age-keygen -o kelola-kasir-backup.key`.
   Simpan file `.key` di password manager (dua orang). Hanya **public key** (`age1...`) yang ditaruh di VPS.
3. Role database `backup_ro` (read-only, `pg_read_all_data`) dibuat otomatis oleh `ops/vps/initdb/10-backup-role.sh` saat volume database pertama kali dibuat. Passwordnya `BACKUP_DB_PASSWORD`.
4. Isi di `/opt/kelola-kasir/.env`:

   | Variable | Nilai |
   |---|---|
   | `AGE_RECIPIENT` | public key age |
   | `BACKUP_TARGET` | `s3://kelola-kasir-backup/postgres` |
   | `BACKUP_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` (atau endpoint B2) |
   | `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | token bucket backup |
   | `BACKUP_HEARTBEAT_URL` | ping URL healthchecks.io |

5. Jalankan sekali: `sudo -u deploy /opt/kelola-kasir/backup-now.sh`, lalu pastikan objek `kelola-kasir-<UTC timestamp>.dump.age` muncul di bucket dan healthchecks.io berstatus up.
6. Alert: healthchecks.io mengirim email bila ping harian tidak datang (backup gagal, timer mati, atau VPS mati).

`backup.sh` gagal keras (exit ≠ 0) bila `pg_dump` gagal atau berkas hasil < 1 KB, sehingga backup kosong tidak dianggap sukses.

## Restore

Selalu restore ke database **kosong** baru (skrip menolak database yang sudah berisi tabel). Jangan pernah restore langsung di atas produksi.

```sh
# Contoh di laptop dengan PostgreSQL 16 lokal. Di VPS: runbook.md § Restore backup.
# 1. unduh backup yang dipilih dari R2 (contoh dengan aws cli)
aws s3 cp --endpoint-url "$R2_ENDPOINT" s3://<bucket>/postgres/kelola-kasir-20261026T200000Z.dump.age .

# 2. buat database kosong
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

Langkah perintah di VPS ada di [runbook.md § Restore backup](runbook.md#restore-backup). Prinsipnya:


1. Hentikan API (`./compose.sh stop api`) agar tidak ada tulisan baru.
2. Restore backup terbaru ke database kosong baru (di VPS yang sama, atau VPS baru bila server hilang) dan jalankan `verify-restore.sh`.
3. Tukar nama database hasil restore menjadi `kelola_kasir`, lalu nyalakan API. Migrasi (idempoten) berjalan saat start.
4. Aplikasi kasir menyinkronkan ulang transaksi yang belum terkirim (outbox idempoten pada `id` klien), sehingga transaksi setelah titik backup
   yang masih ada di perangkat tidak hilang. Beri tahu owner rentang waktu data yang mungkin hilang (maks. 24 jam, sebelum sinkron ulang).

## Uji restore bulanan (checklist QA/Backend)

- [ ] Unduh backup terbaru, restore ke database kosong, `verify-restore.sh` lolos.
- [ ] Jumlah transaksi dan `paid_total_rupiah` sama dengan produksi pada waktu backup (selisih hanya dari transaksi setelah backup).
- [ ] Jalankan API terhadap hasil restore dan login owner berhasil (`/healthz`, `POST /v1/auth/login`).
- [ ] Catat tanggal, ukuran backup, dan durasi restore di komentar issue uji restore.
- [ ] Hapus database restore sesudahnya (data pelanggan/transaksi tidak dibiarkan di lingkungan uji).

Uji coba pertama (lokal, DEAR-8): backup, restore ke database kosong, dan `verify-restore.sh` berhasil; restore ke database berisi ditolak.
