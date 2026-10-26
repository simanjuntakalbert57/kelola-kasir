ADR-0002 — Backend: Node.js + Fastify + Drizzle ORM + PostgreSQL

Status: Accepted · Tanggal: 2026-10-26 (diterima bersama TDD v1.1)

## Konteks
Butuh API REST untuk kasir & dashboard, transaksi ACID (transaksi + item + pembayaran + audit dalam satu commit), agregasi laporan, dan siap multi-outlet. Volume MVP kecil (≤ 500 transaksi/hari).

## Keputusan
- Runtime Node.js 24 LTS, framework **Fastify** (schema-based, cepat, plugin `@fastify/swagger` untuk validasi silang dengan OpenAPI).
- Validasi request/response dengan **Zod** (`fastify-type-provider-zod`).
- **PostgreSQL 16** sebagai satu-satunya datastore; **Drizzle ORM** + migrasi SQL ber-versi (`drizzle-kit`).
- Arsitektur **modular monolith**: modul `auth`, `devices`, `employees`, `catalog`, `shifts`, `transactions`, `payments`, `voids`, `reports`, `settings`, `audit`, `sync`. Satu proses HTTP + job terjadwal (node-cron/pg-boss) di proses yang sama untuk MVP.
- Semua kolom uang `BIGINT` Rupiah; `cash_difference` satu-satunya yang boleh negatif.
- Trigger DB untuk menolak perubahan kolom finansial transaksi non-`pending`; role DB aplikasi tidak punya `UPDATE/DELETE` pada `audit_logs`.
- Test: Vitest + Testcontainers (Postgres nyata), bukan mock DB.

## Alternatif
- NestJS: struktur lebih berat/verbose; Fastify + modul folder cukup.
- Supabase/Firebase (BaaS): cepat di awal, tetapi aturan bisnis (snapshot harga, state machine, void + audit, sync idempoten) lebih aman di server sendiri; Firestore tidak cocok untuk laporan agregat & integer money.
- MySQL: setara, tetapi Postgres unggul di `jsonb`, trigger, `CHECK`, `timestamptz`, materialized view.

## Konsekuensi
- (+) Satu stack TS; tim mudah pindah antar layer.
- (+) Postgres cukup untuk bertahun-tahun di skala ini.
- (−) Kita mengelola auth sendiri → wajib review keamanan (argon2id, rate limit, rotasi refresh token).
