import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSettings, CONTROLS_STORAGE_KEY, defaultControls, parseControls, keyLabel } from '../src/input/control-settings.ts';

test('preferences survive reload and reset without touching adventure progress', () => {
  const data = new Map([['sea.expedition', 'existing-progress']]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const first = new ControlSettings(storage);
  first.setLook({ sensitivity: .65, invertY: true });
  assert.equal(first.rebind('map', 0, 'KeyN'), null);
  const reloaded = new ControlSettings(storage);
  assert.deepEqual(reloaded.value, first.value); assert.equal(reloaded.matches('map', 'KeyN'), true);
  assert.equal(reloaded.matches('map', 'KeyM'), false);
  reloaded.reset(); assert.deepEqual(new ControlSettings(storage).value, defaultControls());
  assert.equal(data.get('sea.expedition'), 'existing-progress'); assert.equal(data.size, 2);
  assert.ok(data.has(CONTROLS_STORAGE_KEY));
});

test('duplicate, reserved and last-key removal attempts leave bindings intact', () => {
  const controls = new ControlSettings(), before = controls.value;
  assert.match(controls.rebind('map', 0, 'KeyW')!, /設定済み/);
  assert.match(controls.rebind('map', 0, 'Escape')!, /使用できません/);
  assert.match(controls.rebind('map', 0, 'Space')!, /使用できません/);
  assert.match(controls.rebind('map', 0, '')!, /1つ/);
  assert.equal(controls.value, before);
  assert.equal(controls.rebind('forward', 1, ''), null);
  assert.equal(controls.rebind('right', 1, 'ArrowUp'), null);
  assert.equal(controls.matches('forward', 'ArrowUp'), false); assert.equal(controls.matches('right', 'ArrowUp'), true);
  assert.equal(controls.matches('sprint', 'ShiftRight'), true); assert.equal(controls.matches('descend', 'ControlRight'), false);
  assert.match(controls.rebind('descend', 1, 'ControlRight')!, /使用できません/);
});

test('corrupt or conflicting persisted keys recover to complete defaults, invalid sensitivity remains finite', () => {
  for (const raw of ['{', 'null', '[]', '{"version":2}', JSON.stringify({ version: 1, ...defaultControls(), bindings: { ...defaultControls().bindings, map: ['KeyW', ''] } })])
    assert.deepEqual(parseControls(raw), defaultControls());
  const parsed = parseControls(JSON.stringify({ version: 1, ...defaultControls(), sensitivity: 200, invertX: 'yes' }));
  assert.equal(parsed.sensitivity, 3); assert.equal(parsed.invertX, false);
  const controls = new ControlSettings(); controls.setLook({ sensitivity: NaN }); assert.equal(controls.value.sensitivity, 1);
  assert.deepEqual(controls.look(NaN, Infinity), { yaw: 0, pitch: -0 });
});

test('storage denial does not break live settings and subscriptions can be disposed', () => {
  const settings = new ControlSettings({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } });
  let changed = 0; const stop = settings.subscribe(() => changed++);
  settings.setLook({ sensitivity: 2, invertX: true }); assert.equal(settings.saveStatus, 'unavailable'); assert.equal(changed, 1);
  stop(); settings.reset(); assert.equal(changed, 1); assert.equal(settings.value.invertX, false);
  assert.equal(keyLabel('ShiftRight'), 'Shift'); assert.equal(keyLabel(''), '未設定');
});
