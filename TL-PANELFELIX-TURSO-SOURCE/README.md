# TL / PANELFELIX — Pterodactyl Tools + TURSO (Vercel)

**Ini website TOOLS untuk mengelola panel Pterodactyl, BUKAN FELIX PANEL Auto Order.** Tidak ada AustinPay, Firebase, Redis, sistem order, atau login akun website.

Source ini merupakan **rekonstruksi** fitur TL-panelfelix berdasarkan spesifikasi awal karena ZIP source awal tidak tersedia di sesi ini. Jangan anggap identik byte-per-byte dengan source lama.

## Fitur

- Masuk dengan domain HTTPS publik panel + PTLA Application API Key (tanpa registrasi atau login akun website).
- API key dienkripsi AES-256-GCM di backend, tersimpan dalam tabel sesi Turso. Cookie browser hanya menyimpan ID sesi acak HTTPOnly.
- Dashboard angka total server, user, admin, suspended diambil **langsung** dari Pterodactyl Application API. Seluruh halaman diambil, tidak dipotong 100 item. Jika data berubah di tengah pembacaan, tampil error agar tidak menunjukkan total keliru.
- List server / user / admin, pencarian, pagination, refresh.
- Delete server satuan dan checkbox batch; delete user hanya jika bukan admin **dan tidak punya server**.
- Scan user tanpa server, preview, konfirmasi `HAPUS`, recheck sebelum delete.
- Scan server offline memakai optional PTLC yang baru diatur setelah masuk (menu Pengaturan). **PTLA tidak bisa mengetahui runtime status.** Server dengan status unknown atau inaccessible dilewati. Offline berarti `current_state=offline`, bukan sekadar tidak sedang digunakan.
- Log aktivitas per sesi tersimpan di Turso.
- Tanpa mock data server/user.
- Desain Neo Brutalism biru navy/putih, responsif untuk HP dan PC, semua ikon SVG.

## Environment Variables Vercel (tepat 9)

```env
APP_ORIGIN=https://tl-panelfelix.vercel.app
SESSION_SECRET=ISI_RANDOM_MIN_32_KARAKTER
SESSION_TTL_SECONDS=3600
ENABLE_BULK_DELETE=true
PANEL_ALLOWED_HOSTS=
TRUST_PROXY=false
ALLOW_INSECURE_DEV=false
TURSO_DATABASE_URL=libsql://nama-db-namaorg.turso.io
TURSO_AUTH_TOKEN=ISI_TOKEN_TURSO
```

`APP_ORIGIN` memberi domain resmi di konfigurasi, sedangkan pemeriksaan CSRF mengambil origin dari URL request aktual sehingga juga cocok dengan Vercel Preview. `PANEL_ALLOWED_HOSTS` opsional: jika kosong, domain HTTPS publik diperbolehkan (DNS privat/localhost/IP langsung ditolak). Jika diisi, daftar domain dipisahkan koma dan hanya domain itu yang diterima. `TRUST_PROXY` dipertahankan sebagai flag kompatibilitas konfigurasi lama; deployment Vercel tidak memerlukan nilai true. `ALLOW_INSECURE_DEV=false` jangan diaktifkan saat produksi. `SESSION_SECRET` wajib unik dan minimum 32 karakter: jangan gunakan contoh/kunci yang pernah diposting di chat.

Variabel secret harus diisi pada Vercel → Project → Settings → Environment Variables. Jangan upload `.env.local` ke GitHub. **File `.env.example` hanyalah contoh**. Database Turso membuat tabel `sessions` dan `activity` otomatis saat request awal. Tidak perlu `db:migrate`.

## Deploy ke Vercel

1. Upload **isi folder proyek ini** ke root repo GitHub (jangan upload ZIP sebagai satu file).
2. Hubungkan repo ke proyek Vercel `tl-panelfelix` atau buat project baru. Framework `Next.js`, Root Directory `/` jika file `package.json` ada di root. Node.js **22.x** atau versi kompatibel. Build Command `npm run build`, Install Command `npm install` (**jangan** `npm ci` karena paket ZIP ini tidak menyertakan package-lock.json). Output Directory default.
3. Buat database Turso, dapatkan URL dan database token. Set sembilan ENV di atas di Vercel, terutama ketiga secret `SESSION_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
4. Deploy. Buka domain Vercel. Masukkan domain panel HTTPS dan key PTLA dari panel yang Anda kelola.
5. Untuk menghapus server **offline**, buka Pengaturan, tambahkan Client API Key PTLC akun yang dapat melihat server target. Kuncinya opsional; daftar dan total user/server hanya butuh PTLA.

## Keamanan & batasan

- **Hapus permanen tidak dapat di-undo.** Konfirmasi tindakan diperlukan. Untuk operasi massal, frontend mengirim batch maksimal 10 ID; keberhasilan/gagal ditampilkan.
- Penghapusan user admin dan user yang memiliki server ditolak backend walau frontend dimodifikasi.
- Status server PTLC hanya mencakup server yang dapat diakses oleh pemegang kunci PTLC. `unknown` tidak pernah dianggap offline.
- Pterodactyl API bekerja realtime pada saat **refresh/sinkronisasi**, bukan streaming WebSocket terus-menerus. Koneksi timeout 14 detik per request ke panel; ukuran panel dan batas durasi Vercel dapat membatasi waktu operasi besar.
- Proyek tidak otomatis memiliki API key PTLA; pengguna memasukkan sendiri. Jangan gunakan kunci untuk panel tanpa izin.
- Domain panel harus HTTPS publik. Penyaringan DNS privat dilakukan sebelum fetch, namun sebaiknya atur `PANEL_ALLOWED_HOSTS` untuk penggunaan pribadi.
- Sesi disimpan dalam database sehingga tetap ada di beberapa serverless instance. Sesudah sesi kadaluarsa pengguna harus memasukkan domain dan key kembali.
- Jika menggunakan server Vercel dengan waktu eksekusi pendek dan data panel sangat besar, pengambilan semua halaman dapat timeout; error ditampilkan, bukan jumlah palsu.
- Tambahkan rate limiting berbasis WAF jika akan digunakan publik. Tidak ada rate-limit terdistribusi pada versi ini, jadi hindari menaruh kunci penting pada instalasi terbuka tanpa proteksi tambahan.

## Local development

```bash
cp .env.example .env.local
npm install
npm run typecheck
npm test
npm run dev
```

Pada Vercel build cukup `npm run build`. Integrasi sungguhan dengan panel Turso/PTLA/PTLC perlu kredensial yang valid dan **belum bisa diuji di lingkungan ini**.
