// Turns the standalone build into one self-contained HTML page (CSS and JS
// inlined) that can be hosted anywhere static, e.g. as a claude.ai Artifact.
// Output: dist-standalone/afm-dashboard.html
import { readFileSync, writeFileSync } from 'node:fs';
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

const page = `<title>Papan Pemuka AFM</title>
<meta name="color-scheme" content="light dark">
<meta name="description" content="Papan pemuka Jualan &amp; Pemasaran B2B (demo kendiri, data dijana dalam pelayar).">
<style>${styles}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(dir, 'afm-dashboard.html'), page);
console.log(`Wrote ${join(dir, 'afm-dashboard.html')} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
