import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// A single-file, double-clickable build: shader textures and surf are procedural.
const root = resolve(import.meta.dirname, '..');
let html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]) {
  const source = await readFile(resolve(root, 'dist', match[1]), 'utf8');
  html = html.replace(match[0], `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)]) {
  const cssPath = resolve(root, 'dist', match[1]);
  let source = await readFile(cssPath, 'utf8');
  for (const asset of [...source.matchAll(/url\((?:["']?)([^)"']+)(?:["']?)\)/g)]) {
    if (/^(data:|https?:)/.test(asset[1])) continue;
    const content = await readFile(resolve(dirname(cssPath), asset[1]));
    source = source.replace(asset[0], `url(data:font/woff2;base64,${content.toString('base64')})`);
  }
  html = html.replace(match[0], `<style>${source}</style>`);
}
const icon = await readFile(resolve(root, 'public/favicon.svg'), 'utf8');
html = html.replace(/href="\.\/favicon\.svg"/, `href="data:image/svg+xml,${encodeURIComponent(icon)}"`);
const licenseFiles = ['node_modules/three/LICENSE', 'public/fonts/NotoSansJP-OFL.txt', 'public/fonts/Outfit-OFL.txt'];
const licenses = await Promise.all(licenseFiles.map(async file => `${file}\n${await readFile(resolve(root, file), 'utf8')}`));
html = html.replace('</body>', `<script type="text/plain" id="third-party-licenses">${licenses.join('\n\n').replace(/<\/script/gi, '<\\/script')}</script></body>`);
await writeFile(resolve(root, 'dist/sea.html'), html, 'utf8');
console.log('Standalone ocean: dist/sea.html');
