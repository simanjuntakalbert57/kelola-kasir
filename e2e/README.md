# E2E dashboard (Q-C)

Playwright menguji dashboard owner terhadap **API dan PostgreSQL sungguhan** (bukan mock). Data di-seed lewat API publik
(`support/global-setup.ts`), seperti owner dan kasir sungguhan. Setiap project Playwright memakai database sementara sendiri.

```sh
pnpm install
pnpm --filter @kelola-kasir/e2e exec playwright install chromium firefox webkit
E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @kelola-kasir/e2e e2e
# subset: E2E_PROJECTS="chromium" ... pnpm --filter @kelola-kasir/e2e e2e specs/void.spec.ts
```

Butuh `psql` dan server PostgreSQL yang user-nya boleh `CREATE DATABASE`. `E2E_KEEP_DB=1` mempertahankan database
(untuk latihan backup/restore dengan data seed).

| Spec                      | Test case (docs/qa/test-plan.md)                               |
| ------------------------- | -------------------------------------------------------------- |
| `auth.spec.ts`            | TC-AUTH-01/02, sesi, guard                                     |
| `dashboard.spec.ts`       | TC-DSH-01/02                                                   |
| `catalog.spec.ts`         | TC-PRD-01/02/05/06, TC-TRX-03                                  |
| `people-settings.spec.ts` | TC-EMP-01, TC-AUTH-04/08/09, TC-RBAC-05, TC-DEV-01, TC-SET-01  |
| `shifts.spec.ts`          | TC-SHF-05/07/12                                                |
| `transactions.spec.ts`    | TC-LST-01/02/03 (ekspor CSV/XLSX di Chromium, Firefox, WebKit) |
| `void.spec.ts`            | TC-STM-05/06/09, TC-SHF-13, TC-RBAC-04                         |
| `zz-deletion.spec.ts`     | TC-DEL-01..09 hapus transaksi + Riwayat Hapus (DEAR-124)       |
| `zz-pagination.spec.ts`   | data >1 halaman (jalan terakhir; menambah banyak data)         |

Test yang menandai bug terbuka memakai `test.fail(true, 'DEAR-xx: …')`: suite tetap hijau dan akan **merah** saat bug
diperbaiki, sebagai pengingat menghapus baris itu.

Seed (hari ini WIB): shift 1 Siti (ditutup, modal 100.000, selisih −5.000), shift 2 Budi (terbuka), 8 transaksi,
2 permintaan void menunggu. Omzet 150.000 (paid + void_requested).
