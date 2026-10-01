import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { ExplorerControls } from '../src/world/explorer-controls.ts';
import { BOAT_MIN_DEPTH, WORLD_LIMIT, findNearbyWater, footSegmentClear, isNavigableWater,
  planWaterRoute, pointDistance, waterSegmentClear, ROUTE_MIN_DEPTH, ROUTE_RADIUS } from '../src/world/navigation.ts';
import type { GroundSampler, WorldDestination } from '../src/world/contracts.ts';
import { BOAT_ACCESS } from '../src/world/contracts.ts';
import { WorldCollision, withWorldCollision } from '../src/world/world-collision.ts';

class TestDocument extends EventTarget {
  hidden = false;
  defaultView = new EventTarget();
  pointerLockElement: TestCanvas | null = null;
  exitPointerLock(): void { this.pointerLockElement = null; this.dispatchEvent(new Event('pointerlockchange')); }
}
class TestCanvas extends EventTarget {
  ownerDocument = new TestDocument();
  style = { touchAction: 'pan-y' };
  tabIndex = -1;
  captured: number | null = null;
  requestPointerLock?: () => Promise<void>;
  focus(): void { /* Browser focus is outside these simulation tests. */ }
  setPointerCapture(id: number): void { this.captured = id; }
  hasPointerCapture(id: number): boolean { return this.captured === id; }
  releasePointerCapture(id: number): void { if (this.captured === id) this.captured = null; }
}

function setup(ground: GroundSampler, spawn = new THREE.Vector3(0, 1.64, 0), destinations: WorldDestination[] = []) {
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
  assert.ok(Math.abs(state.position.y - 1.64) < 0.01);
  controls.dispose();
});

test('solid stairs step up and down, tall walls block and a jump lands on a rock',()=>{
  const solids=new WorldCollision();
  for(let i=0;i<3;i++) solids.addBox(new THREE.Box3(new THREE.Vector3(1+i*.7,0,-1),new THREE.Vector3(1.7+i*.7,(i+1)*.25,1)));
  const {controls,state}=setup(withWorldCollision({heightAt:()=>0},solids));
  controls.setMove(1,0);advance(controls,1.7);
  assert.ok(state.position.x>2.4,`stairs ascended: ${state.position.toArray()}`);assert.ok(state.position.y>2.38);assert.equal(state.grounded,true);
  controls.setMove(-1,0);advance(controls,2);assert.ok(state.position.x<1);assert.ok(Math.abs(state.position.y-1.64)<.01);
  controls.dispose();solids.clear();
  solids.addBox(new THREE.Box3(new THREE.Vector3(1,0,-1),new THREE.Vector3(3,.7,1)));
  const jump=setup(withWorldCollision({heightAt:()=>0},solids));jump.controls.setMove(1,0);advance(jump.controls,.7);
  assert.ok(jump.state.position.x<1);key(jump.canvas,'keydown','Space');advance(jump.controls,1);
  assert.ok(jump.state.position.x>1.3 && jump.state.position.x<3);assert.ok(Math.abs(jump.state.position.y-2.34)<.01);assert.equal(jump.state.grounded,true);
  jump.controls.dispose();solids.clear();solids.addBox(new THREE.Box3(new THREE.Vector3(1,0,-1),new THREE.Vector3(2,3,1)));
  const tall=setup(withWorldCollision({heightAt:()=>0},solids));tall.controls.setMove(1,0);key(tall.canvas,'keydown','Space');advance(tall.controls,2);
  assert.ok(tall.state.position.x<.76);tall.controls.dispose();
});

test('vertical diving and rising stop against submerged rock faces without changing horizontal location',()=>{
  const solids=new WorldCollision();solids.addBox(new THREE.Box3(new THREE.Vector3(-2,-5,-2),new THREE.Vector3(2,-3,2)));
  const {controls,state}=setup(withWorldCollision({heightAt:()=>-20},solids));controls.viewpoint(0,0,0,0,'dive',1);
  controls.setVertical(-1);advance(controls,3);assert.ok(state.position.y>=-2.751);assert.ok(state.position.y< -2.7);assert.ok(Math.abs(state.position.x)<.01 && Math.abs(state.position.z)<.01);
  controls.viewpoint(0,0,0,0,'dive',7);controls.setVertical(1);advance(controls,3);assert.ok(state.position.y<=-5.249);assert.ok(state.position.y>-5.3);
  controls.dispose();
});

