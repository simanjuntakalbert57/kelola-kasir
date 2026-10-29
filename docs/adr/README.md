Architecture Decision Records — Kelola Kasir

Format: Konteks → Keputusan → Alternatif → Konsekuensi. Status: `Proposed` sampai TDD disetujui, lalu `Accepted`. ADR baru menggantikan yang lama dengan status `Superseded by ADR-XXXX`.

| ADR | Judul | Status |
|---|---|---|
| [0001](0001-monorepo-typescript.md) | Monorepo TypeScript (pnpm + Turborepo) | Accepted |
| [0002](0002-backend-fastify-postgres.md) | Backend: Node.js + Fastify + Drizzle + PostgreSQL | Accepted |
| [0003](0003-kasir-app-react-native-offline-first.md) | Aplikasi kasir: React Native (Expo) offline-first dengan SQLite + outbox | Accepted |
| [0004](0004-owner-dashboard-react-vite.md) | Dashboard owner: React + Vite SPA | Accepted |
| [0005](0005-hosting-and-cost.md) | Hosting: Railway + Cloudflare (R2, Pages) & estimasi biaya | Superseded by 0011 |
| [0006](0006-auth-device-pairing-pin.md) | Auth: pairing perangkat + PIN pegawai, JWT owner | Accepted |
| [0007](0007-qris-payment-provider-abstraction.md) | Pembayaran QRIS lewat abstraksi PaymentProvider | Accepted |
| [0008](0008-client-ids-and-sync-protocol.md) | ID dari klien (UUIDv7), nomor transaksi per perangkat, protokol sync | Accepted |
| [0009](0009-single-open-shift-per-outlet.md) | Satu shift aktif per gerai, tutup shift offline | Accepted |
| [0010](0010-receipt-printing-escpos.md) | Cetak struk thermal ESC/POS 58 mm di aplikasi kasir; produk tanpa varian | Accepted |
| [0011](0011-free-tier-hosting.md) | Hosting free tier: Render + Neon + Cloudflare; proxy `/v1` same-origin; backup via GitHub Actions | Partially superseded by 0012 (proxy `/v1`, R2/B2 tetap berlaku) |
| [0012](0012-vps-hosting.md) | Hosting API + PostgreSQL di VPS (Rumahweb) (Docker Compose + Caddy), backup harian ke R2/B2 | Accepted (akses APK diubah 0014) |
| [0013](0013-review-to-qa-via-mention.md) | Alur review → QA: Tech Lead mention QA setelah merge + deploy staging | Accepted |
| [0014](0014-kasir-via-pages-proxy.md) | Aplikasi kasir lewat proxy Cloudflare Pages `/v1`, tanpa domain API berbayar | Accepted |
| [0015](0015-private-media-bucket.md) | Bucket media privat, gambar disajikan lewat `GET /v1/media/*` (redirect presigned GET) | Accepted (menggantikan bagian media publik di 0011) |
| [0016](0016-telegram-transaction-notifications.md) | Notifikasi transaksi & void ke Telegram owner (outbox `notification_log`, dispatcher in-process) | Accepted |
