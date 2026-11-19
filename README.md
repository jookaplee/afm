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
| **Lead** | Kelayakan (Lead baharu → Dihubungi → Berkelayakan), **tambah ke pipeline** (akaun dicipta secara automatik), tandakan tidak layak, telefon & pautan WhatsApp, eksport CSV |
| **Kempen** | Bajet, perbelanjaan sebenar, lead, MQL/SQL, pipeline, hasil dan ROI setiap kempen |
| **Akaun** | Pangkalan akaun (saiz Tier A/B/C, kategori, kawasan, PIC, telefon/WhatsApp, anggaran jualan, penilaian, keutamaan), butiran akaun dengan profil, laman web & media sosial, urus niaga, lead dan sejarah aktiviti |
| **Pasukan** | Jurujual, peranan, fokus saiz akaun dan **kuota bulanan** (menjadi sasaran papan pemuka); tambah/nyahaktif ahli |
| **WhatsApp** | Semua nombor telefon lead (mudah alih / talian tetap / tidak sah / dikongsi), templat mesej, penghantar mesej, mod kempen satu demi satu, tanda "dibalas" dan log mesej (lihat di bawah) |
| **Pesanan** | Pesanan pelanggan (daripada ejen WhatsApp atau dimasukkan sendiri) mengikut status, butiran, sahkan/sediakan/hantar/batal, dan **katalog produk** dengan harga (lihat di bawah) |
| **Ejen AI** | Ejen yang sentiasa menyemak data lead (telefon, PIC, alamat, e-mel, laman web, media sosial, masih beroperasi atau tidak) dan mencari lead baharu; setiap cadangan bersumber menunggu keputusan anda (lihat di bawah) |

### WhatsApp — hubungi lead terus

Halaman **WhatsApp** direka seperti aplikasi WhatsApp: senarai sembang di kiri (avatar, pratonton mesej
terakhir, masa, tanda ✓✓, cip *Semua / Belum dihubungi / Dihantar / Dibalas*) dan perbualan di kanan
(gelembung mesej, pemisah tarikh, bar tulis mesej dengan templat dan draf AI), dengan mod cerah dan
gelap. Pada telefon, senarai dan perbualan dipaparkan satu demi satu seperti aplikasi sebenar.
Butang WhatsApp di halaman Lead dan Akaun terus membuka perbualan lead itu.

Halaman ini menyenaraikan setiap lead yang ada nombor telefon. Nombor dikelaskan secara
automatik: **mudah alih** (01x, biasanya ada WhatsApp), **talian tetap** (jarang ada WhatsApp),
**tidak sah**, dan **dikongsi** (nombor sama pada beberapa lead, cth. ibu pejabat).

- **Templat** dengan ruang isi `{nama}`, `{perniagaan}`, `{kawasan}`, `{nama_saya}`, `{syarikat_saya}`;
  empat templat permulaan (perkenalan, susulan, tawaran sampel, terima kasih) boleh disunting.
  Nama penghantar dan syarikat ditetapkan sekali dalam *Tetapan*.
- **Hantar**: mesej disediakan daripada templat (atau **Draf dengan AI** menggunakan kunci API Ejen AI),
  boleh disunting, kemudian **Buka WhatsApp** membuka sembang dengan teks siap diisi dalam aplikasi
  WhatsApp (telefon) atau WhatsApp Web (komputer) melalui pautan `wa.me`. Anda menekan hantar dalam
  WhatsApp; papan pemuka merekod mesej dan menukar lead *Lead baharu* kepada *Dihubungi*.
- **Mod kempen**: melalui senarai semasa satu demi satu (Buka WhatsApp & seterusnya / Langkau /
  Tiada WhatsApp), menggunakan satu tetingkap WhatsApp yang sama. Pada *Semua*, kempen hanya mengambil
  lead yang belum dihubungi; pilih *Dihantar* untuk kempen susulan.
