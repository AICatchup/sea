/**
 * Rebuild the offline elevation snapshot from public GSI elevation tiles.
 * Official documentation: https://maps.gsi.go.jp/development/demtile.html
 * Layers: https://maps.gsi.go.jp/development/ichiran.html
 * GSI's `e` cells are missing elevation, not measured bathymetry.
 * Run: node scripts/fetch-geodata.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'work', 'gsi-dem-cache');
const origin = { lat: 34.3359808, lon: 139.2117451 };
const METRES_PER_DEGREE = 111320;
const specs = [
  { id: 'shikine', name: '式根島', zoom: 14, layers: ['dem'], west: 139.190, east: 139.239, south: 34.305, north: 34.345 },
  { id: 'tomari', name: '泊海水浴場', zoom: 15, layers: ['dem5a', 'dem5b'], west: 139.2068, east: 139.2166, south: 34.3328, north: 34.3402 },
  { id: 'niijima', name: '新島', zoom: 12, layers: ['dem'], west: 139.235, east: 139.322, south: 34.290, north: 34.442 },
  { id: 'kozushima', name: '神津島', zoom: 12, layers: ['dem'], west: 139.090, east: 139.195, south: 34.155, north: 34.255 },
];

function pixel(lon, lat, zoom) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(lat * Math.PI / 180);
  return { x: (lon + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}
function geo(px, py, zoom) {
  const scale = 256 * 2 ** zoom;
  return { lon: px / scale * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * py / scale))) * 180 / Math.PI };
}
function world(lon, lat) {
  return { x: (lon - origin.lon) * METRES_PER_DEGREE * Math.cos(origin.lat * Math.PI / 180), z: (origin.lat - lat) * METRES_PER_DEGREE };
}
const receipts = [];
async function getTile(layer, zoom, x, y) {
  const relative = `${layer}/${zoom}/${x}/${y}.txt`;
  const local = path.join(cache, ...relative.split('/'));
  let body;
  try { body = await readFile(local, 'utf8'); }
  catch {
    const response = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${relative}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    body = await response.text();
    if (!/^[\de.,\-\r\n]+$/.test(body)) throw new Error(`Unexpected tile content: ${relative}`);
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, body, 'utf8');
  }
  const entries = body.trim().split(/[\n,]/);
  if (entries.length !== 256 * 256) throw new Error(`Invalid cell count in ${relative}: ${entries.length}`);
  const values = Int16Array.from(entries, value => value.trim() === 'e' ? -32768 : Math.round(Number(value) * 10));
  receipts.push({ url: `https://cyberjapandata.gsi.go.jp/xyz/${relative}`, sha256: createHash('sha256').update(body).digest('hex') });
  return values;
}

async function makeRaster(spec) {
  const a = pixel(spec.west, spec.north, spec.zoom), b = pixel(spec.east, spec.south, spec.zoom);
  const px0 = Math.floor(a.x), py0 = Math.floor(a.y), width = Math.ceil(b.x) - px0 + 1, height = Math.ceil(b.y) - py0 + 1;
  const output = new Int16Array(width * height).fill(-32768);
  const tiles = [];
  for (let ty = Math.floor(py0 / 256); ty <= Math.floor((py0 + height - 1) / 256); ty++) {
    for (let tx = Math.floor(px0 / 256); tx <= Math.floor((px0 + width - 1) / 256); tx++) tiles.push({ tx, ty });
  }
  let populated = 0;
  // At most four simultaneous requests, to keep the public service load bounded.
  for (let start = 0; start < tiles.length; start += 4) {
    const batch = await Promise.all(tiles.slice(start, start + 4).map(async ({ tx, ty }) => {
      let data = null;
      for (const layer of spec.layers) { data = await getTile(layer, spec.zoom, tx, ty); if (data) break; }
      return { tx, ty, data };
    }));
    for (const { tx, ty, data } of batch) {
      if (!data) continue;
      for (let iy = 0; iy < 256; iy++) {
        const y = ty * 256 + iy - py0;
        if (y < 0 || y >= height) continue;
        for (let ix = 0; ix < 256; ix++) {
          const x = tx * 256 + ix - px0;
          if (x < 0 || x >= width) continue;
          const v = data[iy * 256 + ix];
          output[y * width + x] = v;
          if (v !== -32768) populated++;
        }
      }
    }
  }
  if (!populated) { console.log(`${spec.id}: no published elevation coverage`); return null; }
  const nw = geo(px0, py0, spec.zoom), se = geo(px0 + width - 1, py0 + height - 1, spec.zoom);
  const minimum = world(nw.lon, nw.lat), maximum = world(se.lon, se.lat);
  const buf = Buffer.alloc(output.length * 2);
  for (let i = 0; i < output.length; i++) buf.writeInt16LE(output[i], i * 2);
  const encoded = buf.toString('base64');
  console.log(`${spec.id}: ${width} x ${height}, ${populated} known elevations, world bounds ${JSON.stringify({ minX: minimum.x, minZ: minimum.z, maxX: maximum.x, maxZ: maximum.z })}`);
  return { id: spec.id, name: spec.name, width, height, zoom: spec.zoom, minX: minimum.x, minZ: minimum.z, maxX: maximum.x, maxZ: maximum.z, west: nw.lon, east: se.lon, north: nw.lat, south: se.lat, populated, encoding: 'int16le-decimetres-base64-nodata=-32768', elevations: encoded };
}
await mkdir(cache, { recursive: true });
const rasters = [];
for (const spec of specs) { const raster = await makeRaster(spec); if (raster) rasters.push(raster); }
if (!rasters.find(r => r.id === 'shikine')) throw new Error('No Shikinejima DEM coverage. Existing snapshot has not been replaced.');
receipts.sort((a, b) => a.url.localeCompare(b.url));
const meta = { publisher: '国土地理院 / Geospatial Information Authority of Japan', credit: '国土地理院の標高タイルを加工して作成', docs: ['https://maps.gsi.go.jp/development/demtile.html', 'https://maps.gsi.go.jp/development/ichiran.html'], capturedAt: new Date().toISOString(), origin, tileUpdatePolicy: 'The official catalogue states that TXT tile updates stopped in October 2024. The fetch timestamp is not the terrain survey date.', bathymetry: 'Inferred from coastal distance, with an artistic sandy Tomari cove profile. No surveyed seabed or tidal datum is provided.', shoreline: 'Estimated from valid elevation cells; the beach profile is refined artistically around the published DEM.', tiles: receipts };
const source = `// GENERATED by scripts/fetch-geodata.mjs. GSI land elevations only; see GEODATA_PROVENANCE.\nexport const GEODATA_PROVENANCE = ${JSON.stringify(meta, null, 2)} as const;\nexport const ELEVATION_RASTERS = ${JSON.stringify(rasters, null, 2)} as const;\n`;
await mkdir(path.join(root, 'src', 'world'), { recursive: true });
await writeFile(path.join(root, 'src', 'world', 'geodata.generated.ts'), source, 'utf8');
await writeFile(path.join(cache, 'source-receipts.json'), JSON.stringify({ meta, rasters: rasters.map(({ elevations, ...rest }) => rest), tiles: receipts }, null, 2), 'utf8');
console.log(`Saved offline snapshot. ${receipts.length} successful tile receipts.`);