test('legacy non-heightfield terrain vertical hooks still stop dives with an empty solid registry',()=>{
  const legacy:GroundSampler={heightAt:()=>-20,bodySegmentBlocked:(from,to)=>Math.min(from.y,to.y)<=-3};
  const {controls,state}=setup(withWorldCollision(legacy,new WorldCollision()));
  controls.viewpoint(0,0,0,0,'dive',1);controls.setVertical(-1);advance(controls,3);
  assert.ok(state.position.y>=-2.75);assert.ok(state.position.y<-2.7);controls.dispose();
});


test('shore walking accelerates, wades, swims, dives and surfaces without relocation', () => {
  const shore: GroundSampler = { heightAt: (_x, z) => Math.max(-25, Math.min(5, z * .15)) };
  const { controls, state } = setup(shore, new THREE.Vector3(0, 2.09, 3));
  controls.setMove(1, 0); advance(controls, 2); controls.setMove(0, 0); advance(controls, .3);
  controls.setMove(0, 1); controls.update(1 / 60, 0);
  assert.ok(state.speed > 0 && state.speed < .2);
  const seen = new Set<string>(); let last = state.position.clone();
  for (let frame = 0; frame < 1_200; frame++) {
    controls.update(1 / 60, frame / 60); seen.add(state.mode);
    assert.ok(state.position.distanceTo(last) < .12, `continuous frame ${frame}`); last.copy(state.position);
  }
  assert.ok(seen.has('walk') && seen.has('swim'));
  assert.equal(state.mode, 'swim'); assert.ok(state.position.z < -20);
  assert.ok(state.position.y > .2 && state.position.y <= .35);
  assert.ok((state.immersion ?? 0) > .7);
  controls.setMove(0, 0); advance(controls, .5);
  controls.setVertical(-1); const surfaceY = state.position.y;
  controls.update(1 / 60, 21); assert.ok(surfaceY - state.position.y < .01);
  advance(controls, 2, 21); assert.equal(state.mode, 'dive'); assert.ok(state.depth > 2);
  const deep = state.position.clone();
  controls.setVertical(1); advance(controls, 3, 23);
  assert.equal(state.mode, 'swim'); assert.ok(state.position.y > .2);
  assert.ok(Math.abs(state.position.x - deep.x) < .01 && Math.abs(state.position.z - deep.z) < .01);
  controls.setVertical(0); controls.setMove(0, -1); advance(controls, 30, 26);
  assert.equal(state.mode, 'walk'); assert.equal(state.grounded, true);
  controls.dispose();
});

test('walk, jump, running stamina, gentle gait and stopping have physical inertia', () => {
  const { controls, canvas, state } = setup({ heightAt: () => 0 });
  controls.setMove(0, 1); advance(controls, 1);
  assert.ok(state.speed > 1.8 && state.speed < 1.9);
  assert.ok(Math.abs(state.viewOffset!.y) <= .03 && (state.gaitPhase ?? 0) > 0);
  controls.setMove(0, 0); controls.update(1 / 60, 1); assert.ok(state.speed > 0);
  advance(controls, .4, 1); assert.equal(state.speed, 0);
  key(canvas, 'keydown', 'Space'); controls.update(1 / 60, 2);
  assert.equal(state.grounded, false); assert.ok(state.position.y > 1.64);
  advance(controls, 1.2, 2); assert.equal(state.grounded, true); assert.equal(state.position.y, 1.64);
  key(canvas, 'keyup', 'Space'); key(canvas, 'keydown', 'ShiftLeft'); controls.setMove(0, 1); advance(controls, 2);
  assert.ok(state.speed > 4.5); assert.ok((state.stamina ?? 1) < .9);
  controls.dispose();
});

test('camera direction drives submerged swimming, seabed/depth and air recovery remain bounded', () => {
  const { controls, state } = setup({ heightAt: () => -90 });
  controls.viewpoint(0, 0, Math.PI / 2, -.5, 'dive', 4); controls.setMove(0, 1);
  advance(controls, 1); assert.ok(state.position.x > 1 && state.position.y < -4.5);
  controls.setMove(0, 0); controls.setVertical(-1); advance(controls, 40);
  assert.ok(state.depth <= 60 && state.depth > 59.8); assert.ok(state.oxygen < 1);
  state.oxygen = .16; const before = state.position.y; advance(controls, 2);
  assert.ok(state.position.y > before + 3); assert.ok(state.message.includes('自動浮上'));
  controls.setVertical(0); advance(controls, 38); assert.equal(state.mode, 'swim');
  advance(controls, 16); assert.equal(state.oxygen, 1); controls.dispose();
  const shallow = setup({ heightAt: () => -5 });
  shallow.controls.viewpoint(0, 0, 0, 0, 'dive', 2); shallow.controls.setVertical(-1); advance(shallow.controls, 4);
  assert.ok(shallow.state.position.y >= -4.25); shallow.controls.dispose();
});

