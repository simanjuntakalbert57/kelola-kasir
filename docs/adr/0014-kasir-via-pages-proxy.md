ADR-0014 — Aplikasi kasir mengakses API lewat proxy Cloudflare Pages, tanpa domain berbayar

Status: Accepted · Tanggal: 2026-10-27 · Keputusan owner: "tidak beli domain API, aplikasi untuk pemakaian pribadi" (DEAR-69, DEAR-70) · Mengubah sebagian: [ADR-0012](0012-vps-hosting.md), [ADR-0011](0011-free-tier-hosting.md) · Biaya tambahan: Rp0

## Konteks
ADR-0012 menanam URL API langsung (`https://<API_DOMAIN>/v1`) di APK dan menyarankan domain sendiri sebelum rilis, karena ganti domain berarti build dan pasang ulang APK. Selama UAT API dipakai lewat `80-43-0-75.sslip.io`, yang terikat ke IP VPS.

Owner memutuskan tidak membeli domain API. Dashboard sudah punya alamat tetap gratis, `https://kelola-kasir.pages.dev`, dengan proxy same-origin `/v1/*` ke API (Pages Function, ADR-0011). Proxy itu bisa dipakai APK juga.

## Keputusan
- APK memanggil **`https://kelola-kasir.pages.dev/v1`**. Variabel repo `KASIR_API_URL` berisi nilai ini, dan workflow **Android APK** menanamnya saat build.
- Proxy meneruskan header `X-Device-Token` (auth perangkat kasir) selain header yang sudah ada (`Authorization`, `Content-Type`, `Idempotency-Key`, dst.). Daftar header ada di `apps/dashboard/src/proxy/apiProxy.ts` dan diuji di `apiProxy.test.ts`.
- Alamat VPS hanya diketahui Pages (`API_ORIGIN`). Kalau VPS atau alamatnya pindah, cukup ubah `API_ORIGIN` di Cloudflare Pages lalu redeploy Pages. **APK tidak perlu di-build ulang.**
- `PROXY_SHARED_SECRET` wajib diisi di Pages dan di `.env` VPS dengan nilai sama. Tanpa itu, API melihat semua HP kasir sebagai IP egress Cloudflare, sehingga rate limit API (global per IP dan login) berlaku bersama untuk semua perangkat dan pengunjung dashboard.
- `80-43-0-75.sslip.io` tetap dipakai sebagai `API_ORIGIN` (upstream proxy) dan untuk health check. Tidak ada klien yang memakainya langsung.

## Alternatif yang ditolak
- **Beli domain (±Rp150–250 ribu/tahun).** Ditolak owner: aplikasi untuk pemakaian pribadi.
- **Tanam `sslip.io` langsung di APK.** Rp0, tapi alamatnya ikut IP VPS. Pindah VPS = build dan pasang ulang APK di semua HP.
- **Cloudflare Tunnel / Worker dengan domain sendiri.** Butuh domain di Cloudflare, jadi biayanya sama dengan beli domain.

## Konsekuensi
- (+) Biaya Rp0, tanpa vendor baru. URL APK stabil walau VPS pindah.
- (+) Lalu lintas kasir melewati TLS Cloudflare; IP VPS tidak tertanam di APK.
- (−) **Kuota gratis Pages Functions: 100.000 request/hari** (dihitung bersama dashboard). Perkiraan: 2 HP × sync tiap ±30 detik × 12 jam ≈ 3.000 request, ditambah transaksi dan dashboard, masih jauh di bawah kuota. Bila kuota habis, request `/v1` ditolak sampai reset harian (00:00 UTC = 07:00 WIB). Kasir tetap jalan offline untuk transaksi tunai dan sinkron setelah kuota pulih; login PIN pertama dan pairing butuh online.
- (−) **Ketergantungan ke Cloudflare.** Gangguan Cloudflare Pages = kasir tidak bisa sinkron (offline-first tetap jalan). Jalan darurat: build APK dengan `api_url=https://80-43-0-75.sslip.io/v1` (langsung ke VPS).
- (−) Satu hop tambahan (HP → Cloudflare → VPS). Body API kecil (JSON), foto tetap langsung ke R2 lewat presigned URL, jadi dampaknya kecil.
- (−) Header baru yang dikirim aplikasi kasir harus ditambahkan ke daftar proxy, atau request ditolak API. Test proxy menjaga daftar ini.
