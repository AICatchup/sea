import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IslandElevation } from '../src/world/geodata.ts';
import { NiijimaCoast } from '../src/world/niijima-coast.ts';
import { HabushiMainGate } from '../src/world/habushi-main-gate.ts';
import { HabushiGround } from '../src/world/habushi-ground.ts';
import { ExplorerControls } from '../src/world/explorer-controls.ts';
import { WorldCollision, withWorldCollision } from '../src/world/world-collision.ts';
import { PLAYER_DIMENSIONS } from '../src/world/contracts.ts';

class TestDocument extends EventTarget { hidden = false; defaultView = new EventTarget(); pointerLockElement = null; }
class TestCanvas extends EventTarget {
  ownerDocument = new TestDocument(); style = { touchAction: 'pan-y' }; tabIndex = -1;
  focus(): void {} setPointerCapture(): void {} hasPointerCapture(): boolean { return false; } releasePointerCapture(): void {}
}

function fixture() {
  const base = new IslandElevation(), material = new THREE.MeshStandardMaterial();
  const coast = new NiijimaCoast(base, material), gate = new HabushiMainGate(coast);
  coast.applyGrading(gate.grading);
  const paving = new HabushiGround(gate); coast.applyGrading(paving.grading);
  const solids = new WorldCollision();
  for (const group of [gate.solidsGroup, paving.solidsGroup]) {
    group.updateWorldMatrix(true, true);
    group.traverse(o => { if (o instanceof THREE.Mesh) solids.addMesh(o); });
  }
  const ground = withWorldCollision({ heightAt: (x, z) => coast.contains(x, z) ? coast.heightAt(x, z) : base.heightAt(x, z) }, solids);
  return { gate, ground, solids, dispose() { solids.dispose(); paving.dispose(); gate.dispose(); coast.dispose(); material.dispose(); } };
}

const routes = [
        { name: 'right 20 stairs', points: [[9, 22], [9, 10.5], [9, -.8], [9, 10.5], [9, 22]], stairs: true },
        { name: 'left 20 stairs', points: [[-9, 22], [-9, 10.5], [-9, -.8], [-9, 10.5], [-9, 22]], stairs: true },
        { name: 'central portal', points: [[0, 22], [0, -5], [0, 22]], stairs: false },
        { name: 'north road end', points: [[0, 22], [31, 22], [0, 22]], stairs: false },
        { name: 'south road end', points: [[0, 22], [-31, 22], [0, 22]], stairs: false },
        { name: 'central portal from sidewalk', points: [[0, 10.5], [0, -5], [0, 10.5]], stairs: false },
        { name: 'right stairs from sidewalk', points: [[9, 10.5], [9, -.8], [9, 10.5]], stairs: true },
        { name: 'left stairs from sidewalk', points: [[-9, 10.5], [-9, -.8], [-9, 10.5]], stairs: true },
];
for (const fps of [30, 60]) for (const route of routes) {
  test(`Habushi ${route.name} actual DEM controller round-trip at ${fps} fps`, () => {
    const f = fixture();
    try {
        const world = (x: number, z: number) => f.gate.group.localToWorld(new THREE.Vector3(x, 0, z));
        const start = world(...route.points[0] as [number, number]);
        start.y = f.ground.heightAt(start.x, start.z) + PLAYER_DIMENSIONS.eyeHeight;
        const c = new ExplorerControls(new TestCanvas() as unknown as HTMLCanvasElement, f.ground, [], start);
        c.viewpoint(start.x, start.z, Math.PI / 2, 0);
        let clock = 0, maximumHeight = 0;
        const stepHeights = new Set<number>(), tail: string[] = [];
        const tick = () => {
          const before = c.state.position.clone(); c.update(1 / fps, clock); clock += 1 / fps;
          const p = f.gate.group.worldToLocal(c.state.position.clone()), foot = p.y - PLAYER_DIMENSIONS.eyeHeight;
          maximumHeight = Math.max(maximumHeight, foot);
          if (route.stairs && p.z < 9.5 && p.z > .1 && foot > .2) stepHeights.add(Math.round((foot - .028) / .21));
          tail.push(`t=${clock.toFixed(2)} local=${p.toArray().map(v => v.toFixed(4))} foot=${foot.toFixed(4)} grounded=${c.state.grounded} speed=${c.state.speed.toFixed(4)}`);
          if (tail.length > 6) tail.shift();
          assert.ok(c.state.position.toArray().every(Number.isFinite), tail.join('\n'));
          assert.ok(c.state.position.distanceTo(before) < .45, `remote relocation: ${tail.join('\n')}`);
          if (c.state.grounded) {
            const support = f.ground.supportHeightAt!(c.state.position.x, c.state.position.z, c.state.position.y - PLAYER_DIMENSIONS.eyeHeight, .03, PLAYER_DIMENSIONS.radius);
            const expected = Math.max(f.ground.heightAt(c.state.position.x, c.state.position.z), support ?? -Infinity);
            assert.ok(Math.abs(c.state.position.y - PLAYER_DIMENSIONS.eyeHeight - expected) < .006, `floating feet: ${tail.join('\n')}`);
          }
        };
        try {
          for (let i = 0; i < fps / 2; i++) tick();
          for (const [x, z] of route.points.slice(1)) {
            const target = world(x, z);
            let reached = false;
            const initial = Math.hypot(target.x - c.state.position.x, target.z - c.state.position.z);
            for (let frame = 0; frame < Math.ceil((initial / 1.8 + 8) * fps); frame++) {
              const p = f.gate.group.worldToLocal(c.state.position.clone()), dx = x - p.x, dz = z - p.z, distance = Math.hypot(dx, dz);
              if (distance < .16) { reached = true; break; }
              c.setMove(dx / distance, -dz / distance); tick();
            }
            assert.ok(reached, `${route.name} cannot reach ${x},${z} at ${fps} fps\n${tail.join('\n')}`);
          }
          c.setMove(0, 0); for (let i = 0; i < fps / 2; i++) tick();
          assert.equal(c.state.grounded, true, route.name);
          assert.equal(c.state.mode, 'walk', route.name);
          if (route.stairs) {
            assert.ok(maximumHeight >= 4.19, `upper landing not reached: ${maximumHeight}`);
            assert.equal(stepHeights.size, 20, `all 20 physical treads: ${[...stepHeights]}`);
          }
        } finally { c.dispose(); }
    } finally { f.dispose(); }
  });
}