test('paused ambient motion holds dive air while intentional swimming remains available', () => {
  const { controls, state } = setup({ heightAt: () => -20 });
  controls.viewpoint(0, 0, 0, 0, 'dive', 4); controls.setMove(0, 1);
  for (let frame = 0; frame < 120; frame++) controls.update(1 / 60, 34, true);
  assert.equal(state.oxygen, 1); assert.ok(state.position.z < -2);
  controls.setMove(0, 0); advance(controls, 2); assert.ok(state.oxygen < 1); controls.dispose();
});

test('one world connects beach approach, smooth boarding, voyage and nearby water disembark', () => {
  const ground: GroundSampler = { heightAt: (_x, z) => Math.max(-30, z * .15) };
  const destinations: WorldDestination[] = [{ id: 'tomari', label: '泊', island: '式根島', x: 0, z: -30, heading: 0 },
    { id: 'arrival', label: '沖の島', island: '島', x: 0, z: -3_000, heading: 0 }];
  const { controls, state } = setup(ground, new THREE.Vector3(0, 2.24, 4), destinations);
  const start = state.position.clone(), anchor = state.boatPosition.clone();
  assert.ok(pointDistance(start, anchor) > 10 && pointDistance(start, anchor) < 80);
  assert.ok(isNavigableWater(ground, anchor, BOAT_MIN_DEPTH));
  controls.interact(); assert.ok(state.position.equals(start)); assert.equal(state.mode, 'walk');
  controls.navigate('arrival'); assert.equal(state.voyageTarget, null); assert.ok(state.position.equals(start));
  controls.setMove(1, 0); advance(controls, 1); controls.setMove(0, 0); advance(controls, .3);
  controls.setMove(0, 1); let frame = 0;
  while (!state.interactionLabel && frame < 1_800) { controls.update(1 / 60, frame / 60); frame++; }
  assert.equal(state.interactionLabel, '船に乗る'); controls.setMove(0, 0); advance(controls, .3);
  const before = state.position.clone(); controls.interact(); assert.ok(state.position.equals(before));
  assert.notEqual(state.mode, 'boat'); controls.navigate('arrival'); assert.equal(state.voyageTarget, null);
  controls.update(1 / 60, 31); assert.ok(state.position.distanceTo(before) < .05);
  advance(controls, .7); assert.equal(state.avatarAction, 'climb'); assert.ok((state.boardingProgress ?? 0) > .3);
  advance(controls, 1); assert.equal(state.mode, 'boat'); assert.ok(state.position.y < 1.6);
  controls.navigate('arrival'); assert.equal(state.voyageTarget, 'arrival');
  controls.update(1 / 60, 32); assert.ok(state.boatPosition.distanceTo(anchor) < .1);
  assert.ok(state.message.includes('出航')); advance(controls, state.voyageRemaining/12+30);
  assert.equal(state.voyageTarget, null); assert.ok(pointDistance(state.boatPosition, destinations[1]) < .1);
  const boatEye = state.position.clone(), boat = state.boatPosition.clone();
  controls.interact(); assert.ok(state.position.equals(boatEye)); advance(controls, 4.6);
  assert.equal(state.mode, 'swim'); assert.ok(pointDistance(state.position, boat) > 3 && pointDistance(state.position, boat) < 4.5);
  assert.ok(state.position.y > .2); controls.dispose();
});

function board(controls: ExplorerControls): void {
  const boat = controls.state.boatPosition;
  controls.viewpoint(boat.x + 1.7, boat.z, 0, 0, 'swim'); controls.interact(); advance(controls, 1.7);
  assert.equal(controls.state.mode, 'boat');
}

