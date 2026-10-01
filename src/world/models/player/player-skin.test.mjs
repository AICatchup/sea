import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonBody } from '../../player-body.ts';
import { createPlayerSkin } from '../../player-skin.ts';

// CPU morphology/material checks; root multi-view render review is still required.
const body = new FirstPersonBody();
const mesh = body.group.children.find(x => x.isSkinnedMesh);
const geometry = mesh.geometry, p = geometry.getAttribute('position'), indices = geometry.index;
assert.equal(mesh.skeleton.bones.length, 47);
assert.equal(geometry.groups.length, 7);
assert.ok(indices.count / 3 <= 30000);
const welded = new Map(), ids = [];
for (let i = 0; i < p.count; i++) {
  const key = [p.getX(i), p.getY(i), p.getZ(i)].map(n => Math.round(n * 1e7)).join(',');
  if (!welded.has(key)) welded.set(key, welded.size);
  ids[i] = welded.get(key);
}
const edges = new Map(), orientation = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
let minArea = Infinity;
for (let i = 0; i < indices.count; i += 3) {
  const tri = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
  a.fromBufferAttribute(p, tri[0]); b.fromBufferAttribute(p, tri[1]); c.fromBufferAttribute(p, tri[2]);
  minArea = Math.min(minArea, b.sub(a).cross(c.sub(a)).length() * .5);
  for (let j = 0; j < 3; j++) {
    const u = ids[tri[j]], v = ids[tri[(j + 1) % 3]], key = u < v ? `${u}:${v}` : `${v}:${u}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
    orientation.set(key, (orientation.get(key) ?? 0) + (u < v ? 1 : -1));
  }
}
assert.ok(minArea > 1e-12, `no collapsed triangles: ${minArea}`);
// Multiple closed anatomy parts overlap intentionally; coincident edges can have
// four incidences. They must still pair in opposite directions, without open edges.
assert.equal([...edges.values()].filter(count => count % 2 !== 0).length, 0, 'no open welded shell edges');
assert.equal([...orientation.values()].filter(balance => balance !== 0).length, 0, 'closed shell edges pair with opposite winding');
const nailGroup = geometry.groups.find(g => g.materialIndex === 6);
const adjacency = new Map();
for (let i = nailGroup.start; i < nailGroup.start + nailGroup.count; i += 3) {
  const tri = [ids[indices.getX(i)], ids[indices.getX(i+1)], ids[indices.getX(i+2)]];
  for (const u of tri) { if (!adjacency.has(u)) adjacency.set(u, new Set()); for (const v of tri) adjacency.get(u).add(v); }
}
const visited = new Set(); let nailShells = 0;
for (const u of adjacency.keys()) if (!visited.has(u)) {
  nailShells++; const stack = [u]; visited.add(u);
  while (stack.length) for (const v of adjacency.get(stack.pop())) if (!visited.has(v)) { visited.add(v); stack.push(v); }
}
assert.equal(nailShells, 10, 'each digit has one closed keratin plate');
const skin = createPlayerSkin();
skin.setWetness(0); const dryRoughness = skin.material.roughness;
skin.setWetness(1); assert.ok(skin.material.roughness < dryRoughness); assert.equal(skin.material.clearcoat, .32);
skin.setWetness(NaN); assert.equal(skin.material.roughness, dryRoughness);
assert.equal(skin.material.userData.microdetail.tileMetres, 1/9);
assert.ok(skin.material.normalMap.image.data.some((n, i) => i % 4 === 0 && n !== 128));
skin.material.dispose(); skin.textures.forEach(t => t.dispose()); body.dispose();
console.log(JSON.stringify({ triangles: indices.count / 3, nailShells, openEdges: 0, overlappingEdges: [...edges.values()].filter(n => n > 2).length, minTriangleArea: minArea, wetness: 'bounded', pass: true }));