- **Dibalas**: tandakan lead yang membalas (WhatsApp tidak membenarkan papan pemuka membaca balasan
  daripada akaun peribadi). Kadar balasan dipaparkan.
- Butang WhatsApp juga ada di senarai **Lead** dan halaman **Akaun**.

Mesej dihantar daripada akaun WhatsApp anda sendiri — tiada akaun Meta Business atau API diperlukan.
Hantar secara berperingkat: terlalu banyak mesej tanpa diminta boleh menyebabkan nombor disekat.
(Penghantaran automatik dan peti masuk balasan memerlukan WhatsApp Business Platform dengan pelayan
awam untuk webhook.)

### Ejen WhatsApp — jawab pelanggan & urus pesanan

Ejen WhatsApp (Claude, lalai Claude Opus 5.5) membaca perbualan pelanggan dan:

- menjawab soalan produk dan harga **hanya daripada katalog produk** dan *maklumat perniagaan* yang
  anda isi (syarikat, kawasan penghantaran, pesanan minimum, bayaran, waktu operasi, polisi);
- **mengambil pesanan**: mengesahkan item, kuantiti (kuantiti minimum dihormati), tarikh dan alamat
  penghantaran, lalu mencipta pesanan berstatus *Menunggu pengesahan* — harga dan jumlah dikira oleh
  pelayan daripada katalog, bukan oleh model; ia juga boleh menukar atau membatalkan pesanan yang
  masih menunggu, dan menjawab soalan status pesanan;
- **menyerahkan kepada staf** (banner merah *Perlu staf* dan penapis *Perlu staf*) untuk aduan,
  bayaran/refund, permintaan diskaun atau harga khas, apa-apa di luar maklumat perniagaan, atau
  apabila pelanggan meminta orang;
- tidak mengikut arahan dalam mesej pelanggan yang cuba mengubah peraturan, harga atau polisi.

Balasan ejen menjadi **draf** (Hantar / Sunting / Buang), atau dihantar terus jika *Hantar balasan
secara automatik* dihidupkan (Business API sahaja). Ejen boleh dimatikan bagi setiap sembang.

**Dua cara menggunakannya:**

1. **Mod pembantu (tanpa akaun Meta)** — guna WhatsApp anda sendiri. Dalam sembang, tekan butang
   *Mesej pelanggan* dan tampal mesej yang diterima; ejen menyediakan draf balasan (dan pesanan), dan
   *Hantar* membukanya dalam WhatsApp melalui `wa.me`. Ejen dijalankan dalam pelayar dengan kunci API
   di halaman *Ejen AI* (atau oleh pelayan jika `ANTHROPIC_API_KEY` ditetapkan). Butang yang sama
   boleh digunakan untuk menguji ejen.
2. **WhatsApp Business Platform (Cloud API)** — mesej pelanggan masuk sendiri melalui webhook dan
   balasan dihantar dari papan pemuka, termasuk status ✓ / ✓✓ / dibaca. Perlu pelayan awam (lihat
   *Menyambung WhatsApp Business API* di bawah). WhatsApp hanya membenarkan mesej bebas dalam
   **24 jam** selepas mesej terakhir pelanggan; di luar tetingkap itu papan pemuka tidak menghantar
   (mesej templat yang diluluskan Meta belum disokong).

Pelanggan baharu yang menghantar mesej dicipta sebagai lead (saluran *WhatsApp masuk*).

### Pesanan & katalog produk

Halaman **Pesanan** menyenaraikan pesanan mengikut status: *Menunggu pengesahan → Disahkan → Sedang
disediakan → Dihantar*, atau *Dibatalkan*. Item hanya boleh ditukar semasa menunggu. **Mengesahkan
pesanan** merekodkannya sebagai urus niaga *dimenangi* (hasil pada papan pemuka), mencipta akaun jika
lead belum ada akaun, dan menukar lead kepada pelanggan; membatalkan pesanan yang telah disahkan
menukar urus niaga itu kepada *kalah*. Tab **Katalog produk** menyimpan nama, kategori, unit, harga
(RM, sen tepat), kuantiti minimum, stok (pilihan) dan keterangan — ejen hanya menyebut produk aktif.

