Architecture Decision Records — Kelola Kasir

Format: Konteks → Keputusan → Alternatif → Konsekuensi. Status: `Proposed` sampai TDD disetujui, lalu `Accepted`. ADR baru menggantikan yang lama dengan status `Superseded by ADR-XXXX`.

| ADR | Judul | Status |
|---|---|---|
| [0001](0001-monorepo-typescript.md) | Monorepo TypeScript (pnpm + Turborepo) | Accepted |
| [0002](0002-backend-fastify-postgres.md) | Backend: Node.js + Fastify + Drizzle + PostgreSQL | Accepted |
| [0003](0003-kasir-app-react-native-offline-first.md) | Aplikasi kasir: React Native (Expo) offline-first dengan SQLite + outbox | Accepted |
| [0004](0004-owner-dashboard-react-vite.md) | Dashboard owner: React + Vite SPA | Accepted |
| [0005](0005-hosting-and-cost.md) | Hosting: Railway + Cloudflare (R2, Pages) & estimasi biaya | Proposed (butuh persetujuan biaya) |
| [0006](0006-auth-device-pairing-pin.md) | Auth: pairing perangkat + PIN pegawai, JWT owner | Accepted |
| [0007](0007-qris-payment-provider-abstraction.md) | Pembayaran QRIS lewat abstraksi PaymentProvider | Accepted |
| [0008](0008-client-ids-and-sync-protocol.md) | ID dari klien (UUIDv7), nomor transaksi per perangkat, protokol sync | Accepted |
| [0009](0009-single-open-shift-per-outlet.md) | Satu shift aktif per gerai, tutup shift offline | Accepted |
| [0010](0010-receipt-printing-escpos.md) | Cetak struk thermal ESC/POS 58 mm di aplikasi kasir; produk tanpa varian | Accepted |
