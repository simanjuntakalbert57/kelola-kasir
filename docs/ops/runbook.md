# Runbook operasional (DEAR-19)

Ringkas dan praktis untuk owner dan Tech Lead. Setup awal: [deploy.md](deploy.md). Backup/restore detail: [backup-restore.md](backup-restore.md). APK: [apk-release.md](apk-release.md). Keputusan hosting: [ADR-0012](../adr/0012-vps-hosting.md).

| Hal | Di mana |
|---|---|
| Dashboard | `https://kelola-kasir.pages.dev` |
| API | `https://<API_DOMAIN>` (`/livez`, `/healthz`, `/v1/*`) |
| Server | VPS Rumahweb, folder `/opt/kelola-kasir`. Semua perintah Docker lewat `./compose.sh` di folder itu |
| Log API | `./compose.sh logs -f --tail 200 api` (Caddy: `caddy`, DB: `db`) |
| Error | Sentry → project `kelola-kasir-api` |
| Deploy | GitHub → Actions → Deploy API to VPS |
| Backup | timer `kelola-kasir-backup.timer` (01:00 WIB), bucket `kelola-kasir-backup/postgres/`, status di healthchecks.io |
| Sumber daya server | client area Rumahweb (status VPS), `htop`; `df -h`, `docker stats --no-stream` |

## Deploy

**API.** Merge PR ke `main`. Setelah CI hijau, workflow **Deploy API to VPS** membangun image `ghcr.io/simanjuntakalbert57/kelola-kasir-api:<sha>`, menyalin `ops/vps` ke server, lalu menjalankan `docker compose up --wait`. Container menjalankan migrasi lalu server.
- Bila versi baru tidak sehat dalam 4 menit (misalnya migrasi gagal), workflow otomatis mengembalikan versi sebelumnya dan job ditandai gagal (email ke owner).
- Cek: ringkasan job menampilkan `deployed <sha>`, lalu `curl https://<API_DOMAIN>/healthz`.
- Deploy manual: Actions → Deploy API to VPS → Run workflow (tag kosong = `main` terbaru).
- Ada jeda beberapa detik saat container API diganti. Aplikasi kasir mencoba ulang otomatis. Deploy besar sebaiknya di luar jam buka.
- Migrasi harus **kompatibel ke belakang** (expand → deploy → contract), karena rollback tidak membatalkan migrasi.
- Perubahan di `ops/vps/compose.yaml` atau `Caddyfile` ikut ter-deploy dengan cara yang sama. `.env` di server tidak pernah ditimpa.

**Ganti nilai di `.env`** (secret, domain, Sentry): edit `/opt/kelola-kasir/.env`, lalu `./compose.sh up -d --wait`. Compose hanya membuat ulang container yang konfigurasinya berubah.

**Dashboard.** Merge ke `main` → Cloudflare Pages build otomatis (±2–4 menit). Setiap PR mendapat preview URL `<hash>.kelola-kasir.pages.dev`. Preview memakai API produksi yang sama, jadi jangan dipakai untuk eksperimen data.

**Aplikasi kasir.** Lihat [apk-release.md](apk-release.md). Naikkan `expo.version` dan `android.versionCode` di `apps/kasir/app.json` setiap rilis.

## Rollback

**API (cepat, < 5 menit).** Cari SHA commit terakhir yang sehat (GitHub → Actions → Deploy API to VPS → run sukses sebelumnya, baris `Image:`). Lalu Actions → Deploy API to VPS → Run workflow, isi `tag` = SHA lengkap (40 karakter). Setelah itu buat PR revert di `main`, supaya deploy berikutnya tidak membawa bug yang sama.
- Bila deploy membawa migrasi yang tidak kompatibel dengan kode lama: jangan rollback. Perbaiki maju (hotfix PR), atau restore DB (§ Restore) bila data rusak.

**Dashboard.** Cloudflare → Pages → `kelola-kasir` → Deployments → pilih deploy lama → **Rollback to this deployment**.

**APK.** Pasang ulang APK versi sebelumnya (simpan salinan setiap APK rilis di Drive owner; artifact Actions kedaluwarsa setelah 14 hari). Android menolak downgrade `versionCode`. Untuk downgrade: pastikan semua transaksi tersinkron ("0 transaksi belum tersinkron"), uninstall, pasang APK lama, lalu pairing ulang.

## Restore backup

Ringkas (detail: [backup-restore.md](backup-restore.md)):
1. Hentikan tulisan baru: `./compose.sh stop api`.
2. Unduh file backup yang dipilih dari bucket ke laptop, lalu dekripsi + restore ke database **kosong** di VPS:
   ```sh
   ./compose.sh exec -T db createdb -U kelola_kasir kelola_kasir_restore
   # salin file .dump.age dan kunci privat age ke /opt/kelola-kasir/backups/ (hapus kuncinya setelah selesai)
   ./compose.sh --profile backup run --rm -e AGE_IDENTITY_FILE=/backups/kelola-kasir-backup.key \
     --entrypoint /opt/backup/restore.sh backup /backups/<file>.dump.age \
     "postgres://kelola_kasir:<POSTGRES_PASSWORD>@db:5432/kelola_kasir_restore"
   ./compose.sh --profile backup run --rm --entrypoint /opt/backup/verify-restore.sh backup \
     "postgres://kelola_kasir:<POSTGRES_PASSWORD>@db:5432/kelola_kasir_restore"
   rm backups/kelola-kasir-backup.key
   ```
