ADR-0012 — Hosting API + database di VPS (Rumahweb) (menggantikan bagian hosting ADR-0011)

Status: Accepted · Tanggal: 2026-10-26 · Keputusan owner: "lanjut VPS" di DEAR-19 · Menggantikan sebagian: [ADR-0011](0011-free-tier-hosting.md)

## Konteks
ADR-0011 memilih free tier (Render Free + Neon Free) dengan biaya US$0. Saat menyiapkan deploy (DEAR-19) ada dua risiko yang mengganggu kasir:
- **Cold start Render Free.** API tidur setelah 15 menit tanpa trafik, dan request pertama sesudahnya butuh ±30–60 detik.
- **Kuota Neon 100 CU-jam/bulan.** Perkiraan pemakaian ±93 CU-jam bila toko buka 12 jam/hari. Kalau kuota habis, database berhenti sampai akhir bulan.

Owner bertanya apakah VPS Hostinger bisa dipakai. Setelah melihat perbandingannya, owner memutuskan **"lanjut VPS"** pada 26 Okt 2026. Keputusan ini menerima biaya bulanan. Setelah itu owner memilih penyedia **Rumahweb** (bukan Hostinger yang dibahas awalnya). Rancangan di bawah tidak bergantung pada penyedia: syaratnya VPS KVM dengan akses root SSH dan OS yang didukung `setup.sh`: Ubuntu 24.04 atau AlmaLinux/Rocky 8–9. VPS Rumahweb owner awalnya terpasang AlmaLinux 8.9, lalu di-reinstall owner ke **Ubuntu 24.04** (26 Okt 2026). Ubuntu 24.04 menjadi OS utama, sedangkan AlmaLinux/Rocky tetap didukung sebagai cadangan. Skala tetap sama: 1 gerai, 1–2 HP kasir, ≤ 500 transaksi/hari.

## Keputusan

