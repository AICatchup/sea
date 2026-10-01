import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFishMotion, createFishMotion, fishSegmentClear, FISH_MOTION_LIMITS } from '../src/world/fish-motion.ts';

const dt = 1 / 60, clearance = 0.23;
const targetAt = (t: number) => ({ x: Math.cos(t * 0.13) * 7, z: Math.sin(t * 0.13) * 3.5,
  y: -1.5 + Math.sin(t * 0.6) * 0.24, heading: Math.atan2(Math.cos(t * 0.13) * 0.5, -Math.sin(t * 0.13)) });
const deltaAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
function run(height: (x: number, z: number) => number, duration: number) {
  const state = createFishMotion(targetAt(0)); let blocked = 0, resumed = false, maxError = 0;
  for (let frame = 1; frame <= duration * 60; frame++) {
    const previous = { ...state }, target = targetAt(frame * dt);
    advanceFishMotion(state, target, frame * dt, clearance, height);
    assert.ok(Object.values(state).every(Number.isFinite));
    assert.ok(Math.hypot(state.x - previous.x, state.z - previous.z) <= FISH_MOTION_LIMITS.speed * dt + 1e-8, 'bounded horizontal motion (old centre reset fails)');
    assert.ok(Math.abs(state.y - previous.y) <= FISH_MOTION_LIMITS.verticalSpeed * dt + 1e-8);
    assert.ok(deltaAngle(state.heading, previous.heading) <= FISH_MOTION_LIMITS.turnRate * dt + 1e-8);
    assert.ok(fishSegmentClear(previous, state, clearance, height), 'actual swept segment retains seabed clearance');
    if (state.blockedSteps) blocked++;
    if (blocked && !state.blockedSteps && Math.hypot(state.x - previous.x, state.z - previous.z) > 0.001) resumed = true;
    maxError = Math.max(maxError, Math.hypot(target.x - state.x, target.z - state.z));
  }
  return { blocked, resumed, maxError, state };
}
test('analytical ellipse control follows continuously in deep water', () => {
  const result = run(() => -4, 100);
  assert.equal(result.blocked, 0); assert.ok(result.maxError < 0.12, `tracking error ${result.maxError}`);
});
test('ellipse reaches synthetic shoreline at 12 seconds and swims continuously around it', () => {
  // The northward arc reaches z=3.49 at 12 seconds; the old code resets to (0,0).
  const result = run((_x, z) => z > 3.4 ? -0.2 : -4, 100);
  assert.ok(result.blocked > 0); assert.ok(result.resumed); assert.ok(result.state.z <= 3.4);
});
test('nonfinite patch is an obstruction, not a centre reset', () => {
  const result = run((_x, z) => z > 3.4 ? NaN : -4, 100);
  assert.ok(result.blocked > 0); assert.ok(result.resumed);
});
test('swept clearance catches a narrow ridge between valid endpoints', () => {
  const from = { x: 0, y: -1.5, z: 0, heading: 0 }, to = { ...from, x: 0.16 };
  assert.equal(fishSegmentClear(from, to, clearance, (x) => x > 0.06 && x < 0.10 ? -1 : -4), false);
});
test('clock jumps, reversal, invalid targets and unavailable current ground retain finite last pose', () => {
  const state = createFishMotion(targetAt(0)), initial = { ...state };
  for (const time of [NaN, 1000, 2, 2]) {
    advanceFishMotion(state, targetAt(20), time, clearance, () => -4);
    for (const key of ['x', 'y', 'z', 'heading'] as const) assert.equal(state[key], initial[key]);
  }
  advanceFishMotion(state, { ...targetAt(2), x: NaN }, 2 + dt, clearance, () => -4);
  advanceFishMotion(state, targetAt(2), 2 + dt * 2, clearance, () => NaN);
  for (const key of ['x', 'y', 'z', 'heading'] as const) assert.equal(state[key], initial[key]);
});
