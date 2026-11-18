# JOOSONS · Papan Pemuka Jualan & Pemasaran B2B

Sistem papan pemuka Jualan & Pemasaran untuk syarikat B2B: memantau hasil berbanding sasaran,
pipeline, ramalan suku tahun, prestasi pasukan jualan, keberkesanan saluran & kempen pemasaran,
serta mengurus data urus niaga, lead, kempen dan akaun — semuanya dalam satu aplikasi.

Antara muka tersedia dalam **Bahasa Malaysia** dan **English** (butang di bar sisi), menyokong
**mod cerah/gelap**, dan nilai dipaparkan dalam **Ringgit Malaysia** (`RM1.2J`, `RM450K`).

## Ciri-ciri

### Papan pemuka (analitik)
Setiap papan pemuka mempunyai satu baris penapis: **tempoh** (30/90 hari lepas, suku tahun ini/lepas,
tahun ini, 12 bulan lepas, tahun lepas, julat tersuai), **segmen**, **kawasan** dan (di halaman Jualan)
**jurujual**. Setiap KPI dibandingkan dengan tempoh sebelumnya yang sama panjang dan disertakan
trend (sparkline). Penapis disimpan dalam URL supaya paparan boleh dikongsi.

| Halaman | Kandungan |
|---|---|
| **Ringkasan** | Hasil berbanding sasaran (angka utama + meter), pipeline baharu, kadar kemenangan, purata nilai urus niaga, kitaran jualan, lead baharu, penukaran MQL→SQL, CAC, ROI pemasaran; carta hasil berbanding sasaran, corong lead → pelanggan, hasil mengikut sumber, pipeline mengikut peringkat, urus niaga terbesar yang akan ditutup |
| **Jualan** | Pencapaian kuota, ramalan suku tahun semasa (dimenangi / komited / kes terbaik / pipeline berbanding kuota, unjuran berwajaran, liputan pipeline), papan pendahulu AE, kadar kemenangan mengikut segmen, sebab kalah, hasil mengikut produk, urus niaga berisiko (lewat tarikh tutup / tergendala) |
| **Pemasaran** | Perbelanjaan, lead, kos setiap lead, MQL, pipeline & hasil daripada pemasaran, ROI, CAC; lead mengikut saluran, corong, pipeline mengikut saluran, sumber pipeline, jadual kecekapan saluran, prestasi kempen (eksport CSV) |

Setiap carta mempunyai butang **paparan jadual**, tooltip semasa hover/fokus papan kekunci, dan palet
warna yang telah disahkan selamat untuk buta warna (mod cerah & gelap).

### Urus data
| Halaman | Kandungan |
|---|---|
| **Pipeline** | Papan kanban — seret kad untuk memindahkan peringkat (urus niaga kalah memerlukan sebab) |
| **Urus niaga** | Jadual dengan tab terbuka/menang/kalah, carian, penapis, isihan, penomboran halaman, tambah/sunting/padam, eksport CSV |
| **Lead** | Kelayakan (Baharu → MQL → SQL), **tukar kepada urus niaga** (akaun dicipta secara automatik), tandakan tidak layak, eksport CSV |
| **Kempen** | Bajet, perbelanjaan sebenar, lead, MQL/SQL, pipeline, hasil dan ROI setiap kempen |
| **Akaun** | Pangkalan akaun ABM (tier 1/2/3), hasil mengikut industri & segmen, butiran akaun dengan urus niaga, lead dan sejarah aktiviti |

## Cara menjalankan

Prasyarat: **Node.js 22.18+** (atau 24+). Tiada pangkalan data luaran — data disimpan dalam SQLite
terbina dalam Node (`node:sqlite`) di `data/afm.db`.

```bash
npm install
npm run dev        # API :3001 + Vite :5173  → buka http://localhost:5173
```

Produksi:

```bash
npm run build
npm start          # pelayan + aplikasi di http://localhost:3001
```

Pada kali pertama dijalankan, pangkalan data kosong akan diisi secara automatik dengan **data demo
yang realistik** untuk syarikat perisian B2B di Malaysia (±2.5 tahun sejarah: 14 jurujual/SDR,
±600 akaun "Sdn Bhd/Berhad", ±80 kempen, ±4,600 lead, ±950 urus niaga, aktiviti), di seluruh
Lembah Klang, Zon Utara, Zon Selatan, Pantai Timur, Sabah dan Sarawak. Data sentiasa diselaraskan
dengan tarikh hari ini. Jana semula pada bila-bila masa:

