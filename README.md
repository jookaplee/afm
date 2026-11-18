# AFM · Sales & Marketing B2B Dashboard

Sistem dasbor Sales & Marketing untuk perusahaan B2B: memantau pendapatan vs target, pipeline,
forecast kuartal, performa tim sales, efektivitas channel & kampanye marketing, serta mengelola
data deal, lead, kampanye, dan akun — semuanya dalam satu aplikasi.

Antarmuka tersedia dalam **Bahasa Indonesia** dan **English** (tombol di sidebar), mendukung
**mode terang/gelap**, dan nominal ditampilkan dalam **Rupiah** (`Rp 1,2 M`, `Rp 450 jt`).

## Fitur

### Dasbor (analitik)
Semua dasbor memiliki satu baris filter: **periode** (30/90 hari, kuartal ini/lalu, tahun ini,
12 bulan, tahun lalu, rentang kustom), **segmen**, **wilayah**, dan (di Penjualan) **sales rep**.
Setiap KPI dibandingkan dengan periode sebelumnya yang sama panjang dan disertai tren (sparkline).
Filter disimpan di URL sehingga tampilan bisa dibagikan.

| Halaman | Isi |
|---|---|
| **Ringkasan** | Pendapatan vs target (hero + meter), pipeline baru, win rate, rata-rata nilai deal, siklus penjualan, lead baru, konversi MQL→SQL, CAC, ROI marketing; grafik pendapatan vs target, funnel lead → pelanggan, pendapatan per sumber, pipeline per tahap, deal besar yang akan closing |
| **Penjualan** | Pencapaian kuota, forecast kuartal berjalan (closed won / commit / best case / pipeline vs kuota, proyeksi tertimbang, coverage), papan peringkat AE, win rate per segmen, alasan kalah, pendapatan per produk, deal berisiko (lewat tanggal closing / stagnan) |
| **Pemasaran** | Belanja, lead, CPL, MQL, pipeline & pendapatan dari marketing, ROI, CAC; lead per channel, funnel, pipeline per channel, sumber pipeline, tabel efisiensi channel, performa kampanye (ekspor CSV) |

Setiap grafik punya tombol **tampilan tabel**, tooltip saat hover/fokus keyboard, dan palet
warna yang sudah divalidasi aman untuk buta warna (terang & gelap).

### Kelola data
| Halaman | Isi |
|---|---|
| **Pipeline** | Papan kanban — seret kartu untuk memindah tahap (deal kalah meminta alasan) |
| **Deal** | Tabel dengan tab terbuka/menang/kalah, pencarian, filter, sortir, paginasi, tambah/ubah/hapus, ekspor CSV |
| **Lead** | Kualifikasi (Baru → MQL → SQL), **konversi ke deal** (akun dibuat otomatis), diskualifikasi, ekspor CSV |
| **Kampanye** | Budget, realisasi belanja, lead, MQL/SQL, pipeline, pendapatan, ROI per kampanye |
| **Akun** | Basis akun ABM (tier 1/2/3), pendapatan per industri & segmen, detail akun dengan deal, lead, dan riwayat aktivitas |

## Menjalankan

Prasyarat: **Node.js 22.18+** (atau 24+). Tidak ada database eksternal — data disimpan di SQLite
bawaan Node (`node:sqlite`) pada `data/afm.db`.

```bash
npm install
npm run dev        # API :3001 + Vite :5173  → buka http://localhost:5173
```

Produksi:

```bash
npm run build
npm start          # server + aplikasi di http://localhost:3001
```

Saat pertama kali dijalankan, database kosong otomatis diisi **data demo realistis**
(~2,5 tahun riwayat: 14 sales/SDR, ±600 akun, ±80 kampanye, ±4.600 lead, ±950 deal, aktivitas),
yang selalu diselaraskan dengan tanggal hari ini. Buat ulang kapan saja:

```bash
npm run seed       # atau tombol "Reset data demo" di sidebar (non-produksi)
```

Perintah lain: `npm test` (tes API), `npm run typecheck`.

