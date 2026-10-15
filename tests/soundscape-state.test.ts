import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SoundscapeState, type SoundscapeFrame} from '../src/audio/soundscape-state.ts';
const frame = (): SoundscapeFrame => ({dt: .1, time: 0, mode: 'walk', position: {x: 0, y: 0, z: 0}, velocity: {x: 0, y: 0, z: 0}, yaw: 0,
  depth: 0, immersion: 0, grounded: true, gaitPhase: 0, boat: {pitch: 0, roll: 0, speed: 0},
  environment: {windSpeed: 8, windDirection: 0}, wave: {ready: true, level: 0, slope: 0, shoreStrength: 1}});
test('relative wind cancels matching motion and distinguishes headwind and tailwind', () => {
  const s = new SoundscapeState(), f = frame();
  f.velocity.z = -8; assert.equal(s.update(f).wind, 0);
  f.velocity.z = -4; const tail = s.update(f);
  f.velocity.z = 4; const head = s.update(f);
  assert.equal(tail.relativeWindSpeed, 4); assert.equal(head.relativeWindSpeed, 12); assert.ok(head.wind > tail.wind);
  f.velocity.z = 0; f.environment.windDirection = Math.PI / 2;
  assert.ok(s.update(f).pan > .99); f.yaw = Math.PI; assert.ok(s.update(f).pan < -.99);
});
test('boat idle, acceleration, exit and underwater cut', () => {
  const s = new SoundscapeState(), f = frame(); f.mode = 'boat';
  const idle = s.update(f); assert.ok(idle.engine > 0); assert.equal(idle.hullwash, 0);
  f.boat.speed = 10; const fast = s.update(f); assert.ok(fast.engine > idle.engine); assert.ok(fast.enginePitch > idle.enginePitch); assert.ok(fast.hullwash > 0);
  f.immersion = 1; assert.equal(s.update(f).engine, 0);
  f.immersion = 0; f.mode = 'walk'; assert.equal(s.update(f).engine, 0); assert.equal(s.update(f).hullwash, 0);
});
test('continuous air cut and quiet sheltered bay, wave readiness gates surf', () => {
  const s = new SoundscapeState(), f = frame(); const dry = s.update(f);
  f.immersion = .5; const half = s.update(f); assert.ok(half.wind > 0 && half.wind < dry.wind); assert.ok(half.cutoffHz < dry.cutoffHz);
  f.depth = .4; f.mode = 'dive'; f.velocity.z = 1; const under = s.update(f);
  assert.equal(under.wind, 0); assert.equal(under.surf, 0); assert.ok(under.breath > 0); assert.ok(under.bubbles > 0);
  f.depth = 0; f.immersion = 0; f.wave.shoreStrength = 0; f.environment.windSpeed = 1;
  const bay = s.update(f); assert.equal(bay.surf, 0); assert.ok(bay.wind < .04);
  f.wave.ready = false; f.wave.shoreStrength = 1; assert.equal(s.update(f).surf, 0);
});

test('propeller demand changes engine sound independently from coasting hull speed',()=>{
 const s=new SoundscapeState(),f=frame();f.mode='boat';f.boat.speed=10;f.boat.throttle=0;
 const coast=s.update(f);assert.equal(coast.engine,.08);assert.ok(coast.hullwash>0);
 f.boat.throttle=1;f.boat.speed=0;
 for(let i=0;i<30;i++)s.update(f);
 const power=s.update(f);assert.ok(power.engine>coast.engine*5);assert.ok(power.enginePitch>coast.enginePitch);assert.equal(power.hullwash,0);
 f.dt=0;f.boat.throttle=0;assert.equal(s.update(f).engine,power.engine,'paused time cannot spool down');
 f.dt=.1;f.boat.speed=10;for(let i=0;i<30;i++)s.update(f);
 const released=s.update(f);assert.ok(released.engine<.081);assert.ok(released.hullwash>0);
 f.mode='swim';assert.equal(s.update(f).engine,0);
});
test('footfalls cross gait boundaries and pause, large dt, pose reset cannot burst', () => {
  const s = new SoundscapeState(), f = frame(); f.velocity.z = 2; f.gaitPhase = .4 * 2 * Math.PI; s.update(f);
  f.gaitPhase = .6 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 1);
  f.gaitPhase = 3.1 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  f.gaitPhase = 3.6 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 1);
  f.dt = 0; f.gaitPhase = .1 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  f.dt = .1; f.gaitPhase = .2 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  f.dt = 10; f.gaitPhase = .6 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  f.dt = .1; f.position.x = 100; f.gaitPhase = .1 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  s.reset(); f.gaitPhase = .6 * 2 * Math.PI; assert.equal(s.update(f).footsteps.length, 0);
  f.mode = 'boat'; f.boat.roll = 2; assert.equal(s.update(f).creak, 0);
});
test('seeded birds are sparse, habitat gated, timestamp independent and paused clocks freeze', () => {
  const a = new SoundscapeState(7), b = new SoundscapeState(7), f = frame(); let count = 0;
  for (let i = 0; i < 700; i++) {f.time = i * 1000; const x = a.update(f), y = b.update({...f, time: -i}); assert.deepEqual(x.bird, y.bird); if (x.bird) count++;}
  assert.ok(count >= 2 && count <= 5);
  const c = new SoundscapeState(7); c.update(f); f.dt = 0;
  for (let i = 0; i < 1000; i++) assert.equal(c.update(f).bird, null);
  f.dt = .1; assert.equal(c.update(f).bird, null); f.immersion = 1;
  for (let i = 0; i < 200; i++) assert.equal(c.update(f).bird, null);
});
test('invalid inputs remain finite and amplitudes bounded; invalid dt produces no events', () => {
  const s = new SoundscapeState(), f = frame(); f.dt = NaN; f.yaw = Infinity; f.depth = NaN; f.immersion = 4;
  f.velocity = {x: NaN, y: Infinity, z: -1e100}; f.boat = {speed: Infinity, pitch: NaN, roll: Infinity};
  f.environment = {windSpeed: NaN, windDirection: Infinity}; f.wave.slope = Infinity;
  const out = s.update(f);
  for (const key of ['wind','surf','hullwash','creak','engine','swim','breath','bubbles','airTransmission'] as const) assert.ok(out[key] >= 0 && out[key] <= 1, key);
  for (const value of Object.values(out)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  assert.equal(out.bird, null); assert.deepEqual(out.footsteps, []);
});

test('incoming wave produces audible wash attack then release without false reacquisition impact',()=>{
  const s=new SoundscapeState(),f=frame();const baseline=s.update(f).surf;
  f.wave={...f.wave,level:.2};const arrival=s.update(f).surf;
  assert.ok(arrival>baseline+.25,'rising local water must produce a distinct arrival');
  f.wave={...f.wave,level:.2};const tail=s.update(f).surf;
  assert.ok(tail<arrival&&tail>baseline,'wash releases gradually');
  for(let i=0;i<100;i++)s.update(f);
  assert.ok(s.update(f).surf<baseline+.001);
  f.wave={...f.wave,ready:false};s.update(f);
  f.wave={...f.wave,ready:true,level:2};assert.ok(s.update(f).surf<baseline+.001,'readback recovery is not an impact');
});