test('the actually drawn stern ladder boards continuously from the observed failing approach',()=>{
  const {controls,state}=setup({heightAt:()=>-20});
  state.boatPosition.set(-118.5950068345507,0,-90.9578943776148);state.boatYaw=-.6;
  controls.viewpoint(-116.75051777212414,-88.5513561143137,-.65365,-.04,'swim');
  const start=state.position.clone();controls.interact();assert.ok(state.position.equals(start));assert.notEqual(state.mode,'boat');
  advance(controls,1.25);
  const platform=new THREE.Vector3(BOAT_ACCESS.ladderX,BOAT_ACCESS.platformY+BOAT_ACCESS.platformThickness/2+1.64,BOAT_ACCESS.platformZ)
    .applyEuler(new THREE.Euler(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ')).add(state.boatPosition);
  assert.ok(state.position.distanceTo(platform)<.04);assert.equal(state.avatarAction,'climb');
  advance(controls,4);assert.equal(state.mode,'boat');
  controls.interact();advance(controls,4.6);assert.equal(state.mode,'swim');
  const stern=new THREE.Vector3(BOAT_ACCESS.ladderX,0,BOAT_ACCESS.waterZ+.35)
    .applyEuler(new THREE.Euler(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ')).add(state.boatPosition);
  assert.ok(pointDistance(state.position,stern)<.04);controls.dispose();
});

test('stern boarding and exit avoid the rear bench as an actual swept solid',()=>{
  const solids=new WorldCollision(),{controls,state}=setup(withWorldCollision({heightAt:()=>-20},solids));
  state.boatYaw=0;state.boatPosition.y=0;const boat=state.boatPosition.clone();
  // Measured from the rendered bench/seat/back dimensions, independent of
  // the path interpolator; the former direct route crossed this volume.
  solids.addBox(new THREE.Box3(new THREE.Vector3(boat.x-.295,boat.y+.14,boat.z+1.60),
    new THREE.Vector3(boat.x+.78,boat.y+.91,boat.z+2.27)));
  solids.addBox(new THREE.Box3(new THREE.Vector3(boat.x+.21,boat.y+.5825,boat.z+.63),
    new THREE.Vector3(boat.x+.75,boat.y+.6975,boat.z+1.15)));
  controls.viewpoint(boat.x-.75,boat.z+3.35,0,0,'swim');controls.interact();advance(controls,5.2);
  assert.equal(state.mode,'boat');controls.interact();advance(controls,4.6);
  assert.equal(state.mode,'swim');solids.dispose();controls.dispose();
});

test('seated camera uses the same yaw-pitch-roll frame as the drawn vessel and helm body',()=>{
  const {controls,state}=setup({heightAt:()=>-12});board(controls);
  for(const [yaw,pitch,roll] of [[1.57,.12,.08],[-.9,-.2,.13],[.5,0,0]]){
    state.boatYaw=yaw;state.boatPitch=pitch;state.boatRoll=roll;
    controls.update(1/60,1);
    const expected=new THREE.Vector3(.48,1.45,.76).applyEuler(new THREE.Euler(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ')).add(state.boatPosition);
    assert.ok(state.position.distanceTo(expected)<1e-8);
  }
  controls.dispose();
});

test('the placed hull blocks swimming through the vessel while its ladder remains reachable', () => {
  const { controls, state } = setup({ heightAt: () => -20 });
  const boat = state.boatPosition.clone(); controls.viewpoint(boat.x + 4, boat.z, 0, 0, 'swim');
  controls.setMove(-1, 0); advance(controls, 3);
  assert.ok(state.position.x >= boat.x + 1.3); assert.equal(state.interactionLabel, '船に乗る');
  controls.viewpoint(boat.x + 4, boat.z, 0, 0, 'dive', 3); controls.setMove(-1, 0); advance(controls, 3);
  assert.ok(state.position.x < boat.x); controls.dispose();
});

test('solid furniture blocks the boarding arc and removal restores the same physical ladder',()=>{
  const solids=new WorldCollision(),{controls,state}=setup(withWorldCollision({heightAt:()=>-20},solids));
  const boat=state.boatPosition.clone();controls.viewpoint(boat.x+1.7,boat.z,0,0,'swim');
  const obstacle=solids.addBox(new THREE.Box3(new THREE.Vector3(boat.x+.5,-2,boat.z-.4),new THREE.Vector3(boat.x+1.2,3,boat.z+.4)));
  const start=state.position.clone();controls.interact();advance(controls,1.7);
  assert.notEqual(state.mode,'boat');assert.ok(state.position.distanceTo(start)<.01);
  solids.remove(obstacle);controls.interact();advance(controls,1.7);assert.equal(state.mode,'boat');
  controls.dispose();
});

test('manual boat accelerates, coasts, reads water attitude and stops before grounding', () => {
  const sea: GroundSampler = { heightAt: (_x, z) => z < -70 ? 2 : -30 };
  const { controls, state } = setup(sea); board(controls);
  controls.setWaterHeightSampler((x, z) => .04 * x + .02 * z);
  controls.setMove(0, 1); advance(controls, 4);
  assert.ok(state.speed > 10 && state.speed <= 12); assert.ok(state.boatPosition.z < -20 && state.boatPosition.z > -70);
  assert.ok((state.boatPitch ?? 0) < -.015 && (state.boatRoll ?? 0) > .03);
  const speed = state.speed; controls.setMove(0, 0); advance(controls, 1); assert.ok(state.speed < speed);
  controls.setMove(0, 1); advance(controls, 10);
  assert.ok(state.boatPosition.z > -67.2); assert.ok(isNavigableWater(sea, state.boatPosition)); assert.ok(state.message.includes('浅瀬'));
  controls.dispose();
});

test('planned clearance survives different frame offsets and manual input cancels a voyage', () => {
  const sea: GroundSampler = { heightAt: (x, z) => Math.max(-35, -.2 - Math.hypot(x - 375.25, z) * .5) };
  const destinations: WorldDestination[] = [{ id: 'tomari', label: '泊', island: '式根島', x: 0, z: 0, heading: 0 },
    { id: 'arrival', label: '到着浜', island: '島', x: 1_000, z: 0, heading: 0 }];
  for (const frameDelta of [1 / 24, 1 / 60, 1 / 120]) {
    const { controls, state } = setup(sea, new THREE.Vector3(0, 1.64, 0), destinations); board(controls);
    controls.navigate('arrival'); advance(controls, 2); controls.setMove(1, 0); controls.update(frameDelta, 3);
    assert.equal(state.voyageTarget, null); assert.ok(state.speed <= 12);
    controls.setMove(0, 0); controls.navigate('arrival'); let elapsed = 0;
    const maximumSeconds=state.voyageRemaining/12+30;
    while (state.voyageTarget && elapsed < maximumSeconds) { controls.update(frameDelta, elapsed); elapsed += frameDelta; assert.ok(isNavigableWater(sea, state.boatPosition)); }
    assert.equal(state.voyageTarget, null); assert.ok(state.message.includes('到着'));
    assert.ok(pointDistance(state.boatPosition, destinations[1]) < .1); controls.dispose();
  }
});

test('hidden tabs, blur, editable fields, Escape and disposal reset held movement', () => {
  const { controls, canvas, state } = setup({ heightAt: () => 0 });
  const spawn = state.position.clone();
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
    assert.equal(key(canvas, 'keydown', 'KeyW', { tagName }).defaultPrevented, false);
  }
  advance(controls, 1); assert.ok(state.position.equals(spawn));
  key(canvas, 'keydown', 'KeyW'); advance(controls, 1); assert.ok(state.position.z < -1.5);
  canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur')); const stopped = state.position.clone();
  advance(controls, 1); assert.ok(state.position.equals(stopped));
  controls.setMove(1, 0); canvas.ownerDocument.hidden = true; canvas.ownerDocument.dispatchEvent(new Event('visibilitychange'));
  controls.update(100, 100); assert.ok(state.position.equals(stopped));
  canvas.ownerDocument.hidden = false; advance(controls, 1); assert.ok(state.position.equals(stopped));
  key(canvas, 'keydown', 'KeyW'); advance(controls, .2); key(canvas, 'keydown', 'Escape');
  const escaped = state.position.clone(); advance(controls, 1); assert.ok(state.position.equals(escaped));
  controls.home(); assert.ok(state.position.equals(spawn)); controls.dispose();
  assert.equal(canvas.style.touchAction, 'pan-y'); assert.equal(canvas.tabIndex, -1);
  key(canvas, 'keydown', 'KeyW'); controls.update(1, 1); assert.ok(state.position.equals(spawn));
});

function pointer(canvas: TestCanvas, type: string, x: number, y: number, button = 0, pointerType = 'mouse'): void {
  canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button, pointerId: 7, clientX: x, clientY: y, pointerType }));
}
test('pointer lock is requested only by canvas gesture, locked relative look and Escape release work', () => {
  const { controls, canvas, state } = setup({ heightAt: () => 0 }); let requests = 0;
  canvas.requestPointerLock = async () => { requests++; canvas.ownerDocument.pointerLockElement = canvas; canvas.ownerDocument.dispatchEvent(new Event('pointerlockchange')); };
  advance(controls, 1); assert.equal(requests, 0);
  pointer(canvas, 'pointerdown', 100, 100, 2); assert.equal(requests, 0);
  pointer(canvas, 'pointerdown', 100, 100); assert.equal(requests, 1); assert.equal(canvas.captured, null);
  canvas.ownerDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 80, movementY: -40 }));
  advance(controls, .5); assert.ok(state.yaw < -.22 && state.pitch > .07);
  key(canvas, 'keydown', 'Escape'); assert.equal(canvas.ownerDocument.pointerLockElement, null);
  const yaw = state.yaw; canvas.ownerDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 500, movementY: 0 }));
  advance(controls, 1); assert.ok(Math.abs(state.yaw - yaw) < .001); controls.dispose();
});

