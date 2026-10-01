import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonBody } from '../src/world/player-body.ts';
import { createPlayerSkin } from '../src/world/player-skin.ts';
import type { AdventureState } from '../src/world/contracts.ts';

test('R136 closed anatomy has finite surface, nonzero triangles, normalized weights and stable action sweep', () => {
  const body = new FirstPersonBody();
  const mesh = body.group.children.find(child => child instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
  assert.ok(mesh); const g = mesh.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), weights = g.getAttribute('skinWeight');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    assert.ok([p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)].every(Number.isFinite));
    assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-6);
  }
  for (let i = 0; i < g.index!.count; i += 3) {
    a.fromBufferAttribute(p, g.index!.getX(i)); b.fromBufferAttribute(p, g.index!.getX(i + 1)); c.fromBufferAttribute(p, g.index!.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-24);
  }
  assert.equal(g.groups.length, 7); assert.ok(g.index!.count / 3 < 50000);
  const camera = new THREE.PerspectiveCamera(75, 1.6, .05, 100); camera.position.set(0, 1.64, 0);
  const state = { mode: 'walk', position: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 4, oxygen: 100, depth: 0,
    boatPosition: new THREE.Vector3(), boatYaw: 0, voyageTarget: null, voyageRemaining: 0, message: '' } as AdventureState;
  for (const action of ['idle', 'walk', 'run', 'swim', 'dive', 'climb', 'helm'] as const) {
    state.avatarAction = action;
    for (let j = 0; j < 36; j++) {
      state.gaitPhase = j * Math.PI / 9; state.immersion = action === 'swim' || action === 'dive' ? 1 : 0;
      body.update(state, camera, .08, j * .08);
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); mesh.applyBoneTransform(i, a); assert.ok([a.x, a.y, a.z].every(Number.isFinite));
      }
    }
  }
  body.dispose(); body.dispose();
});

test('R136 procedural skin owns distinct colour, relief and roughness maps with bounded wet highlights', () => {
  const skin = createPlayerSkin(); assert.equal(new Set(skin.textures).size, 3);
  assert.equal(skin.material.map!.colorSpace, THREE.SRGBColorSpace);
  skin.setWetness(1); assert.ok(skin.material.roughness >= .55); assert.ok(skin.material.clearcoat <= .2);
  skin.setWetness(NaN); assert.ok(Number.isFinite(skin.material.roughness));
  skin.textures.forEach(t => t.dispose()); skin.material.dispose();
});
