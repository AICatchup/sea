import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

// Official CC0 originals, acquired at build time only. No runtime external requests.
const directory = resolve(import.meta.dirname, '../src/assets/foliage/cc0');
const headers = { 'User-Agent': 'Sea-Tomari-Offline-Foliage/1.0' };
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
async function receive(url, expected) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && (bytes.length !== expected.size || digest(bytes, 'md5') !== expected.md5)) throw new Error(`Integrity mismatch: ${url}`);
  return bytes;
}
await mkdir(directory, { recursive: true });
await MeshoptSimplifier.ready;
async function acquire(id, kind) {
  const api = `https://api.polyhaven.com/files/${id}`;
  const metadata = JSON.parse((await receive(api)).toString('utf8'));
  const source = metadata.gltf['1k'].gltf;
  const original = await receive(source.url, source), gltf = JSON.parse(original.toString('utf8'));
  const provenance = [{ url: source.url, bytes: original.length, sha256: digest(original), md5: source.md5 }];
  const received = new Map();
  for (const [path, entry] of Object.entries(source.include)) {
    const bytes = await receive(entry.url, entry); received.set(path, bytes);
    provenance.push({ path, url: entry.url, bytes: bytes.length, sha256: digest(bytes), md5: entry.md5 });
  }
  const originalViews = gltf.bufferViews, originalAccessors = gltf.accessors;
  const buffers = gltf.buffers.map(buffer => received.get(buffer.uri));
  function values(index) {
    const a = originalAccessors[index], v = originalViews[a.bufferView], b = buffers[v.buffer];
    const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    if (v.byteStride || ![5123, 5125, 5126].includes(a.componentType)) throw new Error('Unsupported source layout');
    const Type = a.componentType === 5126 ? Float32Array : a.componentType === 5123 ? Uint16Array : Uint32Array;
    return new Type(new Type(b.buffer, b.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * dimensions));
  }
  const chunks = []; let offset = 0;
  const append = bytes => { const start = offset, pad = (4 - bytes.length % 4) % 4; chunks.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad; return start; };
  gltf.bufferViews = []; gltf.accessors = [];
  function accessor(array, type, target, bounds = false) {
    const dim = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const result = { bufferView: gltf.bufferViews.length, componentType: array instanceof Float32Array ? 5126 : 5125, count: array.length / dim, type };
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length, target });
    if (bounds) {
      result.min = Array(dim).fill(Infinity); result.max = Array(dim).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const axis = i % dim; result.min[axis] = Math.min(result.min[axis], array[i]); result.max[axis] = Math.max(result.max[axis], array[i]); }
    }
    gltf.accessors.push(result); return gltf.accessors.length - 1;
  }
  const sourceMeshes = gltf.meshes.slice(0, 3), newMeshes = [], nodes = [], reductions = [], bounds = [];
  for (let variant = 0; variant < sourceMeshes.length; variant++) {
    const sourceMesh = sourceMeshes[variant];
    const sourceBounds = new THREE.Box3();
    sourceMesh.primitives.forEach(p => {
      const a = originalAccessors[p.attributes.POSITION]; sourceBounds.expandByPoint(new THREE.Vector3(...a.min)); sourceBounds.expandByPoint(new THREE.Vector3(...a.max));
    });
    const sourceHeight = sourceBounds.max.y - sourceBounds.min.y, sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    bounds.push({ variant, nativeMin: sourceBounds.min.toArray(), nativeMax: sourceBounds.max.toArray() });
    const parts = sourceMesh.primitives.map(p => {
      const positions = values(p.attributes.POSITION), uv = values(p.attributes.TEXCOORD_0), indices = new Uint32Array(values(p.indices));
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] - (kind === 'pine' ? 0 : sourceCenter.x), z = positions[i + 2] - (kind === 'pine' ? 0 : sourceCenter.z);
        const t = Math.max(0, (positions[i + 1] - sourceBounds.min.y) / sourceHeight);
        if (kind === 'pine') {
          // Same continuous transform for trunk, branches and needles; keeps junctions joined.
          // Spread a real sapling's crown into an exposed, asymmetric coastal umbrella profile.
          const crown = Math.max(0, (t - .18) / .82), y = t < .18 ? t / .18 * 2.8 : 2.8 + Math.sqrt(crown) * (3.25 + variant * .18);
          const radial = (8.1 + crown * 4.1) / sourceHeight;
          const sweep = (variant - 1) * .35 + .65;
          positions[i] = x * radial * [1.08, .9, 1.2][variant] + sweep * t * t;
          positions[i + 1] = y + x / sourceHeight * [.2, -.35, .12][variant];
          positions[i + 2] = z * radial * [1, 1.14, .85][variant] + Math.sin(t * 2.1) * .16 * (variant - 1);
        } else {
          const scale = [1.25, 1.05, .85][variant] / sourceHeight;
          positions[i] = x * scale; positions[i + 1] = t * [1.25, 1.05, .85][variant]; positions[i + 2] = z * scale;
        }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals();
      const normals = new Float32Array(geometry.getAttribute('normal').array); geometry.dispose();
      return { material: p.material, positions, normals, uv, indices };
    });
    for (const level of ['near', 'mid']) {
      const primitives = [];
      for (const part of parts) {
        const attributes = new Float32Array(part.positions.length / 3 * 5);
        for (let i = 0; i < part.positions.length / 3; i++) attributes.set([...part.normals.subarray(i * 3, i * 3 + 3), ...part.uv.subarray(i * 2, i * 2 + 2)], i * 5);
        const target = kind === 'pine' ? (part.material === 0 ? (level === 'near' ? 540 : 240) : (level === 'near' ? 16000 : 2200)) : (level === 'near' ? 2300 : 440);
        const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(part.indices, part.positions, 3, attributes, 5, [.08, .08, .08, .35, .35], null, Math.min(target * 3, part.indices.length), .075, ['Permissive']);
        const [remap, count] = MeshoptSimplifier.compactMesh(indices);
        const compact = (array, stride) => {
          const result = new Float32Array(count * stride);
          for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < stride; j++) result[remap[i] * stride + j] = array[i * stride + j];
          return result;
        };
        primitives.push({ material: part.material, attributes: { POSITION: accessor(compact(part.positions, 3), 'VEC3', 34962, true), NORMAL: accessor(compact(part.normals, 3), 'VEC3', 34962), TEXCOORD_0: accessor(compact(part.uv, 2), 'VEC2', 34962) }, indices: accessor(indices, 'SCALAR', 34963) });
        reductions.push({ variant, level, material: part.material, sourceTriangles: part.indices.length / 3, target, triangles: indices.length / 3, normalizedError: error });
      }
      const name = `${kind}_${level}_${variant}`;
      nodes.push({ name, mesh: newMeshes.length }); newMeshes.push({ name, primitives });
    }
  }
  gltf.meshes = newMeshes; gltf.nodes = nodes; gltf.scenes = [{ nodes: nodes.map((_, i) => i) }]; gltf.scene = 0;
  for (const image of gltf.images) {
    const bytes = received.get(image.uri); image.bufferView = gltf.bufferViews.length; image.mimeType = 'image/jpeg';
    gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length }); delete image.uri;
  }
  gltf.buffers = [{ byteLength: offset }];
  gltf.asset.extras = { source: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0', profile: kind === 'pine' ? 'Author-shaped coastal crown from real 3D needles; not a surveyed Japanese black pine' : 'True 3D shrub with individual leaves', reductions };
  const json = Buffer.from(JSON.stringify(gltf)), paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), binary = Buffer.concat(chunks);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + paddedJson.length + binary.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(paddedJson.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binary.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, jh, paddedJson, bh, binary]), file = `${kind}-lod-1k.glb`;
  await writeFile(resolve(directory, file), glb);
  const outputBounds = newMeshes.map(mesh => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    mesh.primitives.forEach(p => { const a = gltf.accessors[p.attributes.POSITION]; for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], a.min[axis]); max[axis] = Math.max(max[axis], a.max[axis]); } });
    return { name: mesh.name, min, max, units: 'metres' };
  });
  const receipt = { asset: id, source: `https://polyhaven.com/a/${id}`, api, license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license', acquired: new Date().toISOString(), originalBounds: bounds, outputBounds, reductions, sources: provenance, output: { file, bytes: glb.length, sha256: digest(glb) } };
  console.log(JSON.stringify({ output: receipt.output, reductions })); return receipt;
}
let previous = []; try { previous = JSON.parse(await readFile(resolve(directory, 'provenance.json'), 'utf8')).assets; } catch { /* First acquisition. */ }
const receipts = [];
for (const [id, kind] of [['pine_sapling_small', 'pine'], ['shrub_02', 'shrub']]) {
  const cached = previous?.find(r => r.asset === id);
  if (cached && !process.argv.includes('--refresh')) { const bytes = await readFile(resolve(directory, cached.output.file)).catch(() => null); if (bytes && digest(bytes) === cached.output.sha256) { receipts.push(cached); continue; } }
  receipts.push(await acquire(id, kind));
}
const totalBytes = receipts.reduce((sum, r) => sum + r.output.bytes, 0);
if (totalBytes > 40_000_000) throw new Error(`Foliage exceeds 40MB: ${totalBytes}`);
await writeFile(resolve(directory, 'provenance.json'), JSON.stringify({ assets: receipts, totalBytes, textureProcessing: 'Original 1K JPEG diffuse/OpenGL normal/ARM bytes retained; indexed UV/normal-aware mesh reduction' }, null, 2) + '\n', 'utf8');
await writeFile(resolve(directory, 'LICENSE.txt'), 'Poly Haven pine_sapling_small and shrub_02: CC0 1.0 Universal\nhttps://polyhaven.com/a/pine_sapling_small\nhttps://polyhaven.com/a/shrub_02\nhttps://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nPowered by Poly Haven: https://polyhaven.com\nOffline originals verified against API sizes and MD5, with SHA256 recorded.\nMeshes reduced with meshoptimizer. Coastal pine crown shape is an authored adaptation; no Google photograph pixels are included.\n', 'utf8');
