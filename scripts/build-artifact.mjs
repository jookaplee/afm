// Turns the standalone build into self-contained HTML (CSS and JS inlined):
//  - dist-standalone/afm-dashboard.html  page content for a claude.ai Artifact
//    (the Artifact host wraps it in its own <html>/<head>/<body>)
//  - dist-standalone/site/index.html     a complete page for any static host,
//    e.g. GitHub Pages (see .github/workflows/pages.yml)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-standalone';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const js = [...html.matchAll(/<script[^>]+src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const css = [...html.matchAll(/<link[^>]+href="\.\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]);
if (js.length !== 1) throw new Error(`expected one script bundle, found ${js.length}`);

const read = (p) => readFileSync(join(dir, p), 'utf8');
// "</script" inside the bundle would end the inline script early.
const script = read(js[0]).replace(/<\/script/gi, '<\\/script');
const styles = css.map(read).join('\n').replace(/<\/style/gi, '<\\/style');
const description = 'Papan pemuka Jualan &amp; Pemasaran B2B JOOSONS (data dijana dalam pelayar).';
const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23256abf'/%3E%3Crect x='7' y='17' width='4' height='8' rx='1.5' fill='%23fff'/%3E%3Crect x='14' y='12' width='4' height='13' rx='1.5' fill='%23fff'/%3E%3Crect x='21' y='7' width='4' height='18' rx='1.5' fill='%23fff'/%3E%3C/svg%3E";

const artifact = `<title>Papan Pemuka JOOSONS</title>
<meta name="color-scheme" content="light dark">
<meta name="description" content="${description}">
<style>${styles}</style>
<div id="root"></div>
<script type="module">${script}</script>
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
<title>JOOSONS · Jualan &amp; Pemasaran</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>${styles}</style>
</head>
<body>
<div id="root"></div>
<script type="module">${script}</script>
</body>
</html>
`;
mkdirSync(join(dir, 'site'), { recursive: true });
writeFileSync(join(dir, 'site', 'index.html'), site);
writeFileSync(join(dir, 'site', '.nojekyll'), '');

const mb = (s) => (s.length / 1024 / 1024).toFixed(2);
console.log(`Wrote ${join(dir, 'afm-dashboard.html')} (${mb(artifact)} MB) and ${join(dir, 'site', 'index.html')} (${mb(site)} MB)`);
