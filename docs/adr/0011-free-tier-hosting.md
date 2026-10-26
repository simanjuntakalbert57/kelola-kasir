ADR-0011 — Hosting free tier: Render + Neon + Cloudflare (menggantikan ADR-0005)

Status: Partially superseded by [ADR-0012](0012-vps-hosting.md) (API + DB pindah ke VPS (Rumahweb); proxy `/v1`, R2/B2, dan enkripsi backup tetap berlaku) · Tanggal: 2026-10-26 · Keputusan owner: Q-5 (DEAR-21) · Menggantikan: [ADR-0005](0005-hosting-and-cost.md)

## Konteks
Owner memutuskan Q-5 pada 26 Okt 2026: **mulai dengan layanan gratis**, upgrade dinilai setelah ada data pemakaian nyata. Printer thermal 58 mm sudah dimiliki owner, jadi tidak ada pembelian. Skala tetap: 1 gerai, 1–2 HP kasir, ≤ 500 transaksi/hari, 1 owner. Tidak boleh ada akun berbayar atau kartu kredit yang didaftarkan.

## Keputusan

| Komponen | Layanan | Biaya |
|---|---|---|
| API (Fastify, Docker) | **Render Free** web service, region Singapore, `kelola-kasir-api.onrender.com` | US$0 |
| PostgreSQL 16 | **Neon Free**, region AWS Singapore (`ap-southeast-1`), compute dikunci 0.25 CU | US$0 |
| Dashboard owner | Cloudflare Pages, `kelola-kasir.pages.dev` + Pages Functions sebagai proxy `/v1/*` ke API | US$0 |
| Foto produk, logo, backup | Cloudflare R2 (dalam kuota gratis); cadangan tanpa kartu: Backblaze B2 (lihat "Catatan kartu") | US$0 |
| Backup terjadwal | GitHub Actions `schedule` (repo publik → menit Actions gratis) | US$0 |
| Error tracking / uptime | Sentry Developer, UptimeRobot / Better Stack free | US$0 |
| Domain | Subdomain gratis `*.onrender.com`, `*.pages.dev` | US$0 |
| Distribusi APK | Sideload APK signed release (EAS Build free / build lokal), tanpa Play Console | US$0 |
| **Total** | | **US$0/bulan** |

Postgres gratis milik Render **tidak dipakai**: database Free Render kedaluwarsa 30 hari setelah dibuat dan tidak punya backup.

### Batasan free tier (dicek 2026-10-26 di halaman resmi; dicek ulang 2026-10-26 sebelum rilis, DEAR-19)

| Layanan | Batas yang relevan | Sumber |
|---|---|---|
| Render Free web service | Tidur setelah **15 menit** tanpa trafik masuk, bangun ±1 menit. **750 jam instance/bulan** per workspace (cukup untuk 1 service 24/7; habis → service disuspend sampai bulan berikut). 512 MB RAM, 0.1 CPU. Tanpa disk persisten, tanpa shell, tanpa one-off job, **tanpa pre-deploy command** (fitur instance berbayar), tanpa cron/worker gratis, bisa di-restart kapan saja. Port SMTP 25/465/587 diblokir. | render.com/docs/free, render.com/pricing |
| Render workspace Hobby | **Bandwidth keluar 5 GB/bulan** dan **500 menit pipeline (build)/bulan**. Tanpa metode pembayaran: bandwidth habis → semua service Free disuspend sampai akhir bulan; menit build habis → build baru mati, service tetap jalan. | render.com/docs/free, render.com/docs/new-workspace-plans |
| Neon Free | **100 CU-jam/bulan per project** (= 400 jam pada 0.25 CU; autoscaling bisa sampai 2 CU, jadi kunci max 0.25), storage 1 GB per project (20 GB total), scale-to-zero setelah 5 menit idle (tidak bisa dimatikan), riwayat PITR 6 jam, egress 5 GB/bulan. | neon.com/docs/introduction/plans |
| Cloudflare R2 | 10 GB-bulan storage, 1 juta operasi Class A, 10 juta Class B per bulan, egress gratis (hanya kelas Standard). | developers.cloudflare.com/r2/pricing |
| Cloudflare Pages | 500 build/bulan, 1 build bersamaan, timeout build 20 menit, 20.000 file, 25 MiB per file. Request Pages Functions dihitung ke kuota Workers Free: **100.000 request/hari**, CPU 10 ms/request, 50 subrequest/request. | developers.cloudflare.com/pages/platform/limits, developers.cloudflare.com/workers/platform/limits |