### Menyambung WhatsApp Business API

1. Di Meta for Developers, cipta aplikasi *Business*, tambah produk **WhatsApp**, daftarkan nombor
   perniagaan (nombor itu tidak boleh digunakan serentak dalam aplikasi WhatsApp biasa) dan jana
   token akses kekal (System User). Catat *Phone number ID* dan *App secret*.
2. Pasang pelayan secara awam dengan HTTPS, cth. dengan Docker (`Dockerfile` disediakan; simpan
   `/data` pada volum kekal):

   ```bash
   docker build -t joosons .
   docker run -p 3001:3001 -v joosons-data:/data \
     -e DASHBOARD_PASSWORD=... -e ANTHROPIC_API_KEY=... \
     -e WHATSAPP_TOKEN=... -e WHATSAPP_PHONE_NUMBER_ID=... \
     -e WHATSAPP_APP_SECRET=... -e WHATSAPP_VERIFY_TOKEN=rentetan-rawak joosons
   ```

   Import senarai prospek ke dalam pelayan itu dengan `npm run import`. Dalam mod produksi pelayan
   **enggan bermula** jika WhatsApp disambungkan tanpa `DASHBOARD_PASSWORD` (log masuk HTTP Basic untuk
   papan pemuka dan API; webhook kekal terbuka kerana ia disahkan dengan tandatangan Meta).
3. Dalam aplikasi Meta → WhatsApp → *Configuration*: URL panggil balik
   `https://domain-anda/webhooks/whatsapp`, token pengesahan = `WHATSAPP_VERIFY_TOKEN`, dan langgan
   medan **messages**.
4. Dalam papan pemuka → WhatsApp → *Ejen WhatsApp*: isi maklumat perniagaan, isi katalog produk, dan
   pilih sama ada balasan dihantar automatik.

Kos: Meta mengenakan caj mengikut perbualan/mesej WhatsApp Business; setiap balasan ejen menggunakan
API Anthropic (dicaj ke akaun anda).

### Ejen AI — semakan data & pencarian lead

Ejen ini menggunakan **Claude** (lalai: Claude Opus 5.5) dengan alat **carian web** dan **web fetch**
Anthropic. Setiap kitaran:

1. **Menyemak akaun** — akaun yang belum disemak didahulukan, kemudian yang paling lama (Tier A
   dahulu). Claude mencari senarai Google, laman web, Facebook/Instagram/TikTok, GrabFood/Foodpanda dan
   direktori, lalu melaporkan telefon, PIC, alamat, e-mel, laman web, media sosial, nama syarikat
   berdaftar dan sama ada perniagaan masih beroperasi — **setiap nilai dengan URL sumber dan tahap
   keyakinan**.
