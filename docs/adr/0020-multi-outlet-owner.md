ADR-0020 — Multi-cabang: owner memegang beberapa outlet, token terikat 1 outlet aktif + `POST /auth/switch-outlet`

Status: Accepted · Tanggal: 2026-11-02 · Keputusan: Tech Lead · Issue: DEAR-134 (parent DEAR-133) · Implementasi: DEAR-136 (Backend), DEAR-137 (Frontend) · Biaya tambahan: Rp0

## Konteks
Investor ingin mencatat pengeluaran per cabang (Ragunan dan Palmerah, DEAR-133). Prasyaratnya, satu akun owner bisa memegang beberapa outlet. Kondisi saat ini:
- Skema sudah multi-outlet: `outlet_members (outlet_id, user_id, role owner|manager)`, dan semua data (produk, pegawai, perangkat, shift, transaksi, pengaturan) punya `outlet_id`.
- Login owner memilih satu outlet "primary" (`OwnerAuthService.buildSession`: membership `owner` pertama berdasarkan kode outlet) dan menaruhnya di klaim JWT `oid`. Setiap route membaca `principal.outletId`, dan guard `loadOwner` sudah memeriksa membership `(user, oid, role)` di DB pada **setiap request**.
- `OwnerSession.user.outlets` sudah berisi semua outlet milik user, tetapi dashboard hanya memakai `outlets[0]`.
- Produksi baru punya outlet **JUS1**. Nomor transaksi `{OUTLET}-{DEV}-{YYMMDD}-{seq4}` dibuat di HP kasir dari `outlet.code` yang disimpan saat pairing (`apps/kasir/src/auth/SessionProvider.tsx`) dan **tidak diperbarui** lewat sync. API menolak nomor yang tidak diawali `${outlet.code}-${device.code}-` (`transactions/service.ts:142`).
- Manager tetap satu outlet (keputusan owner).

## Keputusan

### 1. Token terikat satu outlet aktif; ganti cabang lewat `POST /auth/switch-outlet`
- Access token owner tetap membawa **satu** `oid` (outlet aktif) dan **role di outlet itu**. Semua endpoint yang ada tetap bekerja pada `principal.outletId` tanpa perubahan.
- `POST /v1/auth/switch-outlet { outlet_id }` → `200 OwnerSession` dengan access token baru untuk outlet itu. Bukan member → `403 FORBIDDEN`. Refresh cookie tidak dirotasi. Tidak diaudit karena hanya navigasi.
- `POST /auth/login` dan `POST /auth/refresh` menerima `outlet_id` opsional. Kalau user masih member outlet itu, token diikat ke sana; kalau tidak, dipakai outlet primary (bukan error), sehingga `localStorage` yang basi tidak mengunci owner.
- `OwnerSession` mendapat `active_outlet_id`, dan `user.outlets[]` mendapat `role` (`OwnerOutletRef`).
- Server tetap stateless: outlet pilihan disimpan dashboard di `localStorage` (`kk_outlet_id`) lalu dikirim saat login/refresh. Tidak ada kolom baru di `refresh_tokens`.

**Kenapa bukan header `X-Outlet-Id`.**
1. Role bisa berbeda per outlet (owner di Ragunan, manager di Palmerah). Dengan token per outlet, role ikut di klaim dan semua guard (`guards.owner`, `ownerOnly`) tetap benar. Dengan header, setiap guard harus menghitung ulang role dari header.
2. Sekitar 50 route membaca `principal.outletId`. Dengan token per outlet, tidak ada satu pun yang berubah. Dengan header, satu header yang lupa dikirim akan diam-diam menulis ke outlet default. Ini kesalahan yang paling mahal, misalnya produk atau pegawai masuk ke cabang yang salah.
3. Biaya validasi sama, karena `loadOwner` sudah memeriksa membership per request.
4. Harga yang dibayar: satu panggilan saat ganti cabang, dan dashboard wajib mengganti token serta membersihkan cache (§5).