Angka ini bisa berubah. Cek ulang sebelum rilis (DEAR-19) dan setiap kuartal; perbarui tabel ini beserta tanggalnya.

### Cookie lintas domain → proxy same-origin lewat Pages Functions
Dashboard (`*.pages.dev`) dan API (`*.onrender.com`) berbeda situs, dan keduanya ada di Public Suffix List, jadi tidak bisa berbagi cookie. Cookie refresh `SameSite=Strict` dari ADR-0004 tidak akan terkirim bila dashboard memanggil API langsung.

Keputusan: **dashboard memanggil API secara same-origin** lewat Cloudflare Pages Function `functions/v1/[[path]].ts` yang meneruskan `https://kelola-kasir.pages.dev/v1/*` → `https://kelola-kasir-api.onrender.com/v1/*`.
- Prefiks path **`/v1` dipertahankan** (bukan `/api`), sehingga path API, `Path` cookie, dan OpenAPI tetap sama. Router SPA tidak boleh memakai route `/v1`.
- Cookie `kk_refresh`: `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`, **tanpa atribut `Domain`**. Browser melihatnya sebagai host-only cookie milik `kelola-kasir.pages.dev`. Kebijakan cookie ADR-0004 tetap berlaku.
- CORS API: tidak dibutuhkan untuk dashboard. Allow-list CORS dibiarkan kosong di produksi. Aplikasi kasir native tidak terkena CORS.
- Proxy meneruskan method, body, header `Authorization`, `Cookie`, `Content-Type`, `Idempotency-Key`, dan menambah `X-Forwarded-For`/`X-Forwarded-Host`. IP klien asli (`CF-Connecting-IP` di Pages) dikirim sebagai `X-Client-IP` bersama `X-Proxy-Secret` (`PROXY_SHARED_SECRET`, sama di Pages dan Render). API hanya memercayai `X-Client-IP` bila secret cocok; selain itu memakai alamat dari edge Render (`TRUST_PROXY=1`). Dengan begitu rate limit login per IP tetap benar dan header tidak bisa dipalsukan oleh pemanggil langsung. (Revisi DEAR-19: `CF-Connecting-IP` yang sampai di Render tidak bisa diandalkan sebagai IP pengguna, karena request datang dari subrequest Worker, bukan dari browser.)
- Upload foto tetap memakai presigned PUT langsung ke R2, tidak lewat proxy.
- **Aplikasi kasir memanggil API langsung** di `https://kelola-kasir-api.onrender.com/v1` (bearer token, tanpa cookie), supaya tidak memakai kuota Workers.
- Kontrak API tidak berubah. Yang berubah: `servers` di OpenAPI, atribut cookie ditulis eksplisit, dan base URL dashboard = origin sendiri (`/v1`).

Alternatif yang ditolak: `SameSite=None` + CORS dengan credentials. Cara ini membuka permukaan CSRF dan bergantung pada dukungan cookie pihak ketiga di browser (Safari ITP memblokirnya).

### Koneksi database (Neon)
- `DATABASE_URL` = **pooled** connection string (host `-pooler`, PgBouncer mode transaction) untuk runtime API. Driver `pg` (node-postgres) via Drizzle, seperti di `apps/api/src/db/client.ts`; query tanpa nama aman untuk pooler mode transaction, jadi jangan pakai prepared statement bernama (opsi `name` di `pg`).
- `DATABASE_URL_DIRECT` = **direct** connection string (tanpa `-pooler`) untuk migrasi dan `pg_dump`. Render Free tidak punya pre-deploy command, jadi **container menjalankan migrasi (idempoten) di awal setiap start**, lalu server (`apps/api/Dockerfile`). Jangan lewat pooler, karena advisory lock dan DDL butuh sesi.
- `sslmode=require` di kedua URL. Pool aplikasi kecil (max 5) dan `connect_timeout` ≥ 10 detik, karena Neon butuh beberapa ratus milidetik untuk bangun dari scale-to-zero.