3. Tukar database: `./compose.sh exec -T db psql -U kelola_kasir -d postgres -c 'ALTER DATABASE kelola_kasir RENAME TO kelola_kasir_old' -c 'ALTER DATABASE kelola_kasir_restore RENAME TO kelola_kasir'`.
4. `./compose.sh up -d --wait`. Migrasi idempoten berjalan saat start. Cek `/healthz`. Hapus `kelola_kasir_old` setelah owner memastikan data benar.
5. HP kasir menyinkronkan ulang outbox otomatis. Beri tahu owner rentang data yang mungkin hilang.

**VPS hilang atau rusak total:** order/reinstall VPS (AlmaLinux 8.9 atau OS lain yang didukung `setup.sh`), jalankan deploy.md langkah 4–6 dengan **`.env` dan nilai secret yang sama** dari password manager. Deploy membuat database kosong. Lalu jalankan langkah restore di atas (lewati langkah 1). Bila IP berubah: perbarui DNS A record, variable `VPS_HOST` dan `VPS_KNOWN_HOSTS`. Target pemulihan: ≤ 2 jam.

Uji restore bulanan: checklist di backup-restore.md.

## Reset data sebelum go-live

Setelah UAT lolos dan owner setuju:
1. Pastikan semua HP kasir sudah sinkron, lalu tutup shift.
2. Jalankan backup manual sebagai arsip UAT: `sudo -u deploy /opt/kelola-kasir/backup-now.sh`.
3. Kosongkan database:
   ```sh
   cd /opt/kelola-kasir
   ./compose.sh stop api
   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir \
     -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public' -c 'DROP SCHEMA IF EXISTS drizzle CASCADE'
   ```
   Role `backup_ro` tetap ada dan tetap bisa membaca tabel baru (`pg_read_all_data`).
4. Ubah `SENTRY_ENVIRONMENT=production` di `.env`, lalu jalankan `./compose.sh up -d --wait`. Migrasi membuat skema baru saat start. Cek `/healthz`.
5. Buat owner lagi (deploy.md langkah 8), lalu isi Pengaturan toko, pegawai, dan produk.
6. Di setiap HP: uninstall APK staging, pasang APK rilis signed, lalu pairing ulang dengan kode baru dari dashboard (apk-release.md).
7. Hapus foto uji di bucket media bila perlu.

## Perawatan server

- **Update keamanan** dipasang otomatis setiap hari (`dnf-automatic` di AlmaLinux, `unattended-upgrades` di Ubuntu). Bila kernel ikut diperbarui (cek `dnf needs-restarting -r` di AlmaLinux; di Ubuntu login SSH menampilkan `*** System restart required ***`), reboot **di luar jam buka**: `sudo reboot`. Semua container menyala lagi sendiri (`restart: unless-stopped`). Setelah itu cek `/healthz`.
- **Update image dasar** (Postgres 16 minor, Caddy): `./compose.sh pull db caddy && ./compose.sh up -d --wait`, di luar jam buka. Jangan ganti versi mayor Postgres tanpa rencana dump/restore.
- **Disk**: `df -h` (target < 70%) dan `docker system df`. Image lama dibersihkan otomatis saat deploy. Log Docker dibatasi 100 MB per container.
- **Snapshot/backup VPS dari Rumahweb** (opsional, bila paketnya menyediakan) sebelum perubahan besar. Snapshot bukan pengganti backup harian di luar VPS.
- **Perpanjangan VPS dan domain**: catat tanggal jatuh tempo di kalender owner. Layanan yang telat diperpanjang bisa dihentikan penyedia.

## Masalah umum

| Gejala | Penyebab / tindakan |
|---|---|
| `/healthz` tidak bisa diakses, client area Rumahweb menunjukkan VPS mati | Start/reboot VPS dari client area, atau hubungi support Rumahweb. Container ikut menyala. Kasir tetap bisa transaksi cash offline selama server mati. |
| `/healthz` → `db: down` | `./compose.sh ps` dan `./compose.sh logs db`. Disk penuh? (`df -h`). Lalu `./compose.sh up -d --wait`. |
| Error sertifikat HTTPS | DNS A record belum mengarah ke IP VPS, atau port 80/443 tertutup. Cek `./compose.sh logs caddy`. |
| Deploy gagal di "Set up SSH" / `Host key verification failed` | Variable `VPS_KNOWN_HOSTS` salah, atau VPS di-reinstall (host key baru). Ambil ulang: `ssh-keyscan -t ed25519 <ip-vps>`. |
| Deploy gagal, log "new release is unhealthy" | Versi lama sudah dikembalikan otomatis. Baca log API di job, lalu perbaiki lewat PR. |
| Dashboard login gagal tapi API sehat | Cek env Pages `API_ORIGIN` dan `PROXY_SHARED_SECRET` (harus sama dengan `.env` VPS). `https://kelola-kasir.pages.dev/v1/me` harus 401. |
| Upload foto gagal | Cek CORS bucket media dan `STORAGE_*` di `.env`. |
| Email healthchecks.io "backup down" | `systemctl status kelola-kasir-backup.service` dan `journalctl -u kelola-kasir-backup.service -n 100`. Jalankan ulang: `sudo -u deploy /opt/kelola-kasir/backup-now.sh`. |
| Error 5xx | Sentry menampilkan route dan request id. Cari request id di `./compose.sh logs api`. |

## Pantauan rutin

- **Mingguan:** Sentry issues baru, `df -h`, RAM/CPU (`htop`), status healthchecks.io.
- **Bulanan:** uji restore, umur backup terbaru < 26 jam, reboot terjadwal bila ada update kernel.
