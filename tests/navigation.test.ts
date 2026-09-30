import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { ExplorerControls } from '../src/world/explorer-controls.ts';
import { BOAT_MIN_DEPTH, WORLD_LIMIT, findNearbyWater, footSegmentClear, isNavigableWater,
  planWaterRoute, pointDistance, waterSegmentClear } from '../src/world/navigation.ts';
import type { GroundSampler, WorldDestination } from '../src/world/contracts.ts';

class TestDocument extends EventTarget {
  hidden = false;
  defaultView = new EventTarget();
}
class TestCanvas extends EventTarget {
  ownerDocument = new TestDocument();
  style = { touchAction: 'pan-y' };
  tabIndex = -1;
  captured: number | null = null;
  focus(): void { /* Browser focus is outside these simulation tests. */ }
  setPointerCapture(id: number): void { this.captured = id; }
  hasPointerCapture(id: number): boolean { return this.captured === id; }
  releasePointerCapture(id: number): void { if (this.captured === id) this.captured = null; }
}

function setup(ground: GroundSampler, spawn = new THREE.Vector3(0, 1.72, 0), destinations: WorldDestination[] = []) {
  const canvas = new TestCanvas();
  const controls = new ExplorerControls(canvas as unknown as HTMLCanvasElement, ground, destinations, spawn);
  return { controls, canvas, state: controls.state };
}
function advance(controls: ExplorerControls, seconds: number, start = 0): void {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) controls.update(1 / 60, start + frame / 60);
}
function key(canvas: TestCanvas, type: string, code: string, target?: object): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, altKey: false, metaKey: false });
  if (target) Object.defineProperty(event, 'target', { value: target });
  canvas.ownerDocument.defaultView.dispatchEvent(event);
  return event;
}

test('paused ambient motion holds dive air while intentional swimming remains available', () => {
  const { controls, state } = setup({ heightAt: () => -20 });
  controls.viewpoint(0, 0, 0, 0, 'dive', 4);
  controls.setMove(0, 1);
  for (let frame = 0; frame < 120; frame++) controls.update(1 / 60, 34, true);
  assert.equal(state.oxygen, 1);
  assert.ok(state.position.z < -2);
  controls.setMove(0, 0);
  advance(controls, 2);
  assert.ok(state.oxygen < 1);
  controls.dispose();
});

test('water route detours around land and every resulting segment clears the hull', () => {
  const ground: GroundSampler = { heightAt: (x, z) => x >= 20 && x <= 80 && Math.abs(z) < 25 ? 12 : -30 };
  const start = { x: 0, z: 0 }, goal = { x: 100, z: 0 };
  assert.equal(waterSegmentClear(ground, start, goal), false);
  const route = planWaterRoute(ground, start, goal);
  assert.equal(route.error, undefined);
  assert.ok(route.points.length >= 3);
  assert.ok(route.distance > 110 && route.distance < 250);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), goal);
  for (let index = 1; index < route.points.length; index++) assert.ok(waterSegmentClear(ground, route.points[index - 1], route.points[index]));
});

test('fine cove exits connect to a kilometre voyage without cutting through the coast', () => {
  const ground: GroundSampler = { heightAt: (x, z) => {
    const island = Math.abs(x) < 320 && z > -150 && z < 1_200;
    const cove = Math.abs(x) < 35 && z < 220;
    return island && !cove ? 18 : -35;
  } };
  const start = { x: 0, z: 160 }, goal = { x: 2_800, z: 750 };
  const route = planWaterRoute(ground, start, goal);
  assert.equal(route.error, undefined);
  assert.ok(route.points.length >= 3);
  assert.ok(route.points.some(point => point.z < -150));
  for (let index = 1; index < route.points.length; index++) assert.ok(waterSegmentClear(ground, route.points[index - 1], route.points[index]));
});

test('shallow departures and enclosed lagoons fail with a bounded descriptive result', () => {
  const shallow: GroundSampler = { heightAt: () => -0.6 };
  const bad = planWaterRoute(shallow, { x: 0, z: 0 }, { x: 2_000, z: 0 });
  assert.ok(bad.error?.includes('水深'));
  assert.equal(findNearbyWater(shallow, { x: 0, z: 0 }, BOAT_MIN_DEPTH, 24), null);
  const enclosed: GroundSampler = { heightAt: (x, z) => Math.hypot(x, z) < 75 || x > 1_900 ? -20 : 10 };
  const route = planWaterRoute(enclosed, { x: 0, z: 0 }, { x: 2_000, z: 0 });
  assert.ok(route.error?.includes('入り江'));
  assert.ok(route.expanded < 46_000);
});

test('cliffs block swept walking while gentle slopes remain walkable', () => {
  const cliff: GroundSampler = { heightAt: x => x < 3 ? 0 : 20 };
  assert.equal(footSegmentClear(cliff, { x: 0, z: 0 }, { x: 8, z: 0 }), false);
  const slope: GroundSampler = { heightAt: x => x * 0.3 };
  assert.equal(footSegmentClear(slope, { x: 0, z: 0 }, { x: 8, z: 0 }), true);
  const { controls, state } = setup(cliff);
  controls.setMove(1, 0); advance(controls, 2);
  assert.ok(state.position.x < 3);
  assert.ok(Math.abs(state.position.y - 1.72) < 0.01);
  controls.dispose();
});