### Backup
- GitHub Actions workflow `backup.yml`, `schedule: cron '0 18 * * *'` (01:00 WIB) + `workflow_dispatch`: `pg_dump` (client PostgreSQL 16) dari `DATABASE_URL_DIRECT` → kompres → enkripsi `age` (kunci publik) → upload ke R2 `postgres/` (S3 API) memakai `ops/backup/backup.sh` yang sudah ada. Retensi 30 hari (dipangkas `backup.sh`; lifecycle rule bucket boleh ditambah sebagai pengaman). Workflow gagal → notifikasi email GitHub ke owner.
- Repo **publik**: dump tidak boleh menjadi artifact Actions dan tidak boleh tercetak di log. Kredensial hanya dari GitHub Actions secrets. Role DB khusus backup bersifat read-only.
- GitHub menonaktifkan workflow terjadwal di repo publik setelah 60 hari tanpa aktivitas, dan jadwal bisa terlambat beberapa menit. Monitor: QA mengecek umur objek terbaru di bucket (< 26 jam) saat uji restore bulanan. Langkah setup: `docs/ops/backup-restore.md`.
- PITR bawaan Neon (6 jam) adalah lapisan tambahan, bukan pengganti backup harian.

### Job terjadwal di API
Render Free tidak punya worker/cron, dan service bisa tidur. Kedaluwarsa QRIS `pending` (15 menit) **dievaluasi secara lazy**: setiap baca atau ubah transaksi/payment, serta saat `sync/pull`, `pending` dengan `expires_at < now()` ditandai `cancelled`/`expired` di transaksi DB yang sama. Hasilnya untuk klien identik dengan job berkala.

## Jalur upgrade (tanpa perubahan kode)
Semua konfigurasi lewat environment variable (`DATABASE_URL`, `DATABASE_URL_DIRECT`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, `API_ORIGIN` di Pages Function). Pemicu dan pilihan:

| Pemicu | Upgrade | Perkiraan |
|---|---|---|
| Cold start mengganggu, atau bandwidth/jam instance mendekati batas | Render **Starter** (512 MB, 0.5 CPU, tidak tidur) | US$7/bulan |
| CU-jam Neon > 80% sebelum akhir bulan | Neon **Launch** (bayar per pemakaian, tanpa minimum) | US$0.106/CU-jam (mis. +40 CU-jam ≈ US$4) |
| Ingin satu tagihan / akun Railway sudah ada | Kembali ke Railway (ADR-0005): image Docker yang sama + `pg_dump`/`pg_restore` ke Railway Postgres | ±US$10–25/bulan |
| Butuh domain sendiri | Custom domain di Pages & Render (gratis di kedua platform); proxy tetap dipakai | ±Rp150–250 ribu/tahun |
| Distribusi lebih mudah | Google Play Console | US$25 sekali |

Keputusan upgrade = keputusan biaya → diajukan ke Chief of Staff/owner dengan data pemakaian dari dashboard Render/Neon.

## Catatan kartu kredit
- Render Free dan Neon Free bisa dipakai tanpa metode pembayaran. Tanpa kartu, efek melewati kuota adalah **suspend**, bukan tagihan.
- **R2:** dokumentasi resmi tidak menyebut syarat kartu, tetapi beberapa panduan pihak ketiga melaporkan dashboard meminta metode pembayaran saat bucket R2 pertama dibuat. Bila prompt itu muncul, **jangan menambahkan kartu**. Pakai **Backblaze B2** (10 GB gratis, halaman sign-up menyatakan tanpa kartu, S3-compatible) untuk foto dan backup. Cukup ganti env `S3_*`, tanpa perubahan kode. Foto dari B2 disajikan lewat URL publik bucket; kuota unduh gratis harian B2 cukup untuk katalog kecil.

