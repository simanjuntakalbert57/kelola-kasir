ADR-0005 — Hosting: Railway + Cloudflare & estimasi biaya bulanan

Status: Superseded by [ADR-0011](0011-free-tier-hosting.md) (Q-5 diputuskan owner 2026-10-26: mulai dengan free tier) · Tanggal: 2026-10-26

> Dokumen ini disimpan sebagai referensi jalur upgrade "kembali ke Railway" di ADR-0011.

## Konteks
Skala MVP: 1 gerai, 1–2 perangkat, ≤ 500 transaksi/hari, 1 owner. Owner sudah memakai Railway untuk Dear Fruity. Kebutuhan: API selalu hidup, Postgres terkelola dengan backup, penyimpanan foto produk, hosting dashboard, region dekat Indonesia bila memungkinkan.

## Keputusan
| Komponen | Layanan | Estimasi/bulan |
|---|---|---|
| API (1 service, 0.5 vCPU / 512 MB) | Railway (plan Hobby, region Asia Tenggara bila tersedia) | US$5 langganan (termasuk US$5 usage) + usage ±US$3–8 |
| PostgreSQL 16 (1 GB) | Railway Postgres | termasuk usage ±US$2–5 |
| Foto produk, logo, backup `pg_dump` | Cloudflare R2 (10 GB gratis, tanpa biaya egress) | US$0 |
| Dashboard owner | Cloudflare Pages | US$0 |
| Error tracking | Sentry Developer (gratis) | US$0 |
| Uptime monitor | Better Stack / UptimeRobot (gratis) | US$0 |
| Build & update aplikasi kasir | Expo EAS (free tier: build bulanan terbatas) | US$0 |
| Domain (mis. `kelolakasir.id`/subdomain domain owner) | registrar lokal | ±Rp150–250 ribu/tahun (≈Rp15–20 ribu/bulan) |
| **Total** | | **±US$10–25/bulan (±Rp160–400 ribu)** + domain |

Biaya sekali/opsional: Google Play Console US$25 (sekali, bila distribusi via Play; APK langsung juga bisa), printer thermal Bluetooth 58 mm ±Rp300–600 ribu (wajib: cetak struk = Must sejak TDD v1.1). Apple Developer tidak dibutuhkan (D-2 = HP Android).

Fase 2 (QRIS dinamis): tidak ada biaya bulanan gateway; MDR QRIS ±0,7% per transaksi (mis. omzet QRIS Rp30 juta/bulan → ±Rp210 ribu).

Backup: snapshot bawaan Railway + `pg_dump` harian terenkripsi ke R2, retensi 30 hari; uji restore bulanan.

## Alternatif
- VPS (DigitalOcean/IDCloudHost ±US$6): lebih murah tetapi kita mengelola OS, patch, backup, TLS sendiri.
- Supabase (Postgres terkelola, free tier pause setelah idle; Pro US$25): lebih mahal untuk kebutuhan kita.
- GCP/AWS region Jakarta: latensi terbaik, tetapi biaya minimum & kompleksitas lebih tinggi. Latensi Railway Singapura (±20–40 ms) cukup karena layar kasir tidak memanggil jaringan per tap.

## Konsekuensi
- (+) Biaya rendah, deploy dari GitHub otomatis, akun Railway sudah ada.
- (−) Bergantung pada pricing Railway; pasang budget alert. Migrasi ke VPS/cloud lain mudah karena hanya Docker + Postgres standar.
- Akun & billing dibuat oleh owner/Chief of Staff; secret tidak pernah ditaruh di repo.
