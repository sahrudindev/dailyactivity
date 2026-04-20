# AP&M Team Activity Tracker

Sistem pencatatan aktivitas harian berbasis Next.js yang terhubung langsung dengan Google Sheets (via Google Apps Script) untuk tim AP&M. 

Dibuat untuk mempercepat input harian dengan UI yang profesional, mendukung deteksi slot waktu otomatis, dan pemantauan target 9 jam kerja (50 slot) secara real-time.

## Teknologi
*   **Frontend:** Next.js 16 (App Router), React, Tailwind CSS 4
*   **Backend / Database:** Google Apps Script (V8) & Google Sheets
*   **Hosting:** Vercel (Rekomendasi)

## Cara Menjalankan (Local Development)

1. Buat file `.env.local` di root folder dan masukkan URL Web App Google Apps Script Anda:
   ```bash
   NEXT_PUBLIC_SCRIPT_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
   ```

2. Install dependensi dan jalankan server development:
   ```bash
   npm install
   npm run dev
   ```

3. Buka [http://localhost:3000](http://localhost:3000) di browser Anda.

## Deploy ke Production
Aplikasi ini sudah dikonfigurasi untuk production. Jalankan perintah berikut untuk mem-build:
```bash
npm run build
```
Atau deploy langsung repositori ini ke **Vercel** untuk auto-deployment.
