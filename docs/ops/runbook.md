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

> **Produksi sudah berisi data asli toko sejak 29 Okt 2026.** Setiap deploy, migrasi, dan perintah SQL menyentuh data jualan sungguhan.

**Aturan deploy API (berlaku sejak freeze dicabut, DEAR-86):**
- Deploy API **hanya lewat CI**: merge PR ke `main` → CI hijau → workflow **Deploy API to VPS**. Tidak ada `docker`/`./compose.sh up` manual di VPS untuk deploy, kecuali rollback darurat.
- Workflow selalu menjalankan **backup sebelum rollout** (`BACKUP_REQUIRED=1 ./backup-now.sh`). Kalau backup gagal, rollout tidak dijalankan dan job gagal. Nama objek backup tercatat di log dan ringkasan job (`Backup before rollout: s3://…`).
- Migrasi DB hanya yang **aditif dan kompatibel mundur**: tambah tabel/kolom (nullable atau ber-default) boleh. **Dilarang** drop atau rename kolom/tabel yang masih dipakai APK di HP kasir. APK lama tetap jalan berhari-hari setelah API diperbarui. Penghapusan dilakukan bertahap (expand → semua HP sudah update → contract) di rilis terpisah.
- Deploy **di luar jam jualan toko**. Setelah deploy: cek `curl https://<API_DOMAIN>/healthz` dan lakukan 1 login dashboard.
- Rollback: lihat § Rollback (`workflow_dispatch` dengan SHA image sebelumnya). Restore backup hanya kalau data rusak.
- Dashboard Cloudflare Pages tetap auto-deploy dari `main`, jadi perubahan dashboard juga wajib di-review sebelum merge.

**API.** Merge PR ke `main`. Setelah CI hijau, workflow **Deploy API to VPS** membangun image `ghcr.io/simanjuntakalbert57/kelola-kasir-api:<sha>`, menyalin `ops/vps` ke server, menjalankan backup, lalu `docker compose up --wait`. Container menjalankan migrasi lalu server.
- Bila versi baru tidak sehat dalam 4 menit (misalnya migrasi gagal), workflow otomatis mengembalikan versi sebelumnya dan job ditandai gagal (email ke owner).
- Cek: ringkasan job menampilkan nama objek backup dan `deployed <sha>`, lalu `curl https://<API_DOMAIN>/healthz`.
- Deploy manual: Actions → Deploy API to VPS → Run workflow (tag kosong = `main` terbaru).
- Ada jeda beberapa detik saat container API diganti. Aplikasi kasir mencoba ulang otomatis.
- Rollback tidak membatalkan migrasi, karena itu migrasi wajib kompatibel mundur (aturan di atas).
- Perubahan di `ops/vps/compose.yaml` atau `Caddyfile` ikut ter-deploy dengan cara yang sama. `.env` di server tidak pernah ditimpa.

**Ganti nilai di `.env`** (secret, domain, Sentry): edit `/opt/kelola-kasir/.env`, lalu `./compose.sh up -d --wait`. Compose hanya membuat ulang container yang konfigurasinya berubah.

**Dashboard.** Merge ke `main` → Cloudflare Pages build otomatis (±2–4 menit). Setiap PR mendapat preview URL `<hash>.kelola-kasir.pages.dev`. Preview memakai API produksi yang sama, jadi jangan dipakai untuk eksperimen data.

**Aplikasi kasir.** Lihat [apk-release.md](apk-release.md). Naikkan `expo.version` dan `android.versionCode` di `apps/kasir/app.json` setiap rilis.

## Rollback

**API (cepat, < 5 menit).** Cari SHA commit terakhir yang sehat (GitHub → Actions → Deploy API to VPS → run sukses sebelumnya, baris `Image:`). Lalu Actions → Deploy API to VPS → Run workflow, isi `tag` = SHA lengkap (40 karakter). Rollback juga didahului backup otomatis. Setelah itu buat PR revert di `main`, supaya deploy berikutnya tidak membawa bug yang sama.
- Bila deploy membawa migrasi yang tidak kompatibel dengan kode lama: jangan rollback. Perbaiki maju (hotfix PR), atau restore DB (§ Restore) bila data rusak.
- Restore backup **hanya kalau data rusak**. Titik restore = objek `Backup before rollout` di ringkasan job deploy yang bermasalah. Data yang masuk setelah backup itu ikut hilang, jadi catat rentang waktunya untuk owner.