test('walking has independent forward and strafe controls and enters the sea', () => {
  const shore: GroundSampler = { heightAt: (_x, z) => Math.max(-25, Math.min(5, z * 0.15)) };
  const { controls, state } = setup(shore, new THREE.Vector3(0, 2.17, 3));
  controls.setMove(0, 1); advance(controls, 2);
  assert.equal(state.mode, 'swim');
  assert.ok(state.position.z < -3.7);
  assert.ok(state.position.y > 0 && state.position.y < 0.5);
  const z = state.position.z;
  controls.setMove(1, 0); advance(controls, 1, 2);
  assert.ok(state.position.x > 2.9);
  assert.ok(Math.abs(state.position.z - z) < 0.01);
  controls.dispose();
});

test('diving respects seabed, maximum depth, oxygen, and controlled recovery', () => {
  const sea: GroundSampler = { heightAt: () => -90 };
  const { controls, state } = setup(sea);
  controls.setMode('dive'); controls.setVertical(-1); advance(controls, 35);
  assert.equal(state.mode, 'dive');
  assert.ok(state.depth <= 60 && state.depth > 59.9);
  assert.ok(state.oxygen >= 0 && state.oxygen < 1);
  state.oxygen = 0.16;
  const lowY = state.position.y;
  advance(controls, 2, 35);
  assert.ok(state.position.y > lowY + 3);
  assert.ok(state.message.includes('自動浮上'));
  controls.setVertical(0); advance(controls, 35, 37);
  assert.equal(state.mode, 'swim');
  advance(controls, 16, 72);
  assert.equal(state.oxygen, 1);
  controls.dispose();
  const shallow = setup({ heightAt: () => -5 });
  shallow.controls.setMode('dive'); shallow.controls.setVertical(-1); advance(shallow.controls, 4);
  assert.ok(shallow.state.position.y >= -4.15);
  shallow.controls.dispose();
});

test('manual boat accelerates, coasts, bobs, and stops before grounding', () => {
  const sea: GroundSampler = { heightAt: (_x, z) => z < -70 ? 2 : -30 };
  const { controls, state } = setup(sea);
  controls.setMode('boat'); controls.setMove(0, 1); advance(controls, 4);
  assert.ok(state.speed > 10 && state.speed <= 12);
  assert.ok(state.boatPosition.z < -20 && state.boatPosition.z > -70);
  assert.ok(Math.abs(state.boatPosition.y) <= 0.185);
  const speed = state.speed;
  controls.setMove(0, 0); advance(controls, 1, 4);
  assert.ok(state.speed < speed);
  controls.setMove(0, 1); advance(controls, 10, 5);
  assert.ok(state.boatPosition.z > -68);
  assert.ok(isNavigableWater(sea, state.boatPosition));
  assert.ok(state.message.includes('浅瀬'));
  controls.dispose();
});

test('voyage moves continuously, arrives, and manual input cancels automatic sailing', () => {
  const sea: GroundSampler = { heightAt: () => -50 };
  const destinations: WorldDestination[] = [{ id: 'tomari', label: '泊海岸', island: '式根島', x: 0, z: 0, heading: 0 },
    { id: 'niijima', label: '新島', island: '新島', x: 0, z: -3_000, heading: 0 }];
  const { controls, state } = setup(sea, new THREE.Vector3(0, 1.72, 0), destinations);
  controls.navigate('niijima');
  assert.equal(state.voyageTarget, 'niijima');
  assert.equal(state.boatPosition.z, 0);
  controls.update(1 / 60, 0);
  assert.ok(state.boatPosition.z < 0 && state.boatPosition.z > -1);
  assert.ok(state.message.includes('倍速'));
  advance(controls, 5);
  assert.ok(state.voyageRemaining > 0 && state.voyageRemaining < 3_000);
  controls.setMove(1, 0); controls.update(1 / 60, 5);
  assert.equal(state.voyageTarget, null);
  assert.ok(state.speed <= 12);
  controls.setMove(0, 0); controls.navigate('niijima'); advance(controls, 30, 5);
  assert.equal(state.voyageTarget, null);
  assert.ok(pointDistance(state.boatPosition, destinations[1]) < 0.1);
  assert.ok(state.message.includes('到着'));
  controls.dispose();
});

test('planned clearance survives different frame sampling offsets around a narrow shoal', () => {
  const sea: GroundSampler = { heightAt: (x, z) => Math.max(-35, -0.2 - Math.hypot(x - 375.25, z) * 0.5) };
  const destinations: WorldDestination[] = [{ id: 'tomari', label: '泊', island: '式根島', x: 0, z: 0, heading: 0 },
    { id: 'arrival', label: '到着浜', island: '島', x: 1_000, z: 0, heading: 0 }];
  for (const frameDelta of [1 / 24, 1 / 60, 1 / 120]) {
    const { controls, state } = setup(sea, new THREE.Vector3(0, 1.72, 0), destinations);
    controls.navigate('arrival');
    let elapsed = 0;
    while (state.voyageTarget && elapsed < 30) {
      controls.update(frameDelta, elapsed); elapsed += frameDelta;
      assert.ok(isNavigableWater(sea, state.boatPosition));
    }
    assert.equal(state.voyageTarget, null);
    assert.ok(state.message.includes('到着'));
    assert.ok(pointDistance(state.boatPosition, destinations[1]) < 0.1);
    controls.dispose();
  }
});