### 2. "Semua cabang" hanya untuk laporan, lewat `outlet_scope=all`
- Hanya endpoint yang mendokumentasikan parameter `outlet_scope` yang bisa menggabungkan outlet. Di Fase 1: `GET /expenses`, `GET /expenses/export`, `GET /reports/expenses` (ADR-0021).
- `all` = semua outlet tempat user **saat ini** ber-role `owner` (dibaca dari `outlet_members` per request, bukan dari token). Kalau role di outlet aktif `manager` → `403 FORBIDDEN`. Manager tidak pernah melihat outlet lain.
- Helper backend: `resolveOutletScope(principal, scope) → outletIds[]`, dipakai oleh semua endpoint ber-`outlet_scope` sehingga aturannya ada di satu tempat.
- Endpoint by-id pengeluaran (`GET/PATCH/DELETE /expenses/{id}`, restore) mencari baris di semua outlet tempat user menjadi member, lalu memakai role user di outlet baris itu. Dengan begitu baris dari tampilan "Semua cabang" bisa dibuka tanpa ganti cabang. Endpoint by-id lain (transaksi, produk, dll.) **tetap** dibatasi outlet aktif.
- Data operasional (Transaksi, Produk, Pegawai, Perangkat, Shift, Void, Pengaturan, Ringkasan) **tidak** punya mode "Semua". Di halaman itu, pemilih cabang hanya menampilkan cabang konkret. Agregasi Ringkasan lintas cabang bisa ditambahkan nanti dengan pola `outlet_scope` yang sama tanpa ADR baru.

### 3. Rename outlet JUS1 tanpa memutus HP yang sudah ter-pairing
- Kolom baru `outlets.previous_codes text[] NOT NULL DEFAULT '{}'` (migrasi `0006`). Migrasi yang sama menambah `outlets.operations_started_on date NULL` (ADR-0021 §3).
- Validasi prefix nomor transaksi (`transactions/service.ts`, berlaku untuk `POST /transactions` dan `/sync/push`) menerima `${code}-${device}-` **atau** `${previous_code}-${device}-` untuk kode mana pun di `previous_codes`.
- Akibatnya:
  - Nomor lama `JUS1-…` tetap valid dan tidak diubah. Unique `(outlet_id, number)` tetap berlaku, dan nomor tidak bisa bentrok karena prefiks berbeda.
  - HP yang sudah ter-pairing tetap membuat nomor `JUS1-K01-…` sampai di-pairing ulang. Outbox offline yang belum terkirim tetap diterima. **APK tidak berubah.**
  - Setelah **pairing ulang** (owner: Perangkat → cabut → pairing lagi, sesudah shift ditutup dan outbox kosong), HP menerima kode baru dan nomor menjadi `RGN-K0x-…`. `last_transaction_number` dari pairing masih ber-prefiks lama, sehingga urutan harian dimulai lagi dari 0001 dengan prefiks baru. Itu aman karena prefiksnya berbeda.
  - Kode yang pernah dipakai (termasuk di `previous_codes` outlet lain) tidak boleh dipakai outlet baru. Ini dijaga oleh skrip ops.
- Skrip ops (non-destruktif, satu transaksi DB, audit `outlet.renamed` / `outlet.created`, sudah diuji di PostgreSQL 16):
  - `ops/vps/rename-outlet.sql` (`-v old_code=JUS1 -v new_code=… -v new_name='…'`). Mengubah `code` dan `name`, lalu menambahkan kode lama ke `previous_codes`. `outlet_settings.display_name` (header struk) ikut berubah hanya kalau masih sama dengan nama lama.
  - `ops/vps/create-branch-outlet.sql` (`-v code=… -v name='…' -v owner_email=…`). Membuat outlet, `outlet_settings` default, membership `owner` untuk akun owner yang sudah ada, dan kategori pengeluaran default (`kk_seed_expense_categories`, ADR-0021).
  - **Urutan produksi** (Stage 3, perlu OK Albert): deploy API yang sudah mengenal `previous_codes` → jalankan rename → jalankan create-branch → owner mengisi produk, pegawai, dan pengaturan cabang baru di dashboard → pairing HP cabang baru. Rename **sebelum** deploy API baru akan membuat sync HP lama ditolak, jadi urutan ini wajib.
  - **Keputusan final (Albert, DEAR-140, 1 Nov 2026): JUS1 = Ragunan (`RGN`).** JUS1 di-rename menjadi Ragunan, dan **Palmerah (`PLM`)** dibuat sebagai outlet baru yang mulai kosong.
  - **Tidak ada data yang dihapus** (DEAR-140). Migrasi ini hanya rename: produk, harga, pegawai, HP yang ter-pairing, shift, dan transaksi (termasuk transaksi uji coba) tetap utuh. `delete-outlet.sql` dan `reset-outlet-data.sql` **tidak** dipakai di alur ini. Angka uji coba dikeluarkan dari Rekap lewat `outlets.operations_started_on` (ADR-0021 §3), bukan dengan menghapus data.
  - Kedua skrip menerima `-v operations_started_on=YYYY-MM-DD` opsional (tanggal mulai operasional cabang). Kalau belum diketahui, kosongkan saja; owner bisa mengisinya nanti di Pengaturan.
