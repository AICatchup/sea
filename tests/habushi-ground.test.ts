import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HabushiMainGate } from '../src/world/habushi-main-gate.ts';
import { HabushiGround } from '../src/world/habushi-ground.ts';
import { WorldCollision } from '../src/world/world-collision.ts';

test('photo-informed roadfront stays bounded, finite, owns resources and leaves gate axis unpainted', () => {
  const gate = new HabushiMainGate({ heightAt: () => 13.1545794 });
  const ground = new HabushiGround(gate);
  assert.equal(ground.group.position.y, gate.grading.level);
  assert.equal(ground.group.rotation.y, -Math.PI / 2);
  assert.ok(Math.abs(ground.grading.center.x - (gate.grading.center.x - 22)) < 1e-8);
  assert.equal(ground.grading.level, gate.grading.level);
  assert.equal(ground.diagnostics.drawCalls, 6);
  assert.ok(ground.diagnostics.triangles < 20000);
  assert.equal(ground.diagnostics.borrowedResources, 0);
  ground.group.traverse(o => { if (o instanceof THREE.Mesh) {
    assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));
    const bounds = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position as THREE.BufferAttribute);
    assert.ok(bounds.min.z >= 9.29 && bounds.max.z <= 35.01);
    assert.ok(bounds.min.x >= -30.01 && bounds.max.x <= 30.01);
    if (o.name.includes('crossing')) {
      const origin = ground.group.localToWorld(new THREE.Vector3(0, 1, 20));
      const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(o);
      assert.equal(hits.length, 0);
    }
  }});
  const collision = new WorldCollision();
  ground.solidsGroup.traverse(o => { if (o instanceof THREE.Mesh) collision.addMesh(o); });
  for (const [z, height] of [[20, .02], [10.5, .14], [12.06, .16], [11.9, .025]]) {
    const p = ground.group.localToWorld(new THREE.Vector3(0, height, z));
    const support = collision.supportHeightAt(p.x, p.z, p.y + .03, .32, .01);
    assert.ok(support !== null && Math.abs(support - p.y) < 1e-5, `supported surface ${z}`);
  }
  assert.ok(ground.diagnostics.maxStep <= .15);
  ground.dispose(); ground.dispose(); assert.equal(ground.diagnostics.disposed, true);
  assert.equal(ground.solidsGroup.children.length, 0);
  assert.equal(gate.diagnostics.disposed, false);
  collision.dispose(); gate.dispose();
});
