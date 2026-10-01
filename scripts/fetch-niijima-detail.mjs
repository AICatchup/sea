/** Local, reproducible GSI DEM5A coast snapshot. No remote photographic pixels are shipped. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'work', 'niijima-gsi-cache');
const origin = { lat: 34.3359808, lon: 139.2117451 };
const north = process.argv.includes('--north');
const south = process.argv.includes('--south');
const repaired=process.argv.includes('--repaired');
if(north&&south)throw new Error('Select exactly one source region');
const zoom = 15, bounds = north ? { west: 139.261, east: 139.300, north: 34.408, south: 34.365 } : south ? { west: 139.255, east: 139.284, north: 34.341, south: 34.323 } : { west: 139.261, east: 139.284, north: 34.367, south: 34.335 };
const receipts = [];
const sourceURL = 'https://www.niijima.com/kankou/niijima/active/2014-0313-0955-90.html';
const kmlURL = 'https://www.google.com/maps/d/kml?mid=1F3_7cwgm64HIY9m0lTqnXgPFKPt8ZK3V&forcekml=1';
const pixel = (lon, lat) => ({ x: (lon + 180) / 360 * 256 * 2 ** zoom,
  y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 256 * 2 ** zoom });
const geo = (x, y) => ({ lon: x / (256 * 2 ** zoom) * 360 - 180,
  lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (256 * 2 ** zoom)))) * 180 / Math.PI });
const world = (lon, lat) => ({ x: (lon - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180), z: (origin.lat - lat) * 111320 });

// GSI PNG is a lossless RGB signed centimetre integer; (128,0,0) denotes absent land data.
// Decode the PNG container using Node's built-in zlib so rebuilding needs no image library.
export function decodeElevationPNG(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  let width, height, channels; const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const size = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      if (body[8] !== 8 || !channels || body[12] !== 0) throw new Error('Unsupported elevation PNG encoding');
    }
    if (type === 'IDAT') chunks.push(body);
    offset += size + 12;
  }
  if (width !== 256 || height !== 256) throw new Error('GSI tile must have 256 x 256 cells');
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, decoded = new Uint8Array(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, aa = Math.abs(p - a), bb = Math.abs(p - b), cc = Math.abs(p - c); return aa <= bb && aa <= cc ? a : bb <= cc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[y * stride + x - channels] : 0;
      const b = y ? decoded[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      decoded[y * stride + x] = raw[y * (stride + 1) + 1 + x] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c));
    }
  }
  return Int16Array.from({ length: width * height }, (_, i) => {
    const j = i * channels, value = decoded[j] * 65536 + decoded[j + 1] * 256 + decoded[j + 2];
    return value === 8388608 ? -32768 : Math.round((value < 8388608 ? value : value - 16777216) / 10);
  });
}
async function get(url, relative) {
  const local = path.join(cache, relative); let body;
  try { body = await readFile(local); }
  catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) { receipts.push({ url, status: response.status }); return null; }
    body = Buffer.from(await response.arrayBuffer()); await mkdir(path.dirname(local), { recursive: true }); await writeFile(local, body);
  }
  receipts.push({ url, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length }); return body;
}
async function main() {
  const a = pixel(bounds.west, bounds.north), b = pixel(bounds.east, bounds.south);
  const px0 = Math.floor(a.x), py0 = Math.floor(a.y), width = Math.ceil(b.x) - px0 + 1, height = Math.ceil(b.y) - py0 + 1;
  const values = new Int16Array(width * height).fill(-32768), tiles = [];
  const sourceChoices={dem5a:0,dem5b:0,dem10b:0,missing:0};
  for (let y = Math.floor(py0 / 256); y <= Math.floor((py0 + height - 1) / 256); y++)
    for (let x = Math.floor(px0 / 256); x <= Math.floor((px0 + width - 1) / 256); x++) tiles.push({ x, y });
  for (let start = 0; start < tiles.length; start += 3) {
    const batch = await Promise.all(tiles.slice(start, start + 3).map(async ({ x, y }) => {
      const data=new Int16Array(65536).fill(-32768),choices=new Uint8Array(65536);
      for (const layer of ['dem5a_png', 'dem5b_png']) {
        const body = await get(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${zoom}/${x}/${y}.png`, `${layer}/${zoom}/${x}/${y}.png`);
        if (body) { const candidate=decodeElevationPNG(body);for(let i=0;i<data.length;i++)if(data[i]===-32768&&candidate[i]!==-32768){data[i]=candidate[i];choices[i]=layer==='dem5a_png'?1:2;} }
        if(!data.includes(-32768))break;
      }
      if (data.includes(-32768) && (north||south||repaired)) {
        const tx = Math.floor(x / 2), ty = Math.floor(y / 2);
        const body = await get(`https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/${tx}/${ty}.png`, `dem_png/14/${tx}/${ty}.png`);
        if (body) {
          const coarse = decodeElevationPNG(body);
          for(let i=0;i<data.length;i++)if(data[i]===-32768){
            const value=coarse[(Math.floor(i/256/2)+(y%2)*128)*256+Math.floor(i%256/2)+(x%2)*128];
            if(value!==-32768){data[i]=value;choices[i]=3;}
          }
        }
      }
      // NA is missing coverage, never a measured zero or a proof of sea. Retain
      // remaining holes; downstream bathymetry remains an explicit inference.
      return { x, y, data,choices };
    }));
    for (const { x: tx, y: ty, data,choices } of batch) for (let iy = 0; iy < 256; iy++) {
      const y = ty * 256 + iy - py0; if (y < 0 || y >= height) continue;
      for (let ix = 0; ix < 256; ix++) { const x = tx * 256 + ix - px0; if (x >= 0 && x < width) {
        const i=iy*256+ix;values[y*width+x]=data[i];sourceChoices[choices[i]===1?'dem5a':choices[i]===2?'dem5b':choices[i]===3?'dem10b':'missing']++;
      } }
    }
  }
  const kml = await get(kmlURL, 'municipal-surf-points.kml'); if (!kml) throw new Error('Official municipal map not available');
  const markers = [...kml.toString('utf8').matchAll(/<Placemark>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<coordinates>\s*([\d.]+),([\d.]+),[\s\S]*?<\/Placemark>/g)]
    .map(m => ({ name: m[1].trim(), lat: Number(m[3]), lon: Number(m[2]) })).filter(m => /堀切|シークレット/.test(m.name));
  if (markers.length !== 2) throw new Error('Official map point names changed; review before rebuilding');
  const nw = geo(px0, py0), se = geo(px0 + width - 1, py0 + height - 1), min = world(nw.lon, nw.lat), max = world(se.lon, se.lat);
  const encoded = Buffer.alloc(values.length * 2); values.forEach((value, i) => encoded.writeInt16LE(value, i * 2));
  const raster = { width, height, minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z, zoom, populated: [...values].filter(v => v !== -32768).length, elevations: encoded.toString('base64') };
  if (raster.populated < 10000) throw new Error('Insufficient GSI land coverage; existing source untouched');
  const provenance = { publisher: '国土地理院 / Geospatial Information Authority of Japan', credit: '国土地理院の標高タイルを加工して作成', capturedAt: new Date().toISOString(),
    docs: ['https://maps.gsi.go.jp/development/demtile.html', 'https://maps.gsi.go.jp/development/ichiran.html'], origin, sourceBounds: bounds,
    measured: 'GSI DEM5A/5B land macroshape, with DEM10B fallback where DEM5 coverage is unavailable; PNG display pixels around 4m are not 4m survey accuracy. Fetch date is not survey date.',
    sourceSelection:'Per-pixel valid DEM5A then DEM5B then DEM10B for extended or repaired snapshots; remaining NA means missing, not measured sea. Inferred bathymetry is separate.',sourceChoices,
    authored: 'Sub-DEM erosion, talus and strand microrelief are authored, and all bathymetry is inferred. No current safe coastal footpath or surveyed seabed is asserted.',
    locationSource: sourceURL, locationMap: kmlURL, markers, locationPrecision: 'Official visitor-map markers, not surveyed break or navigation waypoints.',
    visualReferences: ['https://niijima-info.jp/spot/2225/', 'https://niijima-info.jp/column/4724/', 'https://niijima-info.jp/cms24/wp-content/uploads/2026/06/niijimaA3MAP.pdf'],
    referenceUse: 'White layered pumice cliffs, pale talus and narrow strand; official photos used for observation only and not shipped.', tiles: [...new Map(receipts.map(receipt => [receipt.url, receipt])).values()].sort((a, b) => a.url.localeCompare(b.url)) };
  if (north) {
    provenance.originalSecretSnapshot = { sha256: createHash('sha256').update((await readFile(path.join(root, 'src/world/niijima-detail.generated.ts'), 'utf8')).replace(/\r\n/g, '\n')).digest('hex'), file: 'niijima-detail.generated.ts', commit: 'ac6ff1ed38e4956544e1d55a4eed14329411ef11', canonicalEncoding: 'UTF-8 with LF, matching the immutable Git source blob' };
    provenance.fullCoastSource = 'https://niijima-info.jp/course/2499/';
    provenance.fullCoastExtent = 'Northern DEM includes the complete Habushi east coast; 6.5km beach length is a tourism description, not a present-day continuous safe footpath.';
    provenance.mainGate = { lat: 34.3764393, lon: 139.2755897, source: 'https://niijima-info.jp/course/2499/', officialLink: 'https://maps.app.goo.gl/VbdFNE5ySqEVpcjKA', precision: 'Official linked Google place marker, not surveyed architectural footprint.' };
  }
  const prefix = north ? 'NIIJIMA_NORTH' : south ? 'NIIJIMA_SOUTH' : 'NIIJIMA_DETAIL';
  const region=north?'north':south?'south':'detail',suffix=repaired?'-repaired':'';
  await writeFile(path.join(root,`src/world/niijima-${region}${suffix}.generated.ts`), `// GENERATED by scripts/fetch-niijima-detail.mjs${north ? ' --north' : south ? ' --south' : ''}${repaired?' --repaired':''}. Land only.\nexport const ${prefix}_PROVENANCE = ${JSON.stringify(provenance, null, 2)} as const;\nexport const ${prefix}_RASTER = ${JSON.stringify(raster, null, 2)} as const;\n`, 'utf8');
  await writeFile(path.join(cache,`${region}${suffix}-source-receipts.json`), JSON.stringify({ provenance, raster: { ...raster, elevations: undefined } }, null, 2), 'utf8');
  console.log(JSON.stringify({ ...raster, elevations: undefined, markers, successfulSources: receipts.filter(r => r.sha256).length }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
