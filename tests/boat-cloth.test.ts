import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boatClothUV, BOAT_CLOTH_PERIOD, loadBoatCloth } from '../src/world/models/boat-cloth.ts';
import { ModelBatch, ModelResources } from '../src/world/models/procedural.ts';
import { addBoatCushion, boatUpholsteryMaterial } from '../src/world/models/boat-upholstery.ts';

test('candidate mapping preserves rounded cushions, normals and sewn welt geometry', () => {
  const resources = new ModelResources();
  const build = (candidate: boolean) => {
    const batch = new ModelBatch(), fabric = boatUpholsteryMaterial(resources), piping = resources.material(new THREE.MeshStandardMaterial());
    fabric.userData.physicalBoatCloth = candidate;
    addBoatCushion(batch, fabric, piping, new THREE.Vector3(.48, .87, 1.11), .51, .105, .44, new THREE.Euler(Math.PI / 2 - .12, 0, 0), 5.28);
    return batch.finish(resources, 'test').children as THREE.Mesh[];
  };
  const original = build(false), candidate = build(true);
  assert.equal(original.length, candidate.length);
  for (let i = 0; i < original.length; i++) {
    for (const attribute of ['position', 'normal']) assert.deepEqual(candidate[i].geometry.getAttribute(attribute).array, original[i].geometry.getAttribute(attribute).array);
  }
  assert.notDeepEqual(candidate[0].geometry.getAttribute('uv').array, original[0].geometry.getAttribute('uv').array);
  assert.deepEqual(candidate[1].geometry.getAttribute('uv').array, original[1].geometry.getAttribute('uv').array);
  resources.dispose();
});

test('all six original box faces measure metres per physical repeat on every edge', () => {
  const g = new THREE.BoxGeometry(1.32, .075, .8, 16, 4, 10);
  const original = g.getAttribute('position').array.slice(); boatClothUV(g);
  assert.deepEqual(g.getAttribute('position').array, original);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv'), index = g.index!;
  assert.equal(g.groups.length, 6);
  for (const group of g.groups) for (let j = group.start; j < group.start + group.count; j += 3) {
    const ids = [index.getX(j), index.getX(j + 1), index.getX(j + 2)];
    for (let e = 0; e < 3; e++) {
      const a = ids[e], b = ids[(e + 1) % 3];
      const physical = new THREE.Vector3().fromBufferAttribute(p, a).distanceTo(new THREE.Vector3().fromBufferAttribute(p, b));
      const mapped = Math.hypot((uv.getX(a) - uv.getX(b)) * BOAT_CLOTH_PERIOD[0], (uv.getY(a) - uv.getY(b)) * BOAT_CLOTH_PERIOD[1]);
      assert.ok(Math.abs(physical - mapped) < 1e-7);
    }
  }
});

function fixture() {
  const resources = new ModelResources(), material = resources.material(new THREE.MeshStandardMaterial());
  const callbacks: { ok: () => void; fail: (e: unknown) => void }[] = [];
  const textures: THREE.Texture[] = [], disposed: number[] = [];
  const loader = { load(_url: string, ok?: (t: THREE.Texture) => void, _progress?: unknown, fail?: (e: unknown) => void) {
    const texture = new THREE.Texture(), id = textures.length;
    texture.addEventListener('dispose', () => { disposed[id] = (disposed[id] ?? 0) + 1; });
    textures.push(texture); callbacks.push({ ok: () => ok?.(texture), fail: e => fail?.(e) }); return texture;
  } };
  const result = loadBoatCloth(resources, material, loader as Pick<THREE.TextureLoader, 'load'>);
  return { resources, material, callbacks, textures, disposed, ...result };
}
test('maps owned immediately, activate together with identical transforms and correct color spaces', async () => {
  const f = fixture(); assert.equal(f.resources.textures.size, 3);
  f.callbacks[0].ok(); f.callbacks[1].ok(); await Promise.resolve(); assert.equal(f.material.map, null);
  f.callbacks[2].ok(); await f.ready; assert.equal(f.state.status, 'loaded');
  assert.equal(f.material.map, f.textures[0]); assert.equal(f.material.normalMap, f.textures[1]); assert.equal(f.material.roughnessMap, f.textures[2]);
  for (const t of f.textures) { t.updateMatrix(); assert.deepEqual(t.matrix.elements, f.textures[0].matrix.elements); }
  assert.equal(f.textures[0].colorSpace, THREE.SRGBColorSpace); assert.equal(f.textures[1].colorSpace, THREE.NoColorSpace); assert.equal(f.textures[2].colorSpace, THREE.NoColorSpace);
  f.resources.dispose(); assert.deepEqual(f.disposed, [1, 1, 1]);
});
test('dispose before callbacks settles ready and never resurrects material or ownership', async () => {
  const f = fixture(); f.resources.dispose(); await f.ready;
  f.callbacks.forEach(c => c.ok()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.status, 'disposed'); assert.equal(f.material.map, null); assert.equal(f.resources.textures.size, 0); assert.deepEqual(f.disposed, [1, 1, 1]);
});
test('missing map leaves fallback material intact and never claims loaded', async () => {
  const f = fixture(); const original = new THREE.Texture(); f.material.map = original;
  f.callbacks[0].ok(); f.callbacks[1].fail(new Error('missing normal')); f.callbacks[2].ok(); await f.ready;
  assert.equal(f.state.status, 'fallback'); assert.equal(f.material.map, original); f.resources.dispose();
});