```bash
npm run seed       # atau butang "Set semula data demo" di bar sisi (bukan produksi)
```

Arahan lain: `npm test` (ujian API), `npm run typecheck`.

### Versi kendiri (tanpa pelayan) — untuk dibuka terus dalam pelayar

```bash
npm run build:standalone   # → dist-standalone/afm-dashboard.html (satu fail, ±2 MB)
```

Versi ini menjalankan pangkalan data SQLite **dalam pelayar** (sql.js, binaan asm.js tanpa
WebAssembly) dan menggunakan logik API yang sama dengan pelayan. Fail HTML tunggal itu boleh
dihoskan di mana-mana hos statik (cth. claude.ai Artifact, GitHub Pages, S3) dan dibuka dalam
Safari, Chrome atau Firefox. Butang eksport CSV disembunyikan dalam versi ini kerana hos statik
biasanya menyekat muat turun.

**Penyimpanan perubahan.** Apabila dibuka sebagai claude.ai Artifact yang diberi kemampuan `db`,
setiap perubahan (tambah, sunting, padam, pindah peringkat, tukar lead) disimpan sebagai jurnal
dalam pangkalan data artifact. Semasa halaman dibuka, data demo dijana semula daripada tarikh asas
yang sama lalu jurnal dimainkan semula, jadi rekod dan ID kekal sama selepas muat semula dan pada
peranti lain. "Set semula data demo" memulakan set data baharu. Penonton yang hanya ada akses lihat
boleh membaca data tetapi tidak boleh menyimpan perubahan. Di hos lain (tanpa `db`), perubahan
disimpan dalam pelayar itu sendiri (localStorage) jika dibenarkan, atau dalam memori sahaja;
status penyimpanan dipaparkan di bahagian bawah bar sisi.
Butiran: `client/src/standalone/persistence.ts` dan `local-api.ts`.

### Pautan Safari (GitHub Pages) — dikemas kini setiap kali siap

Aliran kerja `.github/workflows/pages.yml` berjalan pada setiap push ke `main` dan ke branch kerja:
ia menjalankan ujian, membina versi kendiri dan menerbitkannya ke branch `gh-pages`. Versi terkini
sentiasa berada di **https://jookaplee.github.io/afm/** dan boleh dibuka terus dalam Safari (atau
pelayar lain) tanpa log masuk. Di sana perubahan disimpan dalam pelayar itu sendiri (localStorage),
jadi ia kekal selepas muat semula pada peranti yang sama.

Tetapan sekali sahaja: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**,
pilih branch `gh-pages` dan folder `/ (root)`.

### Sokongan pelayar

Safari / iOS 15+, Chrome / Edge 100+, Firefox 100+. Penyesuaian khusus Safari:
sasaran build `safari15`/`ios15`, awalan `-webkit-` untuk `appearance` dan `user-select`,
saiz fon 16px pada medan input di skrin kecil (elak zum automatik iOS), `100dvh` untuk
bar alat iOS, kad kanban boleh diseret tanpa elemen `<button>`, dan dialog pengesahan dalam
halaman (bukan `window.confirm`).

### Konfigurasi (pemboleh ubah persekitaran)

| Pemboleh ubah | Lalai | Keterangan |
|---|---|---|
| `PORT` | `3001` | Port pelayan API |
| `DB_PATH` | `data/afm.db` | Lokasi fail SQLite |
| `APP_NAME` | `JOOSONS` | Nama yang dipaparkan di bar sisi |
| `ALLOW_RESET` | `true` semasa pembangunan, `false` di produksi | Membenarkan `POST /api/admin/reset` |
| `TODAY` | tarikh hari ini | Tetapkan "hari ini" (YYYY-MM-DD) untuk demo/ujian yang boleh diulang |

## Definisi metrik

