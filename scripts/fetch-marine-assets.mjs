import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

// Bounded, offline acquisitions from Poly Haven's documented public API.
// Runtime rendering never calls the API. Powered by Poly Haven: https://polyhaven.com
const directory = resolve(import.meta.dirname, '../src/assets/marine');
const names = ['boulder_01', 'namaqualand_boulder_02', 'namaqualand_boulder_03', 'coast_rocks_01', 'coast_rocks_03'];
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
await MeshoptSimplifier.ready;
async function pack(name) {
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
const originalViews = gltf.bufferViews, originalAccessors = gltf.accessors;
const sourceBuffers = gltf.buffers.map(buffer => received.get(buffer.uri));
function array(index) {
  const accessor = originalAccessors[index], view = originalViews[accessor.bufferView];
  const bytes = sourceBuffers[view.buffer], offset = bytes.byteOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  if (view.byteStride || ![5123, 5125, 5126].includes(accessor.componentType)) throw new Error('Unexpected source accessor layout');
  const Type = accessor.componentType === 5126 ? Float32Array : accessor.componentType === 5123 ? Uint16Array : Uint32Array;
  const values = new Type(bytes.buffer, offset, accessor.count * dimensions);
  return Type === Uint16Array ? new Uint32Array(values) : values;
}
gltf.bufferViews = []; gltf.accessors = [];
const simplification = [];
function accessor(values, type, target, bounds = false) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
  const result = { bufferView: gltf.bufferViews.length, componentType: values instanceof Float32Array ? 5126 : 5125, count: values.length / dimensions, type };
  gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length, target });
  if (bounds) {
    result.min = Array(dimensions).fill(Infinity); result.max = Array(dimensions).fill(-Infinity);
    for (let i = 0; i < values.length; i++) { const axis = i % dimensions; result.min[axis] = Math.min(result.min[axis], values[i]); result.max[axis] = Math.max(result.max[axis], values[i]); }
  }
  gltf.accessors.push(result); return gltf.accessors.length - 1;
}
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  const originalIndices = array(primitive.indices);
  const positions = array(primitive.attributes.POSITION), normals = array(primitive.attributes.NORMAL), uv = array(primitive.attributes.TEXCOORD_0);
  const attributes = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) attributes.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]], i * 5);
  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(originalIndices, positions, 3, attributes, 5, [0.1, 0.1, 0.1, 0.4, 0.4], null, Math.min(18000 * 3, originalIndices.length), 0.012, ['Permissive']);
  const [remap, count] = MeshoptSimplifier.compactMesh(indices);
  const compact = (source, stride) => {
    const result = new Float32Array(count * stride);
    for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < stride; j++) result[remap[i] * stride + j] = source[i * stride + j];
    return result;
  };
  primitive.attributes = { POSITION: accessor(compact(positions, 3), 'VEC3', 34962, true), NORMAL: accessor(compact(normals, 3), 'VEC3', 34962), TEXCOORD_0: accessor(compact(uv, 2), 'VEC2', 34962) };
  primitive.indices = accessor(indices, 'SCALAR', 34963);
  simplification.push({ sourceTriangles: originalIndices.length / 3, triangles: indices.length / 3, normalizedError: error, method: 'Meshopt attribute-aware UV + normal preservation', targetTriangles: 18000 });
}
for (const image of gltf.images) {
  const bytes = received.get(image.uri);
  image.bufferView = gltf.bufferViews.length;
  image.mimeType = 'image/jpeg';
  gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length });
  delete image.uri;
}
gltf.buffers = [{ byteLength: offset }];
gltf.asset.extras = { source: `https://polyhaven.com/a/${name}`, license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license', simplification };
const json = Buffer.from(JSON.stringify(gltf));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const total = 12 + 8 + paddedJson.length + 8 + binary.length;
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(paddedJson.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, paddedJson, binHeader, binary]);
await mkdir(directory, { recursive: true });
const file = `${name.replaceAll('_', '-')}-2k.glb`;
await writeFile(resolve(directory, file), glb);
const triangles = gltf.meshes.reduce((count, mesh) => count + mesh.primitives.reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0), 0);
const receipt = {
  asset: name, source: `https://polyhaven.com/a/${name}`, api,
  license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license',
  acquired: new Date().toISOString(), textures: '2K JPEG albedo / OpenGL normal / ARM',
  triangles, simplification, sources: provenance, output: { file, bytes: glb.length, sha256: sha256(glb) },
};
console.log(JSON.stringify(receipt.output)); return receipt;
}
const receipts = [];
let previous = [];
try { previous = JSON.parse(await readFile(resolve(directory, 'provenance.json'), 'utf8')).assets ?? []; } catch { /* First acquisition. */ }
for (const name of names) {
  const cached = previous.find(receipt => receipt.asset === name && receipt.simplification?.every(level => level.targetTriangles === 18000));
  if (cached && !process.argv.includes('--refresh')) {
    try {
      const bytes = await readFile(resolve(directory, cached.output.file));
      if (sha256(bytes) === cached.output.sha256) { receipts.push(cached); continue; }
    } catch { /* Missing or changed asset is acquired and verified again. */ }
  }
  receipts.push(await pack(name));
}
await writeFile(resolve(directory, 'provenance.json'), JSON.stringify({ assets: receipts, totalBytes: receipts.reduce((sum, receipt) => sum + receipt.output.bytes, 0), textureProcessing: 'Original 2K JPEGs retained without resampling or recompression' }, null, 2) + '\n', 'utf8');
await writeFile(resolve(directory, 'LICENSE.txt'), names.map(name => `Poly Haven ${name}: CC0 1.0 Universal\nhttps://polyhaven.com/a/${name}`).join('\n\n') + '\n\nhttps://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nPhotogrammetry meshes and original 2K PBR maps from the official public API.\nMeshes reduced with attribute-aware meshoptimizer; UVs, normals and maps preserved.\nBundled locally with no runtime network dependency.\nPowered by Poly Haven: https://polyhaven.com\n', 'utf8');
