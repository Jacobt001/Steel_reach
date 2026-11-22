// One source, two single-file outputs. `home` adds PWA bits; `artifact` must stay free of them.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeIcon } from './tools/make-icons.mjs';

const BG = '#121815';
const HOME_HEAD = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Steelreach">',
  '<link rel="apple-touch-icon" href="icon-180.png">',
].join('\n');

const template = readFileSync('src/index.html', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

for (const target of ['artifact', 'home']) {
  const out = await build({
    entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, write: false,
    define: { __TARGET__: JSON.stringify(target) },
  });
  // An inline <script> ends at the first "</script", so any occurrence inside the bundle must be escaped.
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const head = target === 'home' ? HOME_HEAD : '';
  // Replacer functions, not replacement strings: minified JS can contain `$&` / `$'` which String.replace would expand.
  const html = template
    .replace('<!--HEAD-->', () => head)
    .replace('<!--CSS-->', () => css)
    .replace('<!--JS-->', () => js);
  const dir = `dist/${target}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, html);
  if (target === 'home') {
    writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify({
      name: 'Steelreach', short_name: 'Steelreach', display: 'standalone', orientation: 'portrait',
      start_url: './', background_color: BG, theme_color: BG,
      icons: [180, 512].map(s => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
    }, null, 2));
    for (const s of [180, 512]) writeFileSync(`${dir}/icon-${s}.png`, makeIcon(s));
  }
}
