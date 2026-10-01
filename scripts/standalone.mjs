import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// A single-file build, including local photogrammetry, PBR maps, HDR sky and fonts.
const root = resolve(import.meta.dirname, '..');
let html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]) {
  let source = await readFile(resolve(root, 'dist', match[1]), 'utf8');
  const assetURLs=new Set([...source.matchAll(/["']((?:\.\/)?assets\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp|svg))["']/g)].map(found=>found[1]));
  for(const assetURL of assetURLs){
    const bytes=await readFile(resolve(root,'dist',assetURL));
    const ext=assetURL.split('.').at(-1);
    const mime=ext==='svg'?'image/svg+xml':ext==='jpg'?'image/jpeg':`image/${ext}`;
    source=source.split(assetURL).join(`data:${mime};base64,${bytes.toString('base64')}`);
  }
  for(const filename of await readdir(resolve(root,'dist/assets'))){
    if(!/\.(?:png|jpe?g|webp|svg|hdr|exr|glb|bin)$/.test(filename)||!source.includes(filename))continue;
    const bytes=await readFile(resolve(root,'dist/assets',filename));
    const ext=filename.split('.').at(-1);
    const mime=ext==='svg'?'image/svg+xml':ext==='jpg'?'image/jpeg':ext==='glb'?'model/gltf-binary':ext==='hdr'||ext==='exr'||ext==='bin'?'application/octet-stream':`image/${ext}`;
    const dataURL=`data:${mime};base64,${bytes.toString('base64')}`;
    for(const url of [`./assets/${filename}`,`assets/${filename}`,filename])source=source.split(url).join(dataURL);
  }
  html = html.replace(match[0], () => `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)]) {
  const cssPath = resolve(root, 'dist', match[1]);
  let source = await readFile(cssPath, 'utf8');
  for (const asset of [...source.matchAll(/url\((?:["']?)([^)"']+)(?:["']?)\)/g)]) {
    if (/^(data:|https?:)/.test(asset[1])) continue;
    const content = await readFile(resolve(dirname(cssPath), asset[1]));
    source = source.replace(asset[0], `url(data:font/woff2;base64,${content.toString('base64')})`);
  }
  html = html.replace(match[0], () => `<style>${source}</style>`);
}
const icon = await readFile(resolve(root, 'public/favicon.svg'), 'utf8');
html = html.replace(/href="\.\/favicon\.svg"/, `href="data:image/svg+xml,${encodeURIComponent(icon)}"`);
const licenseFiles = ['node_modules/three/LICENSE', 'public/fonts/NotoSansJP-OFL.txt', 'public/fonts/Outfit-OFL.txt', 'src/assets/marine/LICENSE.txt', 'src/assets/sand/README.md', 'src/assets/niijima/README.md', 'src/assets/coast/README.md', 'src/assets/foliage/cc0/README.md', 'src/assets/foliage/cc0/canopy/LICENSE.txt', 'src/assets/foliage/cc0/canopy/README.md', 'THIRD_PARTY_NOTICES.md'];
const licenses = await Promise.all(licenseFiles.map(async file => `${file}\n${await readFile(resolve(root, file), 'utf8')}`));
licenses.push('HDR sky: CC0-1.0, Poly Haven / Greg Zaal and Jarod Guest. https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky https://polyhaven.com/license');
html = html.replace('</body>', () => `<script type="text/plain" id="third-party-licenses">${licenses.join('\n\n').replace(/<\/script/gi, '<\\/script')}</script></body>`);
await writeFile(resolve(root, 'dist/sea.html'), html, 'utf8');
console.log('Standalone ocean: dist/sea.html');