- Kode outlet tetap 2–6 huruf/angka (sama dengan `create-owner`). Contoh di konsep: `RGN`, `PLM`.

### 4. Notifikasi Web Push untuk owner banyak cabang
Saat ini `push_subscriptions` punya `outlet_id`. Notifier hanya mengirim ke langganan dengan `outlet_id` = outlet transaksi. Pendaftaran dari outlet lain akan me-*replace* langganan browser yang sama. Kalau dibiarkan, owner yang mengaktifkan notifikasi di Ragunan tidak akan menerima transaksi Palmerah. Aturan Fase 1 (tanpa migrasi):
- Notifier untuk outlet X mengirim ke langganan aktif milik **user yang ber-role owner di X**, apa pun `outlet_id` langganannya. Preferensi tetap per `(X, user)` (`notification_prefs`).
- Pendaftaran ulang browser yang sama oleh user yang sama dari outlet lain adalah **update**, bukan replace. `outlet_id` di langganan menjadi informasi "didaftarkan dari".
- Judul notifikasi diawali nama cabang kalau user punya ≥2 outlet (mis. "Palmerah · Transaksi Rp25.000").

### 5. Aturan dashboard
- Pemilih cabang ada di header (desktop) dan di atas konten (mobile), berisi `user.outlets` dan opsi **Semua cabang** kalau ada ≥2 outlet ber-role owner. "Semua cabang" hanya aktif di halaman Pengeluaran dan Rekap. Di halaman lain, pilihan itu kembali ke cabang terakhir.
- Ganti cabang: panggil `switch-outlet` → ganti access token → simpan `kk_outlet_id` → **bersihkan seluruh cache React Query** (`queryClient.clear()`, seperti saat logout). Cara ini lebih aman daripada invalidasi per key, karena satu key yang terlewat akan menampilkan data cabang lain.
- Query key data per outlet wajib menyertakan `active_outlet_id`, sebagai sabuk pengaman kalau ada respons lama yang datang belakangan.
- Form Tambah pengeluaran selalu menulis ke cabang aktif. Kalau sedang di "Semua cabang", form menampilkan pilihan cabang, dan memilihnya memanggil `switch-outlet` sebelum simpan.
- Nama outlet di sidebar memakai outlet aktif, bukan `outlets[0]`.

### 6. Inventaris yang terdampak pemilih cabang
Legenda: **Aktif** = otomatis mengikuti outlet aktif lewat token, tidak perlu perubahan kode selain yang disebut. **Scope** = mendukung `outlet_scope=all`. **Ubah** = perlu perubahan di DEAR-136/137.

**API** (path relatif `apps/api/src`)
| Endpoint / modul | Aturan | Catatan |
|---|---|---|
| `POST /auth/login`, `POST /auth/refresh` (`modules/auth/owner-service.ts` `buildSession`) | **Ubah** | `outlet_id` opsional, `active_outlet_id`, `role` per outlet. |
| `POST /auth/switch-outlet` (baru) | **Ubah** | §1. Rate limit global (sama dengan refresh). |
| `GET /me` | Aktif | `outlet_id` = outlet aktif. |
| `GET/POST /devices`, `/devices/{id}/revoke`, pairing | Aktif | Kode perangkat per outlet (K01 mulai lagi di cabang baru). |
| `GET/POST/PATCH /employees`, reset PIN | Aktif | PIN unik per outlet. |
| `/categories`, `/products`, impor produk, `/catalog` | Aktif | |
| `GET /shifts`, `/shifts/{id}/summary` | Aktif | |
| `GET /transactions`, export, deleted, detail, delete/restore, receipt | Aktif | By-id tetap dibatasi outlet aktif. |
| `POST /transactions`, `/sync/push` (`modules/transactions/service.ts:142`) | **Ubah** | Terima prefiks `previous_codes` (§3). |
| `/void-requests`, approve/reject | Aktif | Approve-with-PIN di HP memakai outlet perangkat dan tetap jalan untuk owner yang member di kedua outlet. |
| `/dashboard/sales-series`, `/top-products`, `/reports/sales` | Aktif | Belum ada "Semua" (§2). |
| `/dashboard/summary` (DEAR-155), `/reports/products*` (ADR-0022) | Aktif + **Scope** | |
| `GET/PATCH /settings`, QRIS decode | Aktif | Pengaturan struk/QRIS per cabang. |
| `POST /uploads` | **Ubah** | Purpose `expense_receipt` + `outlet_id` opsional (ADR-0021). |
| `/notifications/*`, `modules/notifications/notifier.ts` | **Ubah** | §4. |
| `/expense-categories`, `/expenses*` | Aktif + **Scope** | ADR-0021. By-id lintas outlet member. |
| `GET /reports/expenses` | **Scope** | ADR-0021. |
| `src/scripts/create-owner.ts` | Diubah di PR ini | Seed kategori pengeluaran untuk outlet baru. |

