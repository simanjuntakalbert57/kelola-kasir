ADR-0001 — Monorepo TypeScript (pnpm + Turborepo)

Status: Proposed · Tanggal: 2026-10-26

## Konteks
Tiga aplikasi (API, kasir, dashboard) berbagi model data yang sama: produk, opsi, transaksi, uang integer Rupiah. Tim kecil (1 orang per peran) dan kontrak API harus konsisten. Proyek Dear Fruity sebelumnya sudah memakai JavaScript/React/Vite/Express.

## Keputusan
- Satu repo `kelola-kasir` (monorepo) dengan pnpm workspaces + Turborepo.
- TypeScript `strict` di semua paket.
- `packages/contracts`: tipe hasil generate dari `docs/api/openapi.yaml` + skema Zod; `packages/money`: helper Rupiah integer.
- OpenAPI adalah sumber kebenaran kontrak (design-first). Perubahan kontrak = PR ke `docs/api/openapi.yaml` terlebih dulu.

## Alternatif
- Polyrepo per aplikasi: overhead sinkronisasi tipe dan versi kontrak lebih besar untuk tim kecil.
- Bahasa berbeda di backend (Go/Laravel): performa tidak dibutuhkan di skala 1 gerai; kehilangan berbagi tipe/validasi.

## Konsekuensi
- (+) Satu PR bisa mengubah kontrak + API + klien; CI tunggal.
- (+) Logika uang/kalkulasi keranjang dipakai bersama kasir & API → hasil identik.
- (−) Build mobile (Expo) di monorepo perlu konfigurasi Metro untuk workspace; sudah didukung Expo SDK terbaru.
