import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const id = 'kloofendal_48d_partly_cloudy_puresky';
const destination = new URL('../src/assets/sky/', import.meta.url);
const headers = { 'User-Agent': 'SEA-Optics-AssetFetch/1.0 (CC0 HDRI, https://github.com/dj-thank/sea)' };
async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
const [info, files] = await Promise.all([
  json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`),
]);
const source = files.hdri['2k'].hdr;
const response = await fetch(source.url, { headers });
if (!response.ok) throw new Error(`${response.status} ${source.url}`);
const bytes = Buffer.from(await response.arrayBuffer());
const md5 = createHash('md5').update(bytes).digest('hex');
if (bytes.length !== source.size || md5 !== source.md5) throw new Error('Poly Haven size/hash mismatch.');
await mkdir(destination, { recursive: true });
await writeFile(new URL(`${id}_2k.hdr`, destination), bytes);
const receipt = {
  asset: id, title: info.name, authors: info.authors,
  sourcePage: `https://polyhaven.com/a/${id}`, sourceApi: `https://api.polyhaven.com/files/${id}`,
  download: source.url, license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license',
  bytes: bytes.length, md5, sha256: createHash('sha256').update(bytes).digest('hex'),
  retrievedAt: new Date().toISOString(),
  description: info.description,
  geography: 'Photographed at Kloofendal, South Africa. Used only as a sky/lighting source, not as Shikinejima location evidence.',
  edits: 'Unmodified Poly Haven 2K RGBE HDR bytes. Exposure and azimuth are runtime lighting parameters.',
};
await writeFile(new URL('provenance.json', destination), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`${id}: ${bytes.length} bytes; SHA256 ${receipt.sha256}`);
