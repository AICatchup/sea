import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// One bounded, offline acquisition from Poly Haven's documented public API.
// Runtime rendering never calls the API. Powered by Poly Haven: https://polyhaven.com
const directory = resolve(import.meta.dirname, '../src/assets/marine');
const name = 'boulder_01';
const headers = { 'User-Agent': 'Sea-Tomari-Offline-Assets/1.0' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(url, expected) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && (bytes.length !== expected.size || createHash('md5').update(bytes).digest('hex') !== expected.md5)) {
    throw new Error(`Source integrity mismatch: ${url}`);
  }
  return bytes;
}
const api = `https://api.polyhaven.com/files/${name}`;
const metadata = JSON.parse((await read(api)).toString('utf8'));
const source = metadata.gltf['2k'].gltf;
const gltfBytes = await read(source.url, source);
const gltf = JSON.parse(gltfBytes.toString('utf8'));
const received = new Map();
const provenance = [{ url: source.url, bytes: gltfBytes.length, sha256: sha256(gltfBytes), md5: source.md5 }];
for (const [path, entry] of Object.entries(source.include)) {
  const bytes = await read(entry.url, entry);
  received.set(path, bytes);
  provenance.push({ path, url: entry.url, bytes: bytes.length, sha256: sha256(bytes), md5: entry.md5 });
}
const chunks = [];
let offset = 0;
const append = bytes => {
  const start = offset;
  const padding = (4 - bytes.length % 4) % 4;
  chunks.push(bytes, Buffer.alloc(padding));
  offset += bytes.length + padding;
  return start;
};
const bufferOffsets = gltf.buffers.map(buffer => append(received.get(buffer.uri)));
for (const view of gltf.bufferViews) {
  view.byteOffset = (view.byteOffset || 0) + bufferOffsets[view.buffer];
  view.buffer = 0;
}
for (const image of gltf.images) {
  const bytes = received.get(image.uri);
  image.bufferView = gltf.bufferViews.length;
  image.mimeType = 'image/jpeg';
  gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length });
  delete image.uri;
}
gltf.buffers = [{ byteLength: offset }];
gltf.asset.extras = { source: 'https://polyhaven.com/a/boulder_01', license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license' };
const json = Buffer.from(JSON.stringify(gltf));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const total = 12 + 8 + paddedJson.length + 8 + binary.length;
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(paddedJson.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, paddedJson, binHeader, binary]);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'boulder-01-2k.glb'), glb);
const triangles = gltf.meshes.reduce((count, mesh) => count + mesh.primitives.reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0), 0);
await writeFile(resolve(directory, 'provenance.json'), JSON.stringify({
  asset: name, source: `https://polyhaven.com/a/${name}`, api,
  license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license',
  acquired: new Date().toISOString(), textures: '2K JPEG albedo / OpenGL normal / ARM',
  triangles, sources: provenance, output: { file: 'boulder-01-2k.glb', bytes: glb.length, sha256: sha256(glb) },
}, null, 2) + '\n', 'utf8');
await writeFile(resolve(directory, 'LICENSE.txt'), 'Poly Haven boulder_01: CC0 1.0 Universal\nhttps://polyhaven.com/a/boulder_01\nhttps://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nPhotogrammetry mesh and 2K PBR maps acquired via the official public API.\nBundled locally with no runtime network dependency.\nPowered by Poly Haven: https://polyhaven.com\n', 'utf8');
console.log(JSON.stringify({ file: 'boulder-01-2k.glb', bytes: glb.length, triangles, sha256: sha256(glb) }));