**Dashboard.** Cloudflare → Pages → `kelola-kasir` → Deployments → pilih deploy lama → **Rollback to this deployment**.

**APK.** Pasang ulang APK versi sebelumnya (simpan salinan setiap APK rilis di Drive owner; artifact Actions kedaluwarsa setelah 14 hari). Android menolak downgrade `versionCode`. Untuk downgrade: pastikan semua transaksi tersinkron ("0 transaksi belum tersinkron"), uninstall, pasang APK lama, lalu pairing ulang.

## Rotasi password database

Bila `POSTGRES_PASSWORD` pernah terlihat (log, screenshot, komentar), anggap bocor: Actions → **Rotate database password** →
Run workflow, ketik `rotate`. Password baru dibuat di VPS dan hanya ditulis ke `.env` (`ops/vps/rotate-db-password.sh`); API restart
beberapa detik, lalu workflow mengecek `/healthz` dan menjalankan satu backup. Setelahnya salin nilai baru dari `.env` VPS ke password manager.

## Notifikasi Web Push (kunci VAPID)

Notifikasi transaksi/void ke browser laptop owner (ADR-0017) memakai kunci VAPID di `.env` VPS: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`. Ketiganya terisi semua atau kosong semua; set parsial atau pasangan kunci tidak cocok membuat API menolak start.

- **Membuat kunci:** Actions → **Configure Web Push** → Run workflow. Pasangan kunci dibuat di VPS (`ops/vps/configure-web-push.sh`), ditulis
  ke `.env` (mode 600) dan tidak pernah dicetak. API restart beberapa detik. Idempotent: bila kunci sudah ada, tidak ada yang diubah.
- **Cek:** `GET /v1/notifications/push/config` (token owner) harus `configured: true`. Kunci publik tidak rahasia; kunci privat tidak boleh
  muncul di log, tiket, atau screenshot.
- **Tanpa kunci:** fitur mati sendiri (`configured: false`, subscribe/uji 503, tidak ada pengiriman). Transaksi tidak terpengaruh.
- **Rotasi:** jangan, kecuali kunci privat bocor. Mengganti kunci membatalkan **semua** langganan: setiap owner harus mengaktifkan ulang
  notifikasi di tiap browser (Pengaturan → Notifikasi). Bila terpaksa: hapus tiga baris `VAPID_*` dari `.env`, jalankan workflow di atas, lalu
  minta owner mendaftarkan ulang browser.
- **Troubleshooting:** notifikasi tidak muncul → cek `notification_log` (`status`, `last_error`; hanya status HTTP, tanpa endpoint):
  `./compose.sh exec db psql -U kelola_kasir -c "select event,status,attempts,last_error,created_at from notification_log order by created_at desc limit 20"`.
  `failed` dengan `HTTP 401/403` = kunci tidak cocok dengan langganan (kunci pernah diganti): daftar ulang browser. `expired` = laptop mati/tidur
  melewati batas 4 jam, sengaja dibuang. Langganan `expired` di daftar perangkat = push service melaporkan browser hilang (404/410): daftar ulang.

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

**VPS hilang atau rusak total:** order/reinstall VPS (Ubuntu 24.04, atau AlmaLinux/Rocky 8–9), jalankan deploy.md langkah 4–6 dengan **`.env` dan nilai secret yang sama** dari password manager. Deploy membuat database kosong. Lalu jalankan langkah restore di atas (lewati langkah 1). Bila IP berubah: perbarui DNS A record, variable `VPS_HOST` dan `VPS_KNOWN_HOSTS`. Target pemulihan: ≤ 2 jam.

Uji restore bulanan: checklist di backup-restore.md.

## Hapus data uji per outlet (Reset)

> ⚠️ **Produksi sudah berisi data asli toko (`JUS1`, sejak 29 Okt 2026).** Jangan pernah lagi menjalankan reset penuh
> (`DROP SCHEMA public CASCADE` atau `TRUNCATE` semua tabel). Cara itu ikut menghapus akun owner, outlet asli, Pengaturan,
> perangkat, dan seluruh transaksi. Data uji **wajib** dibuat di outlet terpisah, lalu dihapus per outlet dengan prosedur di bawah.

Prosedur ini dipakai 29 Okt 2026 untuk menghapus outlet QA `QAUJI` tanpa menyentuh `JUS1` (DEAR-19). Skripnya
`ops/vps/delete-outlet.sql` (ikut tersalin ke `/opt/kelola-kasir` saat deploy). Skrip menghapus satu outlet beserta semua isinya,
dan opsional akun owner ujinya, dalam **satu transaksi**:
- Trigger `transactions_no_delete`, `transaction_items_guard`, dan `audit_logs_append_only` dimatikan hanya di dalam transaksi itu, lalu diaktifkan lagi sebelum commit.
- Sebelum menghapus, skrip mengambil sidik (jumlah baris + md5) semua baris yang **tidak** termasuk outlet/user target di 18 tabel. Setelah menghapus, sidik dibandingkan. Kalau ada satu saja yang berbeda, transaksi di-rollback.
- Skrip menolak jalan bila kode outlet tidak ditemukan, atau bila user yang mau dihapus masih anggota outlet lain (misalnya akun owner asli).

Langkah (pelaksana: Tech Lead, di luar jam jualan, setelah owner/CTO setuju di issue):
1. Pastikan HP uji sudah tidak dipakai. HP kasir toko asli tidak perlu dihentikan.
2. Backup manual dulu, lalu catat nama objeknya sebagai titik rollback:
   ```sh
   cd /opt/kelola-kasir && ./backup-now.sh   # log: "backup: uploaded s3://…/kelola-kasir-<UTC>.dump.age"
   ```
3. Cek target dan pembanding (jumlah transaksi/shift/perangkat dari QA):
   ```sh
   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir -c \
     "select o.code, (select count(*) from transactions t where t.outlet_id=o.id) tx,
             (select count(*) from shifts s where s.outlet_id=o.id) shifts,
             (select count(*) from devices d where d.outlet_id=o.id) devices from outlets o order by o.code"
   ```
4. Hapus (ganti `QAUJI` dan email owner uji; `-v email=` kosong bila tidak ada user yang perlu dihapus):
   ```sh
   ./compose.sh exec -T db psql -U kelola_kasir -d kelola_kasir \
     -v code=QAUJI -v email=qa-uji-sementara@example.com < delete-outlet.sql
   ```
   Output berakhir dengan tabel `identical = t` untuk semua tabel, `COMMIT`, dan `deleted outlet QAUJI`. Kalau ada `ERROR`, tidak ada yang terhapus.
5. Verifikasi: jalankan lagi langkah 3 (outlet target hilang, outlet asli tidak berubah), `curl https://<API_DOMAIN>/healthz`, dan 1 login dashboard owner.
6. Hapus file kredensial uji di runtime, dan foto uji di bucket media bila ada. Tempel bukti (nama objek backup + output langkah 4–5) di issue.

Untuk uji berikutnya di produksi: buat owner + outlet uji lewat `create-owner` (deploy.md langkah 8) dengan kode outlet khusus uji, jangan pernah memakai akun owner atau outlet asli.

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
| Notifikasi laptop tidak muncul | Lihat bagian *Notifikasi Web Push* di atas (`notification_log`, status langganan, kunci VAPID). |
| Error 5xx | Sentry menampilkan route dan request id. Cari request id di `./compose.sh logs api`. |

## Pantauan rutin

- **Mingguan:** Sentry issues baru, `df -h`, RAM/CPU (`htop`), status healthchecks.io.
- **Bulanan:** uji restore, umur backup terbaru < 26 jam, reboot terjadwal bila ada update kernel.
