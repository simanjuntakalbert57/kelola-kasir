# APK kasir: build, pasang, dan pairing (DEAR-19)

Aplikasi kasir dipasang langsung ke HP Android (sideload), tanpa Play Console (ADR-0011). APK dibuat oleh workflow GitHub Actions **Android APK** (`.github/workflows/android-apk.yml`). URL API ditanam saat build (`EXPO_PUBLIC_API_URL`, default variabel repo `KASIR_API_URL` = `https://<API_DOMAIN>/v1`, ADR-0012). Tanpa variabel itu, build `release` ditolak; build `staging` di PR memakai URL placeholder yang tidak bisa dihubungi.

| Varian | Ditandatangani dengan | Kapan |
|---|---|---|
| `staging` | debug key (aman dibagikan ke QA) | UAT. Juga dibangun otomatis di setiap PR yang mengubah `apps/kasir` sebagai pengecekan build. |
| `release` | keystore upload milik owner | Go-live dan update berikutnya |

Android hanya mau meng-update aplikasi bila tanda tangannya sama. APK staging dan release beda tanda tangan, jadi pindah dari staging ke release = **uninstall lalu pasang ulang + pairing ulang**.

## 1. Keystore rilis (owner, sekali)

Di komputer owner (butuh JDK; `keytool` ikut terpasang):
```sh
keytool -genkeypair -v -storetype PKCS12 -keystore kelola-kasir-upload.keystore \
  -alias kelola-kasir -keyalg RSA -keysize 2048 -validity 10000
```
- Simpan file `.keystore`, password keystore, alias, dan password key di **password manager** owner, plus satu salinan offline. **Jangan** commit ke repo atau kirim lewat chat.
- Keystore hilang = update aplikasi tidak bisa dipasang di atas versi lama (harus uninstall, data lokal yang belum sinkron hilang).
- Isi GitHub → Settings → Secrets and variables → Actions → **Secrets**:
  - `KASIR_KEYSTORE_BASE64` = hasil `base64 -i kelola-kasir-upload.keystore` (macOS) / `base64 -w0 kelola-kasir-upload.keystore` (Linux)
  - `KASIR_KEYSTORE_PASSWORD`, `KASIR_KEY_ALIAS` (`kelola-kasir`), `KASIR_KEY_PASSWORD`

Workflow menulis keystore ke folder sementara runner dan menghapusnya setelah build; nilainya tidak pernah tercetak di log.

## 2. Build

GitHub → Actions → **Android APK** → Run workflow → pilih `variant` (`staging` / `release`), `api_url` boleh kosong. Build ±20–30 menit. Hasilnya ada di bagian **Artifacts** run tersebut (`kelola-kasir-<versi>-<varian>-<commit>.apk` + `.sha256`), tersimpan 14 hari.

- `EXPO_PUBLIC_APP_VARIANT` (diisi workflow dari `variant`, default `staging`) ikut tertanam di APK saat build. Pada `staging`, layar menampilkan teks error mentah dari API untuk diagnosis; pada `release` hanya pesan Bahasa Indonesia. Build lokal: set variabel ini sendiri (kosong = `release`).
- Sebelum rilis: naikkan `expo.version` (mis. `0.2.0`) dan `android.versionCode` (+1) di `apps/kasir/app.json`, juga `APP_VERSION` di `apps/kasir/src/config.ts`.
- Simpan salinan APK release di Google Drive owner (artifact Actions kedaluwarsa).
- Repo publik: artifact bisa diunduh akun GitHub mana pun. APK tidak berisi secret dan tidak berguna tanpa kode pairing; hapus artifact setelah diunduh bila ingin.

Build lokal (opsional, butuh JDK 17 + Android SDK):
```sh
cd apps/kasir && EXPO_PUBLIC_API_URL=https://<API_DOMAIN>/v1 npx expo prebuild --platform android
cd android && KASIR_KEYSTORE_FILE=/path/kelola-kasir-upload.keystore KASIR_KEYSTORE_PASSWORD=... \
  KASIR_KEY_ALIAS=kelola-kasir KASIR_KEY_PASSWORD=... ./gradlew assembleRelease
# hasil: app/build/outputs/apk/release/app-release.apk
```

## 3. Pasang di HP kasir

1. Unduh file zip artifact di laptop, ekstrak `.apk`. (Opsional: cocokkan `shasum -a 256 <file>.apk` dengan isi `.sha256`.)
2. Kirim `.apk` ke HP (kabel USB, Google Drive, atau WhatsApp ke diri sendiri sebagai dokumen).
3. Di HP: buka file `.apk`. Bila muncul "Untuk keamanan, ponsel tidak diizinkan memasang aplikasi tidak dikenal", ketuk **Setelan** → aktifkan **Izinkan dari sumber ini** untuk aplikasi yang membuka file (Files/Drive/WhatsApp) → kembali → **Pasang**.
4. Bila Play Protect memperingatkan "aplikasi tidak dikenal", pilih **Detail lainnya → Tetap pasang**.
5. Setelah terpasang, matikan lagi izin "sumber tidak dikenal" untuk aplikasi tadi.
6. Buka **Kelola Kasir**. Izinkan **Perangkat sekitar / Bluetooth** saat diminta (untuk printer struk).

## 4. Pairing ke toko

Urutan pertama kali: **pair perangkat (kode 8 karakter) → pilih pegawai → PIN 6 digit**. Layar pertama yang muncul di HP baru adalah layar pairing, bukan layar PIN.

1. Di laptop, login dashboard → **Perangkat** → **Tambah perangkat** → beri nama (mis. "HP Kasir 1") → **Buat kode pairing**. Kode 8 karakter berlaku 10 menit dan hanya tampil sekali.
2. Di HP: layar **Pasangkan perangkat** → ketik kode → **Pasangkan**. Request pertama bisa makan ±1 menit bila server sedang tidur ("Menghubungkan ke server…"); tunggu, jangan tutup aplikasi.
3. Setelah terpasang, pilih pegawai, masukkan **PIN 6 digit** (PIN yang dibuat owner di dashboard; bukan kode pairing 8 karakter), **Buka shift**.
4. Printer: tab **Shift → Printer struk** → nyalakan printer, scan, pilih printer → **Cetak tes**.
5. Cek cepat: jual 1 produk tunai → struk tercetak → di dashboard, transaksi muncul di **Transaksi** (setelah sinkron ±30 detik).

## 5. Update aplikasi

- Varian sama (release → release yang lebih baru): cukup pasang APK baru di atasnya. Data lokal tetap ada.
- Sebelum update, pastikan banner "N transaksi belum tersinkron" sudah hilang.
- Staging → release (go-live): sinkronkan dulu, uninstall APK staging, pasang release, pairing ulang (dan cabut perangkat lama di dashboard).