test('denied pointer lock retains drag fallback and touch never requests lock', async () => {
  const { controls, canvas, state } = setup({ heightAt: () => 0 }); let requests = 0;
  canvas.requestPointerLock = () => { requests++; return Promise.reject(new Error('Denied')); };
  pointer(canvas, 'pointerdown', 100, 100); pointer(canvas, 'pointermove', 180, 70);
  await Promise.resolve(); advance(controls, .5); assert.ok(state.yaw < -.22); assert.equal(canvas.captured, 7);
  canvas.ownerDocument.defaultView.dispatchEvent(new Event('blur')); assert.equal(canvas.captured, null);
  const yaw = state.yaw; pointer(canvas, 'pointermove', 300, 100); advance(controls, 1); assert.ok(Math.abs(state.yaw - yaw) < .001);
  pointer(canvas, 'pointerdown', 100, 100, 0, 'touch'); assert.equal(requests, 1); controls.dispose();
});

test('world bounds and invalid requests stay finite', () => {
  const { controls, state } = setup({ heightAt: () => -50 }, new THREE.Vector3(WORLD_LIMIT - 5, .34, 0));
  controls.setMove(1, 0); advance(controls, 5); assert.ok(state.position.x < WORLD_LIMIT); assert.ok(Number.isFinite(state.position.y));
  controls.navigate('unknown'); assert.ok(state.message.includes('見つかりません')); controls.dispose();
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
  const spawn = new THREE.Vector3(-36, ground.heightAt(-36, 27) + 1.64, 27);
  for (const destination of destinations.filter((point: WorldDestination) => point.id !== 'tomari')) {
    const route = planWaterRoute(ground, start, destination);
    assert.equal(route.error, undefined, destination.id);
    assert.ok(route.distance < 25_000, destination.id);
    for (let index = 1; index < route.points.length; index++) assert.ok(waterSegmentClear(ground, route.points[index - 1], route.points[index]), destination.id);
    const { controls, state } = setup(ground, spawn, destinations);
    controls.viewpoint(state.boatPosition.x + 1.7, state.boatPosition.z, 0, 0, 'swim');
    controls.interact(); advance(controls, 1.7);
    assert.equal(state.mode, 'boat', destination.id);
    controls.navigate(destination.id);
    let elapsed = 0;
    const maximumSeconds=state.voyageRemaining/12+90;
    while (state.voyageTarget && elapsed < maximumSeconds) {
      controls.update(1 / 60, elapsed); elapsed += 1 / 60;
      assert.ok(state.speed<=12.001,'automatic voyages use the same physical vessel speed as manual sailing');
    }
    assert.ok(elapsed < maximumSeconds, `${destination.id}: ${elapsed.toFixed(1)} seconds`);
    assert.equal(state.voyageTarget, null, destination.id);
    const arrival = findNearbyWater(ground, destination, ROUTE_MIN_DEPTH, 180, ROUTE_RADIUS)!;
    assert.ok(pointDistance(state.boatPosition, arrival) < .1, `${destination.id}: ${state.message}, gap=${pointDistance(state.boatPosition, arrival)}`);
    assert.ok(pointDistance(arrival, destination) < 20, `${destination.id} remains at its actual coastal arrival`);
    assert.ok(state.message.includes('到着'), destination.id);
    controls.dispose();
  }
});