| Metrik | Formula |
|---|---|
| Hasil | Jumlah nilai urus niaga *dimenangi* dengan tarikh tutup dalam tempoh |
| Sasaran / kuota | Kuota bulanan setiap AE, diprorata mengikut hari untuk tempoh separa (tidak tersedia apabila penapis kawasan aktif) |
| Pipeline baharu | Jumlah nilai urus niaga yang **dicipta** dalam tempoh (semua sumber) |
| Pipeline terbuka | Semua urus niaga yang masih terbuka sekarang (kedudukan semasa, tidak dipengaruhi tempoh) |
| Pipeline berwajaran | Nilai × kebarangkalian peringkat (Prospek 10%, Kelayakan 20%, Cadangan 40%, Rundingan 60%) |
| Kadar kemenangan | Menang ÷ (menang + kalah) bagi urus niaga yang ditutup dalam tempoh |
| Kitaran jualan | Purata hari dari urus niaga dicipta hingga dimenangi |
| Penukaran MQL→SQL | Bilangan SQL ÷ bilangan MQL dalam tempoh |
| Corong | Kohort lead yang **masuk** dalam tempoh dan peringkat terjauh yang dicapai |
| Perbelanjaan pemasaran | Perbelanjaan sebenar kempen diagihkan sama rata setiap hari berjalan; apabila penapis segmen/kawasan aktif, diperuntukkan mengikut bahagian lead |
| CPL | Perbelanjaan ÷ lead baharu |
| CAC | Perbelanjaan pemasaran ÷ pelanggan baharu (urus niaga *perniagaan baharu* yang dimenangi) |
| ROI pemasaran | (Hasil daripada urus niaga bersumberkan pemasaran − perbelanjaan) ÷ perbelanjaan |
| Ramalan suku tahun | Urus niaga dimenangi suku tahun semasa + urus niaga terbuka dengan jangkaan tarikh tutup ≤ akhir suku tahun; komited = rundingan, kes terbaik = cadangan |

## Seni bina

```
shared/   pemalar enum, jenis API, utiliti tarikh (digunakan pelayan & klien)
server/   Express 5 + node:sqlite
  db.ts         skema
  seed.ts       penjana data demo deterministik (konteks Malaysia, RM)
  analytics.ts  enjin KPI (ringkasan, jualan, pemasaran)
  crud.ts       urus niaga, lead (+penukaran), kempen, akaun
  schema.ts     skema + jenis Db mudah alih (node:sqlite / sql.js)
  routes.ts     penghala API bebas pengangkutan (Express & pelayar)
  app.ts        pembalut Express + penyajian binaan produksi
  tests/        ujian API (node:test)
client/   React 19 + Vite + Recharts
  lib/          i18n (BM/EN), format Ringgit, penapis URL, klien API
  standalone/   penyesuai sql.js + API dalam pelayar (versi kendiri)
  components/   carta, jadual, borang, baris penapis
  pages/        halaman papan pemuka & urus data
```

### Ringkasan API

| Endpoint | Keterangan |
|---|---|
| `GET /api/analytics/overview` · `/sales` · `/marketing` | Parameter: `from`, `to`, `segment`, `region`, `owner` |
| `GET/POST /api/deals`, `PATCH/DELETE /api/deals/:id` | Penapis: `stage` (`open`/`closed`/peringkat), `search`, `owner`, `segment`, `region`, `source`, `product`, `sort`, `dir`, `page`, `pageSize` |
| `GET/POST /api/leads`, `PATCH/DELETE /api/leads/:id`, `POST /api/leads/:id/convert` | Penapis: `status` (`active`/status), `channel`, `segment`, `owner`, `campaign` |
| `GET/POST /api/campaigns`, `PATCH/DELETE /api/campaigns/:id` | Termasuk agregat lead/MQL/SQL/pipeline/hasil |
| `GET/POST /api/accounts`, `GET /api/accounts/summary`, `GET/PATCH/DELETE /api/accounts/:id` | Butiran akaun termasuk urus niaga, lead dan aktiviti |
| `GET /api/meta` | Senarai jurujual, kempen dan tarikh rujukan |

Nilai enum dalam API (cth. `klang_valley`, `negotiation`) kekal dalam bahasa Inggeris; label
dipaparkan dalam bahasa pengguna oleh antara muka.

## Nota & pembangunan seterusnya

- Belum ada pengesahan/kebenaran pengguna — tambah sebelum digunakan di rangkaian awam.
- Data demo boleh digantikan dengan data sebenar melalui API CRUD atau import terus ke jadual SQLite
  (skema di `server/db.ts`). Integrasi CRM (cth. Salesforce/HubSpot) dan iklan (Google/LinkedIn Ads)
  boleh ditambah sebagai tugas penyegerakan yang menulis ke jadual yang sama.
