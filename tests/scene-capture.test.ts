import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNamed, captureMatrix, CAPTURE_PROFILES } from '../src/qa/scene-capture.ts';
import type { SceneCaptureHost, CaptureState } from '../src/qa/scene-capture.ts';
const options = { quality: 'high', preset: 'clear', width: 1280, height: 720 };
function fake() {
  let state: CaptureState = { pose: { x: 1, z: 2, yaw: 0, pitch: 0, mode: 'walk' }, camera: [1, 2, 3], width: 1280, height: 720, quality: 'low', preset: 'storm', paused: false, locked: false, hidden: false, disposed: false };
  const calls: string[] = [];
  const host: SceneCaptureHost = {
    ready: Promise.resolve(), readState: () => state,
    restoreState: s => { calls.push('restore'); state = s; },
    setQuality: q => { calls.push('quality'); state.quality = q; },
    setPreset: p => { calls.push('preset'); state.preset = p; },
    setPaused: p => { calls.push('pause'); state.paused = p; },
    visualLock: p => { calls.push('lock'); state.locked = p; },
    viewpoint: (x, z, yaw, pitch, mode, depth) => { calls.push('pose'); state.pose = { x, z, yaw, pitch, mode, depth }; },
    nextFrame: async () => { calls.push('frame'); },
    capturePixels: async () => { calls.push('capture'); return 'data:image/png;base64,AAAA'; },
  };
  return { host, calls, original: structuredClone(state) };
}
test('two frames precede capture; metadata contains actual dimensions and original state restores', async () => {
  const f = fake(); const result = await captureNamed(f.host, CAPTURE_PROFILES[0], options);
  assert.deepEqual(f.calls, ['lock', 'pause', 'quality', 'preset', 'pose', 'frame', 'frame', 'capture', 'restore', 'lock']);
  assert.equal(result.metadata.width, 1280); assert.equal(result.metadata.movementVerified, false);
  assert.deepEqual(f.host.readState(), f.original);
});
for (const failure of ['null', 'error', 'hidden', 'dispose', 'resize', 'timeout']) test(`restores after ${failure}`, async () => {
  const f = fake();
  if (failure === 'null') f.host.capturePixels = async () => null;
  if (failure === 'error') f.host.capturePixels = async () => { throw Error('GPU failed'); };
  if (failure === 'hidden' || failure === 'dispose' || failure === 'resize') f.host.nextFrame = async () => {
    const s = f.host.readState(); if (failure === 'hidden') s.hidden = true; else if (failure === 'dispose') s.disposed = true; else s.width = 446;
  };
  if (failure === 'timeout') f.host.nextFrame = () => new Promise(() => {});
  await assert.rejects(captureNamed(f.host, CAPTURE_PROFILES[0], { ...options, timeoutMs: 20 }));
  assert.deepEqual(f.host.readState(), f.original);
});
test('one operation per host; bounded matrix and callback failure restore', async () => {
  const f = fake(); let finish!: () => void;
  f.host.nextFrame = () => new Promise(resolve => { finish = resolve; });
  const pending = captureNamed(f.host, CAPTURE_PROFILES[0], { ...options, timeoutMs: 20 });
  await assert.rejects(captureNamed(f.host, CAPTURE_PROFILES[1], options), /in flight/);
  await assert.rejects(pending, /timeout/); finish();
  assert.deepEqual(f.host.readState(), f.original);
  const other = fake();
  await assert.rejects(captureMatrix(other.host, options, () => { throw Error('write failed'); }), /write failed/);
  assert.deepEqual(other.host.readState(), other.original);
  await assert.rejects(captureMatrix(other.host, options, undefined, Array(8).fill(CAPTURE_PROFILES[0])), /1..7/);
});

test('restore failure still releases owned lock', async () => {
  const f = fake(); f.host.restoreState = () => { throw Error('restore failed'); };
  await assert.rejects(captureNamed(f.host, CAPTURE_PROFILES[0], options), /restore failed/);
  assert.equal(f.host.readState().locked, false);
});
test('timed out PNG stays exclusive until its pending work settles', async () => {
  const f = fake(); let finish!: (s: string) => void;
  f.host.capturePixels = () => new Promise(resolve => { finish = resolve; });
  await assert.rejects(captureNamed(f.host, CAPTURE_PROFILES[0], { ...options, timeoutMs: 20 }), /timeout/);
  assert.equal(f.host.readState().locked, false);
  await assert.rejects(captureNamed(f.host, CAPTURE_PROFILES[0], options), /in flight/);
  finish('data:image/png;base64,AAAA'); await Promise.resolve();
  f.host.capturePixels = async () => 'data:image/png;base64,AAAA';
  await captureNamed(f.host, CAPTURE_PROFILES[0], options);
});
