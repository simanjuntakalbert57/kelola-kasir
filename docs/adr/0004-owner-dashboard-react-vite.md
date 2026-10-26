ADR-0004 — Dashboard owner: React + Vite SPA

Status: Accepted · Tanggal: 2026-10-26 (diterima bersama TDD v1.1)

## Konteks
Dashboard owner dipakai di browser desktop dan HP, di belakang login, tanpa kebutuhan SEO. Proyek Dear Fruity sudah memakai React + Vite.

## Keputusan
- **React + Vite SPA**, TypeScript, **TanStack Router + TanStack Query**, **Tailwind CSS** + komponen headless (Radix/shadcn) mengikuti design system DEAR-5.
- Grafik: Recharts. Tabel: TanStack Table. Form: React Hook Form + Zod (skema dari `packages/contracts`).
- Auth: access token di memori, refresh token di cookie `HttpOnly` (domain API); dashboard dan API di bawah domain yang sama (`app.` dan `api.`) agar cookie `SameSite=Strict` bekerja.
- Data "real-time" = polling 30 detik; SSE bisa ditambah tanpa ubah kontrak.
- Deploy statis ke Cloudflare Pages.

## Alternatif
- Next.js: SSR/SEO tidak dibutuhkan; menambah server runtime.
- Admin framework (Refine/React-Admin): cepat untuk CRUD, tetapi dashboard ringkasan & rekonsiliasi lebih nyaman dibuat langsung.

## Konsekuensi
- (+) Hosting statis gratis, build cepat, familiar bagi tim.
- (−) Semua otorisasi wajib ditegakkan di API (memang seharusnya).
