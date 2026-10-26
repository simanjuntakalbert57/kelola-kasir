# Runbook operasional (DEAR-19)

Ringkas dan praktis untuk owner dan Tech Lead. Setup awal: [deploy.md](deploy.md). Backup/restore detail: [backup-restore.md](backup-restore.md). APK: [apk-release.md](apk-release.md).

| Hal | Di mana |
|---|---|
| Dashboard | `https://kelola-kasir.pages.dev` |
| API | `https://kelola-kasir-api.onrender.com` (`/livez`, `/healthz`, `/v1/*`) |
| Log API | Render → `kelola-kasir-api` → Logs |
| Error | Sentry → project `kelola-kasir-api` |
| Pemakaian kuota | Render → Billing/Usage (jam instance, bandwidth, build minutes); Neon → Usage (CU-jam); Cloudflare → Workers & Pages (request/hari) |
| Backup | GitHub → Actions → Database backup; bucket `kelola-kasir-backup/postgres/` |

## Deploy

**API.** Merge PR ke `main`. Render men-deploy otomatis setelah check GitHub hijau (`autoDeployTrigger: checksPass`), hanya bila file API berubah (`buildFilter` di `render.yaml`). Container menjalankan migrasi lalu server; deploy gagal bila migrasi gagal, dan versi lama tetap melayani.
- Cek: Render → Events "Deploy live", lalu `curl https://kelola-kasir-api.onrender.com/healthz`.
- Deploy manual: Render → Manual Deploy → Deploy latest commit.
- Migrasi harus **kompatibel ke belakang** (expand → deploy → contract) karena rollback tidak membatalkan migrasi.

**Dashboard.** Merge ke `main` → Cloudflare Pages build otomatis (±2–4 menit). Setiap PR mendapat preview URL `<hash>.kelola-kasir.pages.dev`; preview memakai API yang sama, jadi jangan dipakai untuk eksperimen data.

**Aplikasi kasir.** Lihat [apk-release.md](apk-release.md). Naikkan `expo.version` dan `android.versionCode` di `apps/kasir/app.json` setiap rilis.

**Batas yang perlu diingat:** Render 500 menit build/bulan (satu build ±5–8 menit), Pages 500 build/bulan. Gabungkan perubahan kecil sebelum merge.

## Rollback

**API (cepat, < 5 menit).** Render → Events → pilih deploy terakhir yang sehat → **Rollback**. Lalu revert commit penyebab di `main` (PR revert) supaya deploy berikutnya tidak membawa bug yang sama.
- Bila deploy membawa migrasi yang tidak kompatibel dengan kode lama: jangan rollback. Perbaiki maju (hotfix PR), atau restore DB (§ Restore) bila data rusak.

**Dashboard.** Cloudflare → Pages → `kelola-kasir` → Deployments → deploy lama → **Rollback to this deployment**.

**APK.** Pasang ulang APK versi sebelumnya dari artifact Actions lama (simpan salinan APK rilis di Drive owner, artifact Actions kedaluwarsa 14 hari). Android menolak downgrade `versionCode`; untuk downgrade, pastikan semua transaksi tersinkron ("0 transaksi belum tersinkron"), uninstall, pasang APK lama, pairing ulang.

## Restore backup

Ringkas (detail: [backup-restore.md](backup-restore.md)):
1. Render → Suspend service (hentikan tulisan baru).
2. Neon → buat **branch baru** (kosong) atau project baru PG 16. Untuk kejadian < 6 jam lalu, lebih cepat: Neon → Restore → branch dari titik waktu (PITR).
3. Unduh backup dari bucket, `ops/backup/restore.sh <file> <direct-url-baru>` (kunci privat age dari password manager), lalu `ops/backup/verify-restore.sh`.
4. Ganti `DATABASE_URL` (pooled) dan `DATABASE_URL_DIRECT` di Render ke branch baru → Resume service. Migrasi idempoten berjalan saat start.
5. HP kasir menyinkronkan ulang outbox otomatis. Beri tahu owner rentang data yang mungkin hilang.

Uji restore bulanan: checklist di backup-restore.md.

## Reset data sebelum go-live

Setelah UAT lolos dan owner setuju:
1. Pastikan semua HP kasir sudah sinkron, lalu tutup shift.
2. Jalankan backup manual (Actions → Database backup) sebagai arsip UAT.
3. Render → Suspend service.
4. Neon → SQL Editor (role utama):
   ```sql
   DROP SCHEMA public CASCADE; CREATE SCHEMA public;
   DROP SCHEMA IF EXISTS drizzle CASCADE;  -- tabel riwayat migrasi
   ```
5. Render → Environment: `SENTRY_ENVIRONMENT=production` → Resume service. Migrasi membuat skema baru saat start; cek `/healthz`.
6. Buat owner lagi (deploy.md langkah 7), isi Pengaturan toko, pegawai, produk.
7. Di setiap HP: uninstall APK staging, pasang APK rilis signed, pairing ulang dengan kode baru dari dashboard (apk-release.md).
8. Hapus foto uji di bucket media bila perlu.

## Masalah umum

| Gejala | Penyebab / tindakan |
|---|---|
| Request pertama pagi hari lama (±30–60 detik) | Cold start Render Free + Neon. Normal. Aplikasi kasir menampilkan "Menghubungkan ke server…" dan mencoba ulang. |
| Semua request 503 dari Render "service suspended" | Kuota bulanan habis (750 jam instance atau 5 GB bandwidth). Cek Render → Usage. Ajukan upgrade Starter ke Chief of Staff (ADR-0011 § Jalur upgrade). Kasir tetap bisa transaksi cash offline. |
| `/healthz` → `db: down`, log `Connection terminated` / `compute time quota exceeded` | Kuota CU-jam Neon habis. Cek Neon → Usage. Upgrade Neon Launch (keputusan biaya, eskalasi). |
| Dashboard login gagal tapi API sehat | Cek env Pages `API_ORIGIN` dan `PROXY_SHARED_SECRET` (harus sama dengan Render). `https://kelola-kasir.pages.dev/v1/me` harus 401. |
| Upload foto gagal | Cek CORS bucket media dan env `STORAGE_*` di Render. |
| Workflow backup tidak jalan | GitHub mematikan jadwal setelah 60 hari tanpa aktivitas repo: Actions → Database backup → Enable workflow. |
| Error 5xx | Sentry menampilkan route dan request id; cari request id di log Render. |

## Pantauan rutin

- **Mingguan:** Neon CU-jam (target < 80% sebelum akhir bulan), Render bandwidth dan jam instance, Sentry issues baru.
- **Bulanan:** uji restore, umur backup terbaru < 26 jam, cek ulang batas free tier di ADR-0011 tiap kuartal.