2. **Mencari lead baharu** — bergilir mengikut kategori × kawasan (cth. "Restoran Halal Western ·
   Zon Selatan"), dengan senarai nama sedia ada sebagai pengecualian.

Laporan Claude dihantar melalui alat berstruktur (`strict`), kemudian dibersihkan: nombor telefon mesti
format Malaysia yang sah, pautan mesti http(s), dan nilai tanpa sumber dibuang. Hasilnya:

- nilai yang **sama** dengan data sedia ada → dikira "disahkan";
- medan **kosong** + keyakinan tinggi → diisi automatik (boleh dimatikan; tidak pernah menulis ganti);
- nilai **berbeza**, perniagaan **mungkin tutup** dan **lead baharu** → senarai *Perlu keputusan*
  (Terima / Tolak). Nilai yang ditolak tidak dicadangkan semula; lead baharu yang sudah wujud (nama,
  telefon atau laman web sama) diabaikan.

**Di mana ia berjalan.** Pada pautan Safari / GitHub Pages: masukkan kunci API Anthropic di halaman
*Ejen AI* (disimpan dalam pelayar itu sahaja); autopilot berjalan setiap *N* minit selagi papan pemuka
dibuka, satu tab sahaja pada satu masa. Pada pelayan Express: tetapkan `ANTHROPIC_API_KEY` dan pelayan
menjalankan autopilot sendiri walaupun tiada siapa membuka papan pemuka. Dalam claude.ai Artifact ejen
tidak boleh berjalan (halaman tidak dibenarkan mencapai internet).

**Kos & had.** Tetapan: model (Opus 5.5 / Sonnet 5.5 / Haiku 5.5), akaun setiap kitaran, lead baharu
setiap kitaran, selang, **had panggilan sehari** dan tempoh semakan semula. Halaman memaparkan
penggunaan hari ini dan anggaran kos token; carian web dicaj berasingan oleh Anthropic. Permintaan
menggunakan *server-side fallback* Anthropic supaya permintaan yang ditolak oleh pengelas keselamatan
dicuba semula pada model lain secara automatik (Opus/Sonnet sahaja).

**Privasi.** Butiran akaun (nama perniagaan, telefon, PIC) dihantar kepada Anthropic untuk disemak.

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

### Import senarai prospek (data sebenar)

```bash
npm run import -- /laluan/ke/CRM_B2B.html   # atau fail .json
```

Arahan ini **mengosongkan pangkalan data** dan memulakannya semula dengan senarai prospek daripada
fail eksport CRM (HTML satu fail dengan `<script id="lead-data">`, atau JSON `[...]` /
`{ leads, categories }`). Setiap perniagaan menjadi satu **akaun** dan pemilik/PIC menjadi satu
**lead** berstatus *Lead baharu* (saluran "Senarai prospek"); rekod pendua (nama + telefon sama)
digabungkan. Pemetaan:

| Sumber | Dalam papan pemuka |
|---|---|
| Anggaran jualan ≥ RM1J / ≥ RM300K / lain-lain | Saiz akaun **Tier A / Tier B / Tier C** |
| Negeri / kawasan | Lembah Klang, Zon Utara, Zon Selatan, Pantai Timur, Sabah, Sarawak |
| Kategori | Restoran Halal Western, Kafe Premium (Steak & BBQ), Penjual Perap Online Western, F&B lain |
| Tier A / B / C | Keutamaan akaun Panas / Suam / Sejuk (boleh diubah) |
| Tier + penilaian Google + kategori | Skor lead (0–100), digunakan untuk menyusun senarai lead |

Pasukan lalai ialah *Pengurus Jualan*, *Sales 1* dan *Sales 2*; urus niaga, hasil dan kempen bermula
kosong. Tetapkan kuota bulanan di halaman **Pasukan** supaya sasaran dipaparkan. Salinan set data
disimpan di `data/import/crm-dataset.json` (tidak dikomit ke git kerana mengandungi nama dan nombor
telefon), dan "Set semula data" akan kembali kepada set data ini, bukan data demo.

### Data demo

Tanpa set data import, pangkalan data kosong akan diisi secara automatik dengan **data demo
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
# dengan senarai prospek dibenamkan (bukan data demo):
DATASET=data/import/crm-dataset.json npm run build:standalone
```

Versi ini menjalankan pangkalan data SQLite **dalam pelayar** (sql.js, binaan asm.js tanpa
WebAssembly) dan menggunakan logik API yang sama dengan pelayan. Fail HTML tunggal itu boleh
dihoskan di mana-mana hos statik (cth. claude.ai Artifact, GitHub Pages, S3) dan dibuka dalam
Safari, Chrome atau Firefox. Butang eksport CSV disembunyikan dalam versi ini kerana hos statik
biasanya menyekat muat turun.

**Penyimpanan perubahan.** Apabila dibuka sebagai claude.ai Artifact yang diberi kemampuan `db`,
setiap perubahan (tambah, sunting, padam, pindah peringkat, tukar lead) disimpan sebagai jurnal
dalam pangkalan data artifact. Semasa halaman dibuka, data asas (senarai prospek yang dibenamkan,
atau data demo) dibina semula lalu jurnal dimainkan semula, jadi rekod dan ID kekal sama selepas
muat semula dan pada peranti lain. Jika data asas bertukar (cth. senarai prospek baharu), jurnal
lama diabaikan dan dibersihkan secara automatik. "Set semula data" memulakan jurnal baharu. Penonton yang hanya ada akses lihat
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

**Senarai prospek dengan kata laluan.** Repositori dan GitHub Pages boleh dibuka oleh sesiapa
sahaja (menjadikan repositori peribadi tidak menjadikan laman Pages peribadi), jadi senarai prospek
tidak pernah diterbitkan dalam bentuk teks biasa. Sebaliknya ia disulitkan:

```bash
npm run seal                                  # daripada data/import/crm-dataset.json
DATASET_PASSWORD='...' npm run seal -- <fail>  # guna kata laluan sendiri (≥12 aksara)
```

Arahan ini menulis `data/crm-dataset.sealed.json` (AES-256-GCM, kunci daripada kata laluan melalui
PBKDF2-SHA256 600,000 lelaran). Tanpa `DATASET_PASSWORD`, kata laluan rawak yang kuat dijana dan
dipaparkan **sekali sahaja** — ia tidak disimpan di mana-mana. Komit fail itu; aliran kerja Pages
akan membenamkannya dan halaman akan meminta kata laluan sebelum memaparkan data (huruf besar/kecil,
ruang dan sempang tidak diambil kira). Pilihan "Ingat pada peranti ini" menyimpan kunci terbitan
(bukan kata laluan) dalam pelayar; "Kunci peranti ini" di bar sisi melupakannya. Halaman juga
ditandakan `noindex` supaya tidak diindeks enjin carian. Untuk menukar kata laluan atau senarai,
jalankan `npm run seal` semula dan komit fail baharu. Untuk kembali kepada data demo, padam fail itu.

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
| `DATASET_PATH` | `data/import/crm-dataset.json` | Set data prospek yang diimport (digunakan semasa mula & set semula) |
| `DATASET_PASSWORD` | dijana | Kata laluan untuk `npm run seal` |
| `ANTHROPIC_API_KEY` | — | Jika ditetapkan, pelayan menjalankan autopilot Ejen AI dan ejen WhatsApp sendiri |
| `DASHBOARD_PASSWORD`, `DASHBOARD_USER` | —, `admin` | Log masuk (HTTP Basic) untuk papan pemuka dan API; wajib dalam produksi apabila WhatsApp disambungkan |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | — | Sambungan WhatsApp Business Platform (Cloud API) |
| `WHATSAPP_VERIFY_TOKEN` | — | Token pengesahan webhook (rentetan rawak anda sendiri) |
| `WHATSAPP_API_VERSION` | `v23.0` | Versi Graph API |
| `AGENT` | — | `off` mematikan Ejen AI di pelayan walaupun kunci ditetapkan |
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
  import-crm.ts import senarai prospek CRM (HTML/JSON) → akaun + lead
  import-cli.ts arahan `npm run import`
  seal-cli.ts   arahan `npm run seal` (senarai prospek berkata laluan untuk Pages)
  agent-store.ts  Ejen AI: rancangan kitaran, simpan penemuan, terima/tolak
  whatsapp-store.ts  WhatsApp: senarai nombor, templat, mesej masuk/keluar, draf, konteks ejen
  orders-store.ts    katalog produk & pesanan (disahkan → urus niaga dimenangi)
  wa-live.ts         WhatsApp Business API: webhook, hantar, ejen di pelayan
  agent-runner.ts autopilot Ejen AI di pelayan (ANTHROPIC_API_KEY)
  analytics.ts  enjin KPI (ringkasan, jualan, pemasaran)
  crud.ts       urus niaga, lead (+penukaran), kempen, akaun
  schema.ts     skema + jenis Db mudah alih (node:sqlite / sql.js)
  routes.ts     penghala API bebas pengangkutan (Express & pelayar)
  app.ts        pembalut Express + penyajian binaan produksi
  tests/        ujian API (node:test)
shared/agent.ts         tetapan, normalisasi nilai, prompt & skema laporan ejen
shared/whatsapp.ts      jenis nombor, pautan wa.me, templat & ruang isi, tetapan ejen WhatsApp
shared/wa-agent.ts      ejen WhatsApp (Claude + alat katalog/pesanan/serah kepada staf)
shared/agent-runner.ts  satu kitaran ejen (Anthropic SDK, carian web) - pelayar & pelayan
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
| `GET/POST /api/reps`, `PATCH /api/reps/:id` | Pasukan jualan & kuota bulanan (`monthly_quota`) |
| `GET /api/agent/summary`, `GET/PATCH /api/agent/settings`, `GET /api/agent/plan` | Status, tetapan dan kerja seterusnya Ejen AI |
| `POST /api/agent/runs`, `GET /api/agent/runs` | Simpan hasil satu kitaran / log aktiviti |
| `GET /api/agent/findings`, `PATCH /api/agent/findings/:id`, `POST /api/agent/findings/decide` | Penemuan ejen; terima atau tolak (satu atau banyak) |
| `GET /api/wa/summary`, `GET /api/wa/contacts` | Ringkasan dan senarai nombor lead; penapis `stage` (`todo`/`sent`/`replied`), `type` (`mobile`/`landline`/`invalid`/`chat`), `wa`, `region`, `segment`, `search` |
| `GET/POST /api/wa/templates`, `PATCH/DELETE /api/wa/templates/:id`, `GET/PATCH /api/wa/settings` | Templat mesej dan nama penghantar |
| `GET/POST /api/wa/messages`, `PATCH /api/wa/leads/:id` | Log mesej / rekod mesej (lead baharu → dihubungi); tanda ada/tiada WhatsApp dan dibalas |
| `POST /api/wa/inbound`, `PATCH/DELETE /api/wa/messages/:id` | Mesej pelanggan (tampal atau webhook); draf ejen: sunting, hantar, buang |
| `GET/PATCH /api/wa/agent/settings`, `GET /api/wa/agent/context`, `POST /api/wa/agent/run` | Ejen WhatsApp: tetapan, konteks perbualan, jalankan di pelayan |
| `POST /api/wa/send`, `GET/POST /webhooks/whatsapp` | Business API: hantar mesej / webhook Meta (pengesahan dan mesej masuk bertandatangan) |
| `GET/POST /api/products`, `PATCH/DELETE /api/products/:id` | Katalog produk |
| `GET/POST /api/orders`, `GET/PATCH /api/orders/:id`, `GET /api/orders/summary` | Pesanan: status `pending`→`confirmed`→`processing`→`delivered` atau `cancelled` |
| `POST /api/agent/start` | Mulakan kitaran di pelayan (hanya jika `ANTHROPIC_API_KEY` ditetapkan) |
| `GET /api/meta` | Senarai jurujual, kempen dan tarikh rujukan |

Nilai enum dalam API (cth. `klang_valley`, `negotiation`) kekal dalam bahasa Inggeris; label
dipaparkan dalam bahasa pengguna oleh antara muka.

## Nota & pembangunan seterusnya

- Log masuk pelayan ialah satu kata laluan bersama (`DASHBOARD_PASSWORD`); akaun berasingan bagi setiap
  staf belum ada.
- Data sebenar boleh dimasukkan melalui `npm run import`, API CRUD atau terus ke jadual SQLite
  (skema di `server/schema.ts`). Integrasi CRM (cth. Salesforce/HubSpot) dan iklan (Google/LinkedIn Ads)
  boleh ditambah sebagai tugas penyegerakan yang menulis ke jadual yang sama.
