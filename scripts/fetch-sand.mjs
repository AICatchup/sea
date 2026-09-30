import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

// A bounded, pinned import of one CC0 photograph-based material. No catalogue crawl.
const asset = 'sand_02';
const directory = resolve(import.meta.dirname, '../src/assets/sand');
const manifestPath = resolve(directory, 'manifest.json');
const capBytes = 25_000_000;
const userAgent = 'TomariSandAssetImport/1.0 (local CC0 asset preparation)';
const infoURL = `https://api.polyhaven.com/info/${asset}`;
const filesURL = `https://api.polyhaven.com/files/${asset}`;
const pinned = [
  { role: 'albedo', map: 'Diffuse', suffix: 'diff', bytes: 4368947, md5: 'eca5f74e4fcce418dbd62804bda875dc', colorSpace: 'sRGB' },
  { role: 'normalGL', map: 'nor_gl', suffix: 'nor_gl', bytes: 5297796, md5: '77ccbb7448750bd46a9c59858ff35733', colorSpace: 'linear-data' },
  { role: 'arm', map: 'arm', suffix: 'arm', bytes: 2525395, md5: 'f09c4369f5573d3c11fcf65d8e1069da', colorSpace: 'linear-data' },
].map(file => ({
  ...file,
  name: `${asset}_${file.suffix}_2k.jpg`,
  url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${asset}/${asset}_${file.suffix}_2k.jpg`,
}));
let downloadedBytes = 0;

const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

async function request(url, maxBytes) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok || !response.body) throw new Error(`${response.status} fetching ${url}`);
  const finalURL = new URL(response.url);
  if (!['api.polyhaven.com', 'dl.polyhaven.org'].includes(finalURL.hostname)) throw new Error(`Unexpected source ${response.url}`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    downloadedBytes += value.byteLength;
    if (size > maxBytes || downloadedBytes > capBytes) {
      await reader.cancel();
      throw new Error(`Download byte limit exceeded for ${url}`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('Invalid JPEG signature/end marker');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), precision: bytes[offset + 2], components: bytes[offset + 7] };
    }
    offset += length;
  }
  throw new Error('JPEG frame dimensions not found');
}

function verify(file, bytes, expectedSHA256) {
  if (bytes.byteLength !== file.bytes) throw new Error(`Byte count changed: ${file.name}`);
  const md5 = hash('md5', bytes), sha256 = hash('sha256', bytes);
  if (md5 !== file.md5) throw new Error(`Original source MD5 mismatch: ${file.name}`);
  if (expectedSHA256 && sha256 !== expectedSHA256) throw new Error(`Manifest SHA-256 mismatch: ${file.name}`);
  const frame = jpegDimensions(bytes);
  if (frame.width !== 2048 || frame.height !== 2048 || frame.precision !== 8 || frame.components !== 3) throw new Error(`Unexpected texture frame: ${file.name} ${JSON.stringify(frame)}`);
  return { role: file.role, name: file.name, url: file.url, bytes: bytes.byteLength, sourceMD5: md5, sha256, width: frame.width, height: frame.height, colorSpace: file.colorSpace, headerHex: bytes.subarray(0, 16).toString('hex') };
}

if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.asset !== asset || manifest.files.length !== pinned.length) throw new Error('Unexpected manifest');
  for (const file of pinned) {
    const recorded = manifest.files.find(entry => entry.name === file.name);
    if (!recorded || recorded.url !== file.url || !/^[a-f0-9]{64}$/.test(recorded.sha256)) throw new Error(`Missing provenance: ${file.name}`);
    const checked = verify(file, await readFile(resolve(directory, file.name)), recorded.sha256);
    console.log(`Verified ${checked.name}: ${checked.width}x${checked.height}, ${checked.bytes} bytes, SHA-256 ${checked.sha256}`);
  }
  console.log(`Verified ${pinned.reduce((sum, file) => sum + file.bytes, 0)} original texture bytes; no network used.`);
} else {
  const info = JSON.parse((await request(infoURL, 64_000)).toString('utf8'));
  const files = JSON.parse((await request(filesURL, 512_000)).toString('utf8'));
  const selectedBytes = pinned.reduce((sum, file) => sum + file.bytes, 0);
  if (selectedBytes + downloadedBytes > capBytes) throw new Error('Selected texture set exceeds import cap');
  for (const file of pinned) {
    const source = files[file.map]?.['2k']?.jpg;
    if (!source || source.url !== file.url || source.size !== file.bytes || source.md5.toLowerCase() !== file.md5) throw new Error(`Official asset changed: ${file.name}`);
  }
  if (info.dimensions?.length !== 2 || !info.dimensions.every(value => Math.abs(value - 2140) < 1)) throw new Error('Physical source dimensions changed');
  await mkdir(directory, { recursive: true });
  const records = [];
  for (const file of pinned) {
    const path = resolve(directory, file.name);
    let bytes;
    try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes) {
      bytes = await request(file.url, file.bytes);
      verify(file, bytes);
      await writeFile(path, bytes, { flag: 'wx' });
    }
    const record = verify(file, bytes);
    records.push(record);
    console.log(`${basename(path)}: ${record.bytes} bytes, SHA-256 ${record.sha256}`);
  }
  const manifest = {
    schema: 1,
    asset,
    title: info.name,
    authors: Object.keys(info.authors ?? {}),
    source: 'Poly Haven',
    sourcePage: `https://polyhaven.com/a/${asset}`,
    license: 'CC0-1.0',
    licenseURL: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceLicenseURL: 'https://polyhaven.com/license',
    apiDocumentationURL: 'https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml',
    apiTermsURL: 'https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',
    endpoints: { info: infoURL, files: filesURL },
    acquiredAt: new Date().toISOString(),
    apiFilesHash: info.files_hash,
    dimensionsMillimeters: info.dimensions,
    tileSpanMeters: info.dimensions.map(value => Math.round(value) / 1000),
    resolution: '2k',
    channels: { arm: { R: 'ambient occlusion', G: 'roughness', B: 'metalness' }, normalGL: 'OpenGL tangent-space +Y' },
    processing: 'None. Original official 2K JPG download bytes, no crops, resizes, recoloring or recompression.',
    totalTextureBytes: selectedBytes,
    importCapBytes: capBytes,
    files: records,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Powered by Poly Haven: ${selectedBytes} original texture bytes; ${downloadedBytes} network bytes this run.`);
}
