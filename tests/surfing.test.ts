import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurfState, stepSurfing} from '../src/activities/surfing.ts';
import type {SurfInput, SurfState} from '../src/activities/surfing.ts';
const base: SurfInput = {dt: .02, playerPosition: {x: 0,z: 0}, boardPosition: {x: 0,z: 0}, waterHeight: 0, waterGradient: {x: 0,z: 0}, waveReady: true, groundDepth: 2, shoreward: {x: 0,z: -1}, forward: 1, steer: 0};
function paddle() {return stepSurfing(stepSurfing(createSurfState(), {...base,pickup:true}).state, {...base,launch:true}).state;}
test('east-positive heading agrees with the FPS controller coordinate system',()=>{
 const s={...paddle(),yaw:Math.PI/2};const out=stepSurfing(s,base);assert.ok(out.displacement.x>0);assert.ok(Math.abs(out.displacement.z)<1e-8);
});
function run(s: SurfState, seconds: number, extra: Partial<SurfInput> = {}, dt = .02) {
  let x=0,z=0; for(let i=0;i<Math.round(seconds/dt);i++){const o=stepSurfing(s,{...base,...extra,dt});s=o.state;x+=o.displacement.x;z+=o.displacement.z;} return {state:s,x,z};
}
const wave = {waterGradient:{x:0,z:.15},waterVerticalVelocity:.2};
function riding() {let s=run(paddle(),1,wave).state;return stepSurfing(s,{...base,...wave,stand:true}).state;}
test('pickup is proximity gated and launch requires usable water',()=>{
 assert.equal(stepSurfing(createSurfState(),{...base,pickup:true,boardPosition:{x:10,z:0}}).state.phase,'absent');
 const carried=stepSurfing(createSurfState(),{...base,pickup:true}).state;
 assert.equal(carried.phase,'carried'); assert.equal(stepSurfing(carried,{...base,launch:true,waveReady:false}).state.phase,'carried');
 assert.equal(paddle().phase,'paddling');
});
test('flat water and static slope cannot power surfing',()=>{
 const a=run(paddle(),10,{stand:true}).state;assert.equal(a.phase,'paddling');assert.ok(a.speed<=2);
 const b=run(paddle(),10,{stand:true,waterGradient:{x:0,z:.15},waterVerticalVelocity:0}).state;assert.equal(b.phase,'paddling');
});
test('moving wave opens stand window and accelerates, readiness loss is recoverable',()=>{
 const s=riding();assert.equal(s.phase,'riding');assert.ok(run(s,2,wave).state.speed>s.speed);
 const o=stepSurfing(s,{...base,waveReady:false});assert.equal(o.state.phase,'wipeout');assert.deepEqual(o.displacement,{x:0,z:0});
 const rested=run(o.state,1).state;assert.equal(stepSurfing(rested,{...base,recover:true}).state.phase,'paddling');
});
test('sustained hard turning loses balance, gentle turning remains viable',()=>{
 assert.equal(run(riding(),5,{...wave,steer:1}).state.phase,'wipeout');
 assert.equal(run(riding(),1,{...wave,steer:.15}).state.phase,'riding');
});
test('shallow water ends ride without displacement or teleport',()=>{
 const o=stepSurfing(riding(),{...base,...wave,groundDepth:.1});assert.equal(o.state.phase,'carried');assert.equal(o.state.speed,0);assert.deepEqual(o.displacement,{x:0,z:0});
});
test('invalid numeric inputs and oversized frames stay finite and bounded',()=>{
 const corrupt={...riding(),speed:Infinity,yaw:NaN,balance:NaN,rideTime:Infinity};
 const o=stepSurfing(corrupt,{...base,dt:Infinity,waterHeight:NaN,waterGradient:{x:NaN,z:Infinity},shoreward:{x:NaN,z:Infinity},steer:NaN,forward:Infinity});
 for(const v of Object.values(o.state)) if(typeof v==='number')assert.ok(Number.isFinite(v));
 for(const v of [...Object.values(o.displacement),...Object.values(o.velocity),o.eyeHeight,o.boardPitch,o.boardRoll])assert.ok(Number.isFinite(v));
 const bounded=stepSurfing(riding(),{...base,...wave,dt:100});assert.ok(Math.hypot(bounded.displacement.x,bounded.displacement.z)<=.96);
});
test('constant wave integration is consistent at 30/60/120 fps',()=>{
 const start=riding();const a=run(start,2,wave,1/30),b=run(start,2,wave,1/60),c=run(start,2,wave,1/120);
 assert.ok(Math.abs(a.z-b.z)<.08);assert.ok(Math.abs(a.z-c.z)<.08);assert.ok(Math.abs(a.state.speed-c.state.speed)<.02);
});
test('five-Hz wave cache drives the interval between samples, then expires when the crest stops',()=>{
 let s=riding();for(let i=0;i<300;i++)s=stepSurfing(s,{...base,...wave,waterVerticalVelocity:i%10===0?.2:0}).state;
 assert.equal(s.phase,'riding');assert.ok(s.rideDistance>20);assert.ok(s.speed>2);
 for(let i=0;i<650;i++)s=stepSurfing(s,{...base,...wave,waterVerticalVelocity:0}).state;
 assert.equal(s.phase,'wipeout');
});
