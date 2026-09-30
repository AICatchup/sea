import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HabushiMainGate, HABUSHI_GATE_SPEC } from '../src/world/habushi-main-gate.ts';
import { geoToWorld } from '../src/world/contracts.ts';
import { WorldCollision } from '../src/world/world-collision.ts';

test('gate has an official-linked anchor, four physical apertures, finite stair scale and bounded resources', () => {
  const gate = new HabushiMainGate({ heightAt: () => 8 });
  const p = geoToWorld(HABUSHI_GATE_SPEC.lat, HABUSHI_GATE_SPEC.lon);
  assert.equal(gate.group.position.x, p.x); assert.equal(gate.group.position.z, p.z);
  assert.equal(gate.diagnostics.windowCount, 4); assert.ok(gate.diagnostics.maxStep <= .32);
  assert.ok(gate.diagnostics.drawCalls <= 10); assert.ok(gate.diagnostics.triangles < 20000);
  assert.equal(gate.diagnostics.borrowedResources, 0);
  // At each hole centre, a front-to-back ray must traverse the entire tower.
  for (const side of [-1, 1]) for (const y of [4.7, 8.7]) {
    const local = new THREE.Vector3(side * 5.4, y, 2); const origin = gate.group.localToWorld(local);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(gate.group.matrixWorld);
    const ray = new THREE.Raycaster(origin, direction, 0, 4);
    assert.equal(ray.intersectObjects(gate.solidsGroup.children, true).length, 0);
  }
  assert.ok(gate.bounds.getSize(new THREE.Vector3()).y >= 10.8);
  gate.dispose(); gate.dispose(); assert.equal(gate.diagnostics.disposed, true);
});

test('solid registration supports stairs and leaves the central passage open', () => {
  const gate = new HabushiMainGate({ heightAt: () => 8 }), collision = new WorldCollision();
  gate.solidsGroup.traverse(o => { if (o instanceof THREE.Mesh) collision.addMesh(o); });
  const point = (x: number, y: number, z: number) => gate.group.localToWorld(new THREE.Vector3(x, y, z));
  const from = point(0, .1, 10), to = point(0, .1, -5);
  assert.equal(collision.bodySegmentBlocked(from, to), false);
  for (let i = 0; i < 20; i++) {
    const expected = (i + 1) * .21 + .028, p = point(9, expected, 9 - i * .44);
    const support = collision.supportHeightAt(p.x, p.z, p.y, .32, .1);
    assert.ok(support !== null && Math.abs(support - p.y) < .04, `step ${i} support ${support}`);
  }
  collision.dispose(); gate.dispose();
});

test('DEM relief is exposed for bounded grading rather than silently buried', () => {
  const gate = new HabushiMainGate({ heightAt: (x, z) => 8 + Math.sin(x) + Math.cos(z) });
  assert.ok(gate.diagnostics.relief > 0); assert.ok(Number.isFinite(gate.grading.level));
  assert.ok(gate.grading.halfWidth + gate.grading.feather <= 25);
  gate.dispose();
  assert.throws(() => new HabushiMainGate({ heightAt: () => NaN }), /finite/);
});