## Konsekuensi
- (+) Biaya bulanan US$0. Upgrade cukup ganti plan/env.
- (−) **Cold start ±30–60 detik** pada request pertama setelah API tidur 15 menit. Mitigasi: aplikasi kasir offline-first (transaksi cash tidak menunggu server). UI menampilkan "Menghubungkan ke server…" + spinner + retry otomatis (timeout ≥ 75 detik) saat buka shift, login PIN online, pairing, dan login dashboard. Pada jam buka toko, polling sync 30 detik menjaga API tetap bangun.
- (−) **Kuota compute Neon 100 CU-jam/bulan** ≈ 400 jam aktif pada 0.25 CU (≈ 13 jam/hari). Polling sync 30 detik membuat DB tidak pernah idle 5 menit. Mitigasi wajib di API: `sync/pull` tanpa perubahan dijawab dari cursor in-memory (`latest_seq` per outlet, diinvalidasi oleh setiap penulisan; aman karena API satu instance) tanpa query DB. Validasi `X-Device-Token` di-cache in-memory, dan cache dihapus saat revoke. Polling dashboard berhenti saat tab tidak aktif. Pemakaian dipantau mingguan.
- (−) **Bandwidth Render 5 GB/bulan.** Respons JSON di-gzip, foto/logo tidak pernah lewat API (presigned R2), ekspor CSV/XLSX besar dibatasi rentang tanggal. Perkiraan pemakaian MVP < 0,5 GB/bulan.
- (−) Render dapat me-restart service kapan saja → API harus stateless selain cache yang bisa dibangun ulang. Tidak ada file lokal.
- (−) APK sideload: update aplikasi via EAS Update (JS) atau pasang APK baru manual. Keystore release disimpan owner di luar repo.
- Akun dibuat oleh owner/Chief of Staff tanpa kartu. Secret hanya di env Render, Cloudflare, dan GitHub Actions secrets, tidak pernah di repo.

## Revisi implementasi (DEAR-19, 2026-10-26)
Temuan saat menyiapkan deploy; keputusan utama tidak berubah.
- **Migrasi saat start**, bukan pre-deploy command (tidak tersedia di Render Free). Deploy yang migrasinya gagal tidak live; versi lama tetap melayani.
- **Health check Render = `/livez`** (tanpa query DB). `/healthz` (dengan DB) hanya untuk uptime check, supaya probe Render tidak membuat Neon terus bangun.
- **Uptime check** lewat GitHub Actions `uptime.yml`, per jam 09:00–21:00 WIB saja (bukan UptimeRobot 5 menit 24 jam, yang akan menghabiskan CU-jam Neon).
- **Sentry**: reporter error ringan (`apps/api/src/lib/error-reporter.ts`, envelope HTTP) menggantikan `@sentry/node`, yang menarik OpenTelemetry dan memperlambat cold start di 0.1 CPU. Hanya error 5xx, tanpa header/cookie/body.
- **Gzip** respons ≥ 1 KB (`@fastify/compress`) untuk menghemat bandwidth Render. **Pool DB** default 5, `connectionTimeoutMillis` 15 detik.
- **Satu lingkungan**: dipakai sebagai staging selama UAT, data direset sebelum go-live (`docs/ops/runbook.md`).
- **APK** dibangun di GitHub Actions (`android-apk.yml`): `staging` ditandatangani debug key, `release` dengan keystore owner dari Actions secrets (plugin `apps/kasir/plugins/withReleaseSigning.js`). Tidak memakai akun EAS.
- **Belum terimplementasi, wajib sebelum go-live**: mitigasi CU-jam di API (cursor `sync/pull` in-memory, cache validasi `X-Device-Token`, dan sapuan kedaluwarsa QRIS yang hanya jalan saat ada `pending`). Saat ini sapuan QRIS meng-query DB tiap 30 detik selama API bangun, sehingga Neon praktis aktif selama jam buka toko (perkiraan 12 jam/hari ≈ 93 CU-jam/bulan, mepet batas 100). Ditangani di issue tindak lanjut Backend.
