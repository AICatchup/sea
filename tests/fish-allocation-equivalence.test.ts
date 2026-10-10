import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';
import { advanceFishMotion, createFishMotion } from '../src/world/fish-motion.ts';
import { advanceFishMotion as legacy } from './fixtures/fish-motion-v62-legacy.ts';

const terrains = {
  deep: (_x: number, _z: number) => -4,
  shore: (_x: number, z: number) => z > 3.4 ? -0.2 : -4,
  ridge: (x: number, z: number) => Math.abs(x) < 0.04 && z > 0 ? -1 : -4,
  unavailable: (_x: number, z: number) => z > 3.4 ? NaN : -4,
};
for (const [name, terrain] of Object.entries(terrains)) test(`legacy paired full motion and ordered samples: ${name}`, () => {
  const initial = { x: 7, z: 0, y: -1.5, heading: Math.PI / 2 };
  const old = createFishMotion(initial), current = createFishMotion(initial);
  let blocked = 0;
  for (let frame = 1; frame <= 6000; frame++) {
    const time = frame / 60;
    const target = { x: Math.cos(time * 0.13) * 7, z: Math.sin(time * 0.13) * 3.5,
      y: -1.5 + Math.sin(time * 0.6) * 0.24, heading: Math.atan2(Math.cos(time * 0.13) * 0.5, -Math.sin(time * 0.13)) };
    const a: number[][] = [], b: number[][] = [];
    legacy(old, target, time, 0.23, (x, z) => { a.push([x, z]); return terrain(x, z); });
    advanceFishMotion(current, target, time, 0.23, (x, z) => { b.push([x, z]); return terrain(x, z); });
    assert.deepEqual(current, old, `frame ${frame}`); assert.deepEqual(b, a, `samples frame ${frame}`);
    if (current.blockedSteps) blocked++;
  }
  if (name === 'shore' || name === 'unavailable') assert.ok(blocked > 0);
});
test('legacy paired invalid targets, current ground, reversal, zero delta and jumps', () => {
  const initial = { x: 0, z: 0, y: -1.5, heading: 0 };
  const cases = [
    ...[NaN, Infinity, -Infinity, 1, -1, 0, 0.01].map(time => ({ time, target: initial, bottom: -4 })),
    ...[NaN, Infinity, -Infinity].flatMap(value => ['x', 'y', 'z', 'heading'].map(key =>
      ({ time: 0.01, target: { ...initial, [key]: value }, bottom: -4 }))),
    ...[NaN, Infinity, -Infinity, -4].map(bottom => ({ time: 0.01, target: { ...initial, x: 1 }, bottom })),
  ];
  for (const { time, target, bottom } of cases) {
    const old = createFishMotion(initial), current = createFishMotion(initial), a: number[][] = [], b: number[][] = [];
    legacy(old, target, time, 0.23, (x, z) => { a.push([x, z]); return bottom; });
    advanceFishMotion(current, target, time, 0.23, (x, z) => { b.push([x, z]); return bottom; });
    assert.deepEqual(current, old); assert.deepEqual(b, a);
    if (!Number.isFinite(bottom)) assert.equal(b.length, 1, 'unavailable current-ground path exercised');
  }
});

test('actual MarineLife legacy/current full fish state, matrices, clocks and ordered ground calls', async () => {
  // Vite is an in-process TS transformer only. No listener, GPU or browser.
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  try {
    const { MarineLife } = await vite.ssrLoadModule('/src/world/marine-life.ts');
    const { legacyMarineUpdate } = await vite.ssrLoadModule('/tests/fixtures/marine-update-v62-legacy.ts');
    for (const terrain of [(_x: number, _z: number) => -4, (_x: number, z: number) => z > -20.8 ? -0.2 : -4,
      (_x: number, z: number) => z > -20.8 ? NaN : -4]) {
      const a: number[][] = [], b: number[][] = [];
      const old = new MarineLife({ heightAt: (x: number, z: number) => { a.push([x, z]); return terrain(x, z); } });
      const current = new MarineLife({ heightAt: (x: number, z: number) => { b.push([x, z]); return terrain(x, z); } });
      await Promise.all([old.ready, current.ready]);
      assert.deepEqual(b, a); assert.equal(current.fish.length, 255);
      const camera = new THREE.Vector3(-36, -1, -23);
      const times = [...Array.from({ length: 900 }, (_, i) => (i + 1) / 60), 15, 14, 14, NaN, Infinity, 14.01, 20, 20.01];
      for (const time of times) {
        a.length = b.length = 0;
        legacyMarineUpdate.call(old, time, camera, false); current.update(time, camera, false);
        assert.deepEqual(current.fish.map((f: any) => f.motion), old.fish.map((f: any) => f.motion));
        assert.deepEqual(b, a, `ground calls time ${time}`);
        assert.deepEqual(current.animationTime, old.animationTime);
        for (const key of ['bodies', 'fins', 'tails'] as const) for (let i = 0; i < 3; i++) {
          assert.deepEqual(current[key][i].instanceMatrix.array, old[key][i].instanceMatrix.array);
          assert.equal(current[key][i].count, old[key][i].count);
          assert.equal(current[key][i].castShadow, old[key][i].castShadow);
        }
        assert.deepEqual(current.eyes.instanceMatrix.array, old.eyes.instanceMatrix.array);
      }
      old.dispose(); current.dispose();
    }
  } finally { await vite.close(); }
});

