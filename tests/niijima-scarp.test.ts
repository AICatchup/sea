import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NiijimaDEM, NiijimaSurface } from '../src/world/niijima-detail.ts';
import { NIIJIMA_SCARP_BOUNDS as bounds } from '../src/world/niijima-scarp.ts';

const legacy = new NiijimaDEM(), candidate = new NiijimaDEM(undefined, { scarp: true });
test('scarp defaults off and leaves source elevations and low strand invariant', () => {
  assert.equal(legacy.scarp, false);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../src/world/niijima-detail.generated.ts', import.meta.url))).digest('hex'),
    '2f0f63701f41a955a7f62e6f095d023b77b0c8afd6fd017772dfe09a11bd403a');
  assert.deepEqual(candidate.heights, legacy.heights);
  assert.deepEqual(candidate.shore, legacy.shore);
  let low = 0;
  for (let z = -1600; z <= -350; z += 10) for (let x = 5650; x <= 6010; x += 5) {
    const actual = candidate.refinedHeightAt(x, z);
    assert.ok(Number.isFinite(actual));
    assert.equal(candidate.heightAt(x, z), legacy.heightAt(x, z));
    const outside = x <= bounds.minX || x >= bounds.maxX || z <= bounds.minZ || z >= bounds.maxZ;
    if (outside || legacy.heightAt(x, z) <= 3 || legacy.shoreAt(x, z) <= 12) {
      assert.equal(actual, legacy.refinedHeightAt(x, z));
      low++;
    }
  }
  assert.ok(low > 3000);
});
test('one continuous face steepens inland slope and stays within bounded displacement', () => {
  const oldSlope = (legacy.refinedHeightAt(5858, -924) - legacy.refinedHeightAt(5870, -924)) / 12;
  const newSlope = (candidate.refinedHeightAt(5858, -924) - candidate.refinedHeightAt(5870, -924)) / 12;
  assert.ok(newSlope > 3 && newSlope > oldSlope * 4);
  let maximum = 0;
  for (let z = -1500; z <= -450; z += 2) for (let x = 5720; x <= 5970; x += 2) {
    maximum = Math.max(maximum, Math.abs(candidate.refinedHeightAt(x, z) - legacy.refinedHeightAt(x, z)));
  }
  assert.ok(maximum > 40 && maximum < 60);
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [-1499, -1200, -924, -451]) {
    assert.equal(candidate.refinedHeightAt(x, z), legacy.refinedHeightAt(x, z));
    assert.ok(Math.abs(candidate.refinedHeightAt(x + (x === bounds.minX ? .01 : -.01), z) - legacy.refinedHeightAt(x, z)) < .02);
  }
  for (const z of [bounds.minZ, bounds.maxZ]) for (const x of [5750, 5800, 5860, 5950]) {
    assert.equal(candidate.refinedHeightAt(x, z), legacy.refinedHeightAt(x, z));
    assert.ok(Math.abs(candidate.refinedHeightAt(x, z + (z === bounds.minZ ? .01 : -.01)) - legacy.refinedHeightAt(x, z)) < .05);
  }
});
test('Secret walking and seaward boat corridor remain unchanged; face shares indexed ground surface', () => {
  for (let z = -1100; z <= -850; z += 5) {
    // Select the low existing strand rather than assuming a straight coastline.
    let shoreX = 5800;
    while (legacy.shoreAt(shoreX, z) > 8 && shoreX < 5970) shoreX += 1;
    for (const offset of [0, 10, 40, 90]) {
      assert.equal(candidate.refinedHeightAt(shoreX + offset, z), legacy.refinedHeightAt(shoreX + offset, z));
    }
  }
  const surface = new NiijimaSurface({ minX: 5840, maxX: 5900, minZ: -950, maxZ: -900 }, 2,
    { heightAt: (x, z) => legacy.refinedHeightAt(x, z) },
    { heightAt: (x, z) => candidate.refinedHeightAt(x, z) }, 4);
  for (let iz = 3; iz < surface.height - 3; iz++) for (let ix = 3; ix < surface.width - 3; ix++) {
    const x = surface.bounds.minX + ix * surface.dx, z = surface.bounds.minZ + iz * surface.dz;
    assert.ok(Math.abs(surface.heightAt(x, z) - candidate.refinedHeightAt(x, z)) < .00001);
    const i = iz * surface.width + ix;
    const expected = surface.ground[i] * .4 + surface.ground[i + 1] * .2 + surface.ground[i + surface.width] * .4;
    assert.ok(Math.abs(surface.heightAt(x + surface.dx * .2, z + surface.dz * .4) - expected) < .00001);
  }
});