**Dashboard** (`apps/dashboard/src`)
| Halaman / bagian | Aturan | Catatan |
|---|---|---|
| `auth/AuthProvider.tsx`, `lib/api.ts` | **Ubah** | Simpan `active_outlet_id`, kirim `outlet_id` saat login/refresh, `switchOutlet()`, `queryClient.clear()`. |
| `layout/AppShell.tsx` | **Ubah** | Pemilih cabang, nama outlet aktif, menu baru **Pengeluaran**. |
| Ringkasan `/` (`DashboardPage`) | Aktif | Label cabang aktif di judul. |
| Transaksi `/transaksi`, Riwayat Hapus `/transaksi/dihapus` | Aktif | |
| Produk `/produk`, Impor `/produk/impor` | Aktif | Impor ke cabang aktif, tampilkan nama cabang di langkah konfirmasi. |
| Pegawai `/pegawai`, Perangkat `/perangkat` | Aktif | Tampilkan nama cabang di dialog pairing supaya HP tidak dipasang ke cabang yang salah. |
| Shift `/shift`, Void `/void` | Aktif | Badge jumlah void di header hanya untuk cabang aktif. |
| Pengaturan `/pengaturan`, Notifikasi `/pengaturan/notifikasi` | Aktif | Prefs notifikasi per cabang (§4). |
| Pengeluaran, Rekap, Kategori (baru) | **Scope** | ADR-0021. |
| `components/PushBridge.tsx`, `lib/push.ts` | **Ubah** | Daftar ulang tidak me-replace langganan antar-cabang (§4). |

**Aplikasi kasir**: tidak berubah (§3).

## Alternatif yang ditolak
- **Header `X-Outlet-Id` per request.** Lihat §1. Role per outlet dan risiko salah tulis ke outlet default.
- **Token dengan daftar semua outlet + parameter `outlet_id` di setiap endpoint.** Semua route dan OpenAPI harus berubah, dengan risiko kebocoran yang sama seperti header.
- **Akun terpisah per cabang.** Melanggar konsep (satu owner banyak cabang), dan laporan gabungan jadi mustahil.
- **Mengganti prefiks nomor lama (`JUS1-` → `RGN-`) dengan update massal.** Destruktif, melanggar trigger imutabilitas transaksi, dan memutus struk yang sudah dicetak.
- **Mempertahankan kode JUS1 dan hanya mengganti nama.** Paling sederhana, tetapi owner ingin kode cabang di nomor transaksi. Kalau Albert lebih memilih ini, skrip rename tetap bisa dipakai dengan `new_code=JUS1`.

## Konsekuensi
- (+) Perubahan backend kecil dan terlokalisasi (auth, prefiks nomor, notifier, uploads). Semua endpoint lain langsung multi-cabang. APK tidak berubah. Biaya Rp0.
- (+) Data lama utuh. Rename hanya menyentuh satu baris `outlets` (+ `display_name`, dan `operations_started_on` kalau diisi) dan tercatat di audit.
- (−) Dashboard wajib disiplin mengganti token dan membersihkan cache saat ganti cabang. Access token lama tetap valid ≤15 menit untuk outlet lama. Itu bukan masalah keamanan karena user memang member, tetapi tab lain bisa masih menampilkan cabang lain sampai di-refresh.
- (−) HP lama tetap memakai nomor `JUS1-…` sampai di-pairing ulang. Struk menampilkan nama baru (dari pengaturan) dengan nomor berprefiks lama di masa transisi.
- Migrasi hanya menambah kolom dengan default. Aman tanpa downtime.