| Komponen | Sebelumnya (ADR-0011) | Sekarang |
|---|---|---|
| API (Fastify, Docker) | Render Free | **VPS Rumahweb** (virtualisasi KVM, minimal 1 vCPU, 2 GB RAM, 20 GB SSD; disarankan 4 GB RAM), Ubuntu 24.04, data center Indonesia, Docker Compose |
| PostgreSQL 16 | Neon Free | **Container `postgres:16-alpine` di VPS yang sama**, volume Docker, port tidak dibuka ke internet |
| HTTPS / reverse proxy | Edge Render | **Caddy 2** (sertifikat Let's Encrypt otomatis) untuk `API_DOMAIN` |
| Domain API | `*.onrender.com` | Domain owner, mis. `api.<domain>` (A record → IP VPS). Domain bisa dibeli di Rumahweb (juga registrar) dan dikelola DNS-nya di sana |
| Dashboard owner | Cloudflare Pages + proxy `/v1/*` | **Tetap**. Hanya env `API_ORIGIN` yang berubah ke `https://<API_DOMAIN>` |
| Foto produk, logo | R2 (cadangan: B2) | **Tetap** R2/B2. API tetap stateless, foto tidak disimpan di VPS |
| Backup harian | GitHub Actions → R2 | **Timer systemd di VPS** (01:00 WIB) → `pg_dump` (role `backup_ro`) → `age` → R2/B2, **di luar VPS**. Heartbeat ke healthchecks.io |
| Deploy | Render auto-deploy | GitHub Actions `deploy-vps.yml`: build image → GHCR → SSH (user `deploy`) → `docker compose up --wait`; rollback otomatis bila tidak sehat |
| Uptime | Per jam, jam buka saja | Tiap 30 menit, 24 jam (tidak ada kuota yang perlu dihemat) |
| Error tracking | Sentry Developer | Tetap |

Berkas: `ops/vps/` (compose, Caddyfile, `setup.sh`, `env.example`, `backup-now.sh`), `.github/workflows/deploy-vps.yml`. `render.yaml` dan `.github/workflows/backup.yml` dihapus.

### Bagian ADR-0011 yang tetap berlaku
- Proxy same-origin `/v1/*` lewat Cloudflare Pages Function, cookie `kk_refresh` host-only, `X-Client-IP` + `X-Proxy-Secret`.
- Aplikasi kasir memanggil API langsung (bearer token). URL API ditanam di APK saat build (`KASIR_API_URL`).
- Penyimpanan objek R2/B2, aturan "tanpa kartu" untuk akun R2/B2, enkripsi backup `age`, retensi 30 hari.
- Kedaluwarsa QRIS dievaluasi secara lazy (tidak butuh worker).

### Bagian ADR-0011 yang tidak berlaku lagi
- Batas Render/Neon, cold start, mitigasi kuota CU-jam Neon. **DEAR-29 (mitigasi CU-jam) tidak lagi wajib sebelum go-live.** Cache in-memory tetap boleh dikerjakan sebagai optimasi.
- `DATABASE_URL` pooled vs direct: di VPS keduanya menunjuk ke database yang sama (`db:5432`) tanpa PgBouncer. Pool aplikasi 10.

### Biaya dan kontrak
Diisi owner/Chief of Staff setelah order (angka dari invoice Rumahweb, bukan perkiraan).

| Item | Perkiraan saat keputusan | Aktual | Tanggal perpanjangan |
|---|---|---|---|
| VPS Rumahweb (paket dipilih owner) | sesuai harga paket di rumahweb.com; perhatikan harga perpanjangan | _belum dicatat_ | _diisi dari invoice_ |
| Domain API (opsional) | ±Rp150–250 ribu/tahun | _belum_ | _diisi setelah beli_ |
| R2/B2, Cloudflare Pages, Sentry, healthchecks.io, GitHub Actions | US$0 (free tier) | | |

Tanggal perpanjangan juga dicatat di kalender owner (runbook § Perawatan server).

## Keamanan server
- `ops/vps/setup.sh` (sekali, sebagai root): update otomatis keamanan (`dnf-automatic` security-only / `unattended-upgrades`), firewall `firewalld` / `ufw` (22, 80, 443 saja), `fail2ban` untuk SSH, login SSH hanya dengan key (password dimatikan setelah root punya key), swap 2 GB, rotasi log Docker.
- User `deploy` hanya untuk GitHub Actions: login dengan key, tanpa sudo. Anggota grup `docker` setara root di host, jadi private key-nya hanya disimpan di GitHub secret `VPS_SSH_KEY`. Host key VPS dipin di variable `VPS_KNOWN_HOSTS`.
- **Virtualisasi harus KVM.** Docker tidak berjalan (atau terbatas) di VPS berbasis OpenVZ/LXC.
- PostgreSQL tidak dipublikasikan ke host, hanya dapat diakses dari jaringan compose. Akses darurat lewat `./compose.sh exec db psql`.
- Secret server hanya di `/opt/kelola-kasir/.env` (mode 600) dan password manager owner. Tidak pernah di repo, issue, atau chat.
- Image di-pull dari GHCR dengan `GITHUB_TOKEN` sesaat saat deploy, lalu logout. Tidak ada token permanen di VPS.

## Alternatif yang ditolak
- **Tetap free tier (ADR-0011).** Ditolak owner karena cold start dan risiko kuota.
- **Render Starter + Neon Launch.** ±US$7 + pemakaian Neon per bulan, tanpa perawatan server. Biaya mirip, tapi masih dua vendor dan Neon tetap bisa scale-to-zero. Owner memilih VPS (Rumahweb).
- **Database terkelola terpisah + API di VPS.** Biaya tambahan, dan latensi lintas penyedia. Untuk 1 gerai, Postgres di VPS yang sama sudah cukup.
- **Build image di VPS (`docker build` saat deploy).** Memakan CPU/RAM VPS dan memperlambat deploy. Image dibangun di GitHub Actions, VPS hanya pull.

## Konsekuensi
- (+) Tanpa cold start dan tanpa kuota compute/DB. Respons stabil sepanjang hari.
- (+) Satu image Docker yang sama diuji di CI (job "VPS stack starts, backs up and restores": compose + Caddy + backup + restore + verify).
- (−) **Biaya bulanan** VPS sesuai paket Rumahweb yang dipilih owner, ditambah domain bila dibeli (±Rp150–250 ribu/tahun). Keputusan biaya oleh owner, diteruskan ke Chief of Staff.
- (−) **Server unmanaged**: patch OS, disk, dan pemulihan jadi tanggung jawab tim (runbook § Perawatan server). Update keamanan otomatis, tapi reboot kernel dilakukan manual di luar jam buka.
- (−) **Satu server = satu titik gagal.** Bila VPS mati, API mati sampai VPS pulih. Mitigasi: aplikasi kasir offline-first (transaksi cash jalan terus), backup harian di luar VPS (RPO ≤ 24 jam), dan restore ke VPS baru tertulis di runbook (RTO ≤ 2 jam). Snapshot/backup VPS dari penyedia boleh dipakai sebagai lapisan tambahan, bukan pengganti backup.
- (−) URL API ditanam di APK. Ganti domain = build dan pasang APK baru. Karena itu domain sebaiknya sudah final sebelum APK rilis.
- Satu lingkungan: VPS ini menjadi staging selama UAT, lalu data direset sebelum go-live (runbook § Reset data sebelum go-live).