test('home, hidden tabs, blur, editable fields, and disposal reset inputs and listeners', () => {
  const flat: GroundSampler = { heightAt: (_x, z) => z < -50 ? -20 : 0 };
  const spawn = new THREE.Vector3(0, 1.72, 0);
  const { controls, canvas, state } = setup(flat, spawn);
  const ignored = key(canvas, 'keydown', 'KeyW', { tagName: 'INPUT' });
  assert.equal(ignored.defaultPrevented, false);
  advance(controls, 1);
  assert.ok(state.position.equals(spawn));
  key(canvas, 'keydown', 'KeyW'); advance(controls, 1);
  assert.ok(state.position.z < -4.9);
  canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
  const stopped = state.position.clone(); advance(controls, 1);
  assert.ok(state.position.equals(stopped));
  controls.setMove(1, 0); canvas.ownerDocument.hidden = true;
  canvas.ownerDocument.dispatchEvent(new Event('visibilitychange'));
  controls.update(100, 100); assert.ok(state.position.equals(stopped));
  canvas.ownerDocument.hidden = false; advance(controls, 1);
  assert.ok(state.position.equals(stopped));
  controls.home(); assert.ok(state.position.equals(spawn));
  assert.equal(state.mode, 'walk'); assert.equal(state.depth, 0);
  controls.dispose(); assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(canvas.tabIndex, -1);
  key(canvas, 'keydown', 'KeyW'); controls.update(1, 1);
  assert.ok(state.position.equals(spawn));
});

test('world bounds and invalid requests stay finite and report the failed destination', () => {
  const { controls, state } = setup({ heightAt: () => -50 }, new THREE.Vector3(WORLD_LIMIT - 5, 0.34, 0));
  controls.setMode('swim'); controls.setMove(1, 0); advance(controls, 5);
  assert.ok(state.position.x < WORLD_LIMIT);
  assert.ok(Number.isFinite(state.position.y));
  controls.navigate('unknown'); assert.ok(state.message.includes('見つかりません'));
  controls.dispose();
});

test('pointer drag changes orientation without pointer lock and releases on blur', () => {
  const { controls, canvas, state } = setup({ heightAt: () => 0 });
  const pointer = (type: string, clientX: number, clientY: number) => {
    canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId: 7, clientX, clientY }));
  };
  pointer('pointerdown', 100, 100); pointer('pointermove', 150, 70);
  advance(controls, 0.5);
  assert.ok(state.yaw < -0.19 && state.pitch > 0.07);
  assert.equal(canvas.captured, 7);
  canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
  assert.equal(canvas.captured, null);
  const yaw = state.yaw;
  pointer('pointermove', 300, 100); advance(controls, 1);
  assert.ok(Math.abs(state.yaw - yaw) < 0.001);
  controls.home(); assert.equal(state.yaw, 0);
  controls.dispose();
});

test('integrated GSI terrain supports the actual coves and neighbour-island voyages', async context => {
  if (!existsSync(new URL('../src/world/geodata.ts', import.meta.url))) {
    context.skip('Real island terrain is checked after integration; this workstream owns navigation only.');
    return;
  }
  const { IslandElevation } = await import('../src/world/geodata.ts');
  const { DESTINATION_SEEDS } = await import('../src/world/locations.ts');
  const ground = new IslandElevation();
  const destinations = DESTINATION_SEEDS.map((destination: WorldDestination) => ({ ...destination, ...ground.arrival(destination.x, destination.z) }));
  const start = destinations.find((destination: WorldDestination) => destination.id === 'tomari')!;
  const spawn = new THREE.Vector3(-36, ground.heightAt(-36, 27) + 1.72, 27);
  for (const destination of destinations.filter((point: WorldDestination) => point.id !== 'tomari')) {
    const route = planWaterRoute(ground, start, destination);
    assert.equal(route.error, undefined, destination.id);
    assert.ok(route.distance < 25_000, destination.id);
    for (let index = 1; index < route.points.length; index++) assert.ok(waterSegmentClear(ground, route.points[index - 1], route.points[index]), destination.id);
    const { controls, state } = setup(ground, spawn, destinations);
    controls.navigate(destination.id);
    let elapsed = 0;
    while (state.voyageTarget && elapsed < 125) { controls.update(1 / 60, elapsed); elapsed += 1 / 60; }
    assert.ok(elapsed < 105, `${destination.id}: ${elapsed.toFixed(1)} seconds`);
    assert.equal(state.voyageTarget, null, destination.id);
    assert.ok(pointDistance(state.boatPosition, destination) < 3, destination.id);
    assert.ok(state.message.includes('到着'), destination.id);
    controls.dispose();
  }
});
