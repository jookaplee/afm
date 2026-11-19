// Turns the standalone build into self-contained HTML (CSS and JS inlined):
//  - dist-standalone/afm-dashboard.html  page content for a claude.ai Artifact
//    (the Artifact host wraps it in its own <html>/<head>/<body>)
//  - dist-standalone/site/index.html     a complete page for any static host,
//    e.g. GitHub Pages (see .github/workflows/pages.yml)
//
// DATASET=<file.json|file.html> embeds a prospect list (see `npm run import`)
// as the starting data instead of the demo data. Keep personal data out of
// pages you publish publicly.
// DATASET_SEALED=<file> embeds a password-protected prospect list instead (see
// `npm run seal`): the page asks for the password and decrypts it in the browser.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-standalone';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const js = [...html.matchAll(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const css = [...html.matchAll(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]);
if (js.length !== 1) throw new Error(`expected one script bundle, found ${js.length}`);

const read = (p) => readFileSync(join(dir, p), 'utf8');
// "</script" inside the bundle would end the inline script early.
// A literal U+FFFD (used inside library strings) is written as its \uFFFD escape:
// the same string at runtime, and hosts that reject U+FFFD in pages accept it.
const script = read(js[0]).replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD');
const styles = css.map(read).join('\n').replace(/<\/style/gi, '<\\/style');
const description = 'Papan pemuka Jualan &amp; Pemasaran B2B JOOSONS.';

let datasetTag = '';
if (process.env.DATASET) {
  const raw = readFileSync(process.env.DATASET, 'utf8');
  let json = raw;
  if (raw.trimStart().startsWith('<')) {
    const m = /<script[^>]*\bid=["']lead-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw);
    const c = /<script[^>]*\bid=["']category-meta["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw);
    if (!m) throw new Error('DATASET has no <script id="lead-data"> block');
    json = JSON.stringify({ leads: JSON.parse(m[1]), categories: c ? JSON.parse(c[1]) : undefined });
  } else {
    json = JSON.stringify(JSON.parse(raw));
  }
  // "<" escaped so the JSON can never close the script element early.
  datasetTag = `<script id="crm-dataset" type="application/json">${json.replace(/</g, '\\u003c')}</script>\n`;
  console.log(`Embedding dataset from ${process.env.DATASET} (${(json.length / 1024).toFixed(0)} KB)`);
}
if (process.env.DATASET_SEALED) {
  if (datasetTag) throw new Error('Set DATASET or DATASET_SEALED, not both');
  const sealed = JSON.parse(readFileSync(process.env.DATASET_SEALED, 'utf8'));
  if (sealed?.v !== 1 || !sealed.ct || !sealed.iv || !sealed.salt) throw new Error('DATASET_SEALED is not a sealed dataset');
  datasetTag = `<script id="crm-dataset-sealed" type="application/json">${JSON.stringify(sealed)}</script>\n`;
  console.log(`Embedding password-protected dataset from ${process.env.DATASET_SEALED} (${(sealed.ct.length / 1024).toFixed(0)} KB)`);
}
// Pages with business contacts stay out of search engines.
const robots = datasetTag ? '<meta name="robots" content="noindex, nofollow">\n' : '';
const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23256abf'/%3E%3Crect x='7' y='17' width='4' height='8' rx='1.5' fill='%23fff'/%3E%3Crect x='14' y='12' width='4' height='13' rx='1.5' fill='%23fff'/%3E%3Crect x='21' y='7' width='4' height='18' rx='1.5' fill='%23fff'/%3E%3C/svg%3E";

const artifact = `<title>Papan Pemuka JOOSONS</title>
<meta name="color-scheme" content="light dark">
<meta name="description" content="${description}">
<style>${styles}</style>
<div id="root"></div>
${datasetTag}<script type="module">${script}</script>
`;
writeFileSync(join(dir, 'afm-dashboard.html'), artifact);

const site = `<!doctype html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${description}">
<meta name="apple-mobile-web-app-title" content="JOOSONS">
${robots}<title>JOOSONS · Jualan &amp; Pemasaran</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>${styles}</style>
</head>
<body>
<div id="root"></div>
${datasetTag}<script type="module">${script}</script>
</body>
</html>
`;
mkdirSync(join(dir, 'site'), { recursive: true });
writeFileSync(join(dir, 'site', 'index.html'), site);
writeFileSync(join(dir, 'site', '.nojekyll'), '');

const mb = (s) => (s.length / 1024 / 1024).toFixed(2);
console.log(`Wrote ${join(dir, 'afm-dashboard.html')} (${mb(artifact)} MB) and ${join(dir, 'site', 'index.html')} (${mb(site)} MB)`);