### Konfigurasi (environment variable)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3001` | Port server API |
| `DB_PATH` | `data/afm.db` | Lokasi file SQLite |
| `APP_NAME` | `AFM` | Nama yang tampil di sidebar |
| `ALLOW_RESET` | `true` di dev, `false` di produksi | Mengizinkan `POST /api/admin/reset` |
| `TODAY` | tanggal hari ini | Paksa "hari ini" (YYYY-MM-DD) untuk demo/tes yang dapat diulang |

## Definisi metrik

| Metrik | Rumus |
|---|---|
| Pendapatan | Total nilai deal *closed won* dengan tanggal closing dalam periode |
| Target / kuota | Kuota bulanan per AE, diprorata per hari untuk periode parsial (tidak tersedia saat filter wilayah aktif) |
| Pipeline baru | Total nilai deal yang **dibuat** dalam periode (semua sumber) |
| Pipeline terbuka | Semua deal yang masih terbuka saat ini (snapshot, tidak terpengaruh periode) |
| Pipeline tertimbang | Nilai × probabilitas tahap (Prospek 10%, Kualifikasi 20%, Proposal 40%, Negosiasi 60%) |
| Win rate | Menang ÷ (menang + kalah) untuk deal yang ditutup dalam periode |
| Siklus penjualan | Rata-rata hari dari deal dibuat hingga menang |
| Konversi MQL→SQL | Jumlah SQL ÷ jumlah MQL dalam periode |
| Funnel | Kohort lead yang **masuk** dalam periode dan tahap terjauh yang dicapai |
| Belanja marketing | Realisasi belanja kampanye dibagi rata per hari berjalan; saat filter segmen/wilayah aktif, dialokasikan proporsional terhadap jumlah lead |
| CPL | Belanja ÷ lead baru |
| CAC | Belanja marketing ÷ pelanggan baru (deal *bisnis baru* yang menang) |
| ROI marketing | (Pendapatan dari deal bersumber marketing − belanja) ÷ belanja |
| Forecast kuartal | Closed won kuartal berjalan + deal terbuka dengan perkiraan closing ≤ akhir kuartal; commit = negosiasi, best case = proposal |

## Arsitektur

```
shared/   konstanta enum, tipe API, util tanggal (dipakai server & klien)
server/   Express 5 + node:sqlite
  db.ts         skema
  seed.ts       generator data demo deterministik
  analytics.ts  mesin KPI (overview, sales, marketing)
  crud.ts       deal, lead (+konversi), kampanye, akun
  app.ts        routing REST + penyajian build produksi
  tests/        tes API (node:test)
client/   React 19 + Vite + Recharts
  lib/          i18n (ID/EN), format Rupiah, filter URL, API client
  components/   grafik, tabel, form, filter bar
  pages/        halaman dasbor & kelola data
```

### API ringkas

| Endpoint | Keterangan |
|---|---|
| `GET /api/analytics/overview` · `/sales` · `/marketing` | Parameter: `from`, `to`, `segment`, `region`, `owner` |
| `GET/POST /api/deals`, `PATCH/DELETE /api/deals/:id` | Filter: `stage` (`open`/`closed`/tahap), `search`, `owner`, `segment`, `region`, `source`, `product`, `sort`, `dir`, `page`, `pageSize` |
| `GET/POST /api/leads`, `PATCH/DELETE /api/leads/:id`, `POST /api/leads/:id/convert` | Filter: `status` (`active`/status), `channel`, `segment`, `owner`, `campaign` |
| `GET/POST /api/campaigns`, `PATCH/DELETE /api/campaigns/:id` | Termasuk agregat lead/MQL/SQL/pipeline/pendapatan |
| `GET/POST /api/accounts`, `GET /api/accounts/summary`, `GET/PATCH/DELETE /api/accounts/:id` | Detail akun menyertakan deal, lead, aktivitas |
| `GET /api/meta` | Daftar sales, kampanye, tanggal acuan |

## Catatan & pengembangan berikutnya

- Belum ada autentikasi/otorisasi — tambahkan sebelum dipakai di jaringan publik.
- Data demo dapat diganti dengan data nyata melalui API CRUD atau impor langsung ke tabel SQLite
  (skema di `server/db.ts`). Integrasi CRM (mis. Salesforce/HubSpot) dan iklan (Google/LinkedIn Ads)
  bisa ditambahkan sebagai job sinkronisasi yang menulis ke tabel yang sama.
