ADR-0006 — Auth: pairing perangkat + PIN pegawai, JWT owner

Status: Proposed · Tanggal: 2026-10-26

## Konteks
PRD P-01: pegawai login dengan PIN 6 digit **di perangkat gerai yang didaftarkan owner**. O-01: owner login email + password. PIN 6 digit lemah bila bisa dicoba dari mana saja, sehingga harus terikat perangkat. P-13: kasir perlu tetap bekerja saat offline.

## Keputusan
1. **Owner**: email + password (argon2id). Access JWT 15 menit (RS256/EdDSA), refresh token opaque dirotasi tiap pakai, disimpan hash di `refresh_tokens`, deteksi reuse → cabut semua sesi.
2. **Perangkat**: owner membuat perangkat di dashboard → server membuat pairing code 8 karakter (base32 tanpa karakter ambigu, sekali pakai, 10 menit). Aplikasi kasir menukar kode dengan `device_token` 256-bit acak (hanya hash SHA-256 disimpan di DB). Token dikirim di header `X-Device-Token`. Owner dapat revoke.
3. **Pegawai**: `POST /v1/auth/pin-login` membutuhkan `X-Device-Token` aktif + `employee_id` + PIN. Hasil: JWT 12 jam dengan klaim `role=cashier`, `oid`, `did`, `sub`. Setiap request pegawai memvalidasi JWT **dan** device token (revoke langsung efektif). 5 gagal → `locked_until` 5 menit. PIN unik per outlet, hash argon2id.
4. **PIN owner** (6 digit, terpisah dari password) hanya untuk menyetujui void di perangkat (`approve-with-pin`), tanpa membuat sesi; diaudit.
5. **Login offline**: perangkat menyimpan `pin_hash` pegawai aktif (dari sync pull, hanya ke perangkat terdaftar) di secure storage dan memverifikasi lokal. Bisa dimatikan per outlet (`offline_login_enabled`).
6. RBAC ditegakkan di API (guard per route), bukan di klien.

## Alternatif
- PIN tanpa ikatan perangkat: mudah di-brute-force dari internet.
- Akun email per pegawai: terlalu lambat untuk pergantian kasir di gerai.
- Session cookie untuk kasir: aplikasi native, bearer token lebih sederhana.

## Konsekuensi
- (+) Kehilangan perangkat → owner revoke 1 klik.
- (−) Cache hash PIN di perangkat adalah risiko yang diterima sadar (lihat TDD R-5).
