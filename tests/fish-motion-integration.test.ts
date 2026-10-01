import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';
import { fishSegmentClear } from '../src/world/fish-motion.ts';

test('actual MarineLife matrices retain continuous valid poses, and disposal is inert', async () => {
  // SSR module transformation only: no HTTP listener, asset downloads or GPU.
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
  try {
    const { MarineLife } = await vite.ssrLoadModule('/src/world/marine-life.ts');
    const height = (_x: number, z: number) => z > -20.8 ? -0.2 : -4;
    const marine = new MarineLife({ heightAt: height });
    await marine.ready;
    const camera = new THREE.Vector3(-36, -1, -23), matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    let previous = marine.inspectFishMotion(), blocked = 0;
    assert.equal(previous.length, 255); // Authored counts preserved.
    for (let frame = 1; frame <= 40 * 60; frame++) {
      marine.update(frame / 60, camera, false);
      const current = marine.inspectFishMotion();
      for (let i = 0; i < current.length; i++) {
        const pose = current[i], old = previous[i];
        assert.ok(Math.hypot(pose.x - old.x, pose.z - old.z) <= 1.6 / 60 + 1e-8);
        assert.ok(fishSegmentClear(old, pose, pose.size * 0.28 + 0.09, height));
        if (pose.blockedSteps) blocked++;
        if (frame % 60 === 0) {
          const body = marine.group.children.find((child: THREE.Object3D) => child.name === ['wrasse inspired school', 'small coastal damselfish inspired school', 'silver coastal shoal'][pose.species]) as THREE.InstancedMesh;
          body.getMatrixAt(pose.index, matrix); position.setFromMatrixPosition(matrix);
          assert.ok(position.distanceTo(new THREE.Vector3(pose.x, pose.y, pose.z)) < 0.00002, 'instance matrix uses retained swimming pose');
        }
      }
      previous = current;
    }
    assert.ok(blocked > 0, 'shoreline obstruction exercised');
    const snapshot = marine.inspectFishMotion(1); snapshot[0].x = 999;
    assert.notEqual(marine.inspectFishMotion(1)[0].x, 999, 'QA returns detached copies');
    marine.dispose(); marine.update(41, camera, false); marine.dispose();
    assert.equal(marine.inspectFishMotion().length, 0); assert.equal(marine.group.children.length, 0);
  } finally { await vite.close(); }
});
