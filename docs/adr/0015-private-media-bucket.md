ADR-0015 — Bucket media privat, gambar disajikan lewat API (redirect presigned GET)

Status: Accepted · Tanggal: 2026-10-29 · Keputusan: Albert (jalur 3a) + Tech Lead, dicatat di DEAR-93/DEAR-94 · Menggantikan bagian media publik di [ADR-0011](0011-free-tier-hosting.md) · Biaya tambahan: Rp0

## Konteks
Unggah gambar (QRIS, logo, foto produk) gagal karena `STORAGE_*` belum diisi. ADR-0011 mengandaikan bucket media **publik** (r2.dev / URL publik B2) dan menyimpan URL publik itu di DB. Bucket publik di Backblaze B2 berbayar, sedangkan R2 meminta kartu. Albert memilih bucket S3-compatible tetap **privat**.

Presigned GET tidak bisa disimpan sebagai nilai field: URL itu kedaluwarsa, padahal kasir menyimpan `image_url` di SQLite untuk offline dan dashboard menyimpan nilai form apa adanya.

## Keputusan
- Bucket media **privat**. Tidak ada URL publik bucket yang dipakai.
- `GET /v1/media/<key>` (tanpa auth, karena `<img>` tidak bisa mengirim bearer token) menjawab **302** ke presigned GET berumur 10 menit, dengan `Cache-Control: private, max-age=300`.
- Key divalidasi ketat: `^[0-9a-f-]{36}/(product_image|logo|qris_image)/[0-9a-f-]{36}\.(jpg|png|webp)$`. Selain itu 404, jadi tidak ada path traversal dan objek lain di bucket (mis. `postgres/` backup) tidak terjangkau. Storage belum dikonfigurasi → 503 `UPLOADS_NOT_CONFIGURED`.
- `POST /v1/uploads` tetap presigned PUT. Field `public_url` dipertahankan, isinya sekarang `${API_PUBLIC_BASE_URL}/v1/media/<key>`. `API_PUBLIC_BASE_URL` adalah alamat yang dipakai klien (URL Pages, ADR-0014); proxy Pages meneruskan 302 apa adanya (`redirect: 'manual'`).
- Config: `STORAGE_PUBLIC_BASE_URL` jadi opsional/legacy. "Semua atau tidak sama sekali" berlaku untuk 4 variabel `STORAGE_*` inti, ditambah `API_PUBLIC_BASE_URL` wajib bila storage aktif.
- Validasi URL gambar menerima prefix `${API_PUBLIC_BASE_URL}/v1/media/` dan, bila diset, `STORAGE_PUBLIC_BASE_URL` (data lama). Domain lain ditolak. Isi DB tidak diubah.
- CORS bucket cukup `PUT` dari origin dashboard; unduhan lewat redirect untuk `<img>` tidak memerlukan CORS.

## Trade-off keamanan
Kerahasiaan bergantung pada UUID acak di key (capability URL): siapa pun yang tahu URL bisa melihat gambar. Ini cukup untuk logo, foto produk, dan QRIS statis (yang memang ditunjukkan ke pelanggan). Jangan memakai endpoint ini untuk dokumen sensitif. Key tidak bisa ditebak dan tidak ada endpoint yang mendaftar isi bucket.

## Alternatif yang ditolak
- **Bucket publik.** B2 berbayar; R2 meminta kartu.
- **Menyimpan presigned GET di DB.** Kedaluwarsa; merusak cache offline kasir.
- **Endpoint yang mengalirkan byte lewat API.** Membebani VPS/bandwidth dan kuota Pages Functions tanpa manfaat tambahan.
- **Endpoint berauth.** `<img>` tidak bisa mengirim bearer token.

## Konsekuensi
- (+) Biaya Rp0, bucket tidak pernah publik, URL tersimpan stabil (cache offline kasir tetap valid).
- (−) Setiap gambar baru memakai satu request ke Pages Function (+ API) sebelum redirect; di-cache klien 5 menit.
- (−) `API_PUBLIC_BASE_URL` tertanam di URL tersimpan. Mengubahnya setelah ada unggahan membuat URL lama ditolak saat disimpan ulang; tetapkan sebelum unggahan pertama.
