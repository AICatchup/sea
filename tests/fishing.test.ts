import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFishing} from '../src/activities/fishing.ts';
import type {FishingFrame} from '../src/activities/fishing.ts';
const frame:FishingFrame={player:{x:0,y:2,z:0},yaw:0,mode:'walk',speed:0,waterTarget:{x:0,y:0,z:-6,isWater:true,groundY:-2}};
function bite(seed=7){const sim=createFishing(seed);sim.update(1/60,frame,{cast:true});for(let i=0;i<600&&sim.snapshot().phase!=='bite';i++)sim.update(1/60,frame);assert.equal(sim.snapshot().phase,'bite');return sim;}
test('physical cast, deterministic waiting and achievable catch with release timing',()=>{
  const sim=createFishing(7);let s=sim.update(1/60,frame,{cast:true});assert.equal(s.phase,'casting');assert.ok(s.floatPosition!.z>-6);assert.equal(s.catch,null);
  for(let i=0;i<600&&s.phase!=='bite';i++)s=sim.update(1/60,frame);assert.equal(s.phase,'bite');s=sim.update(1/60,frame,{interact:true});let reel=true;
  for(let i=0;i<1800&&s.phase==='reeling';i++){if(s.tension>0.7)reel=false;if(s.tension<0.35)reel=true;s=sim.update(1/60,frame,{reelHeld:reel});}
  assert.equal(s.phase,'caught');assert.equal(s.progress,1);assert.ok(s.catch!.lengthCm>=15);assert.ok(s.cooldown>0);assert.equal(sim.update(1/60,frame,{cast:true}).phase,'caught');
  for(let i=0;i<130;i++)sim.update(1/60,frame);assert.equal(sim.update(1/60,frame,{cast:true}).phase,'casting');
});
test('missed bite and sustained over-tension escape',()=>{const missed=bite();for(let i=0;i<120;i++)missed.update(1/60,frame);assert.equal(missed.snapshot().phase,'escaped');const broken=bite();broken.update(1/60,frame,{interact:true});for(let i=0;i<600&&broken.snapshot().phase==='reeling';i++)broken.update(1/60,frame,{reelHeld:true});assert.equal(broken.snapshot().phase,'escaped');assert.match(broken.snapshot().message,/糸が切れ/);});
test('dry land, behind player, driving, voyage, boarding and corrupt samples refuse cast',()=>{
  for(const f of [{...frame,waterTarget:{...frame.waterTarget!,isWater:false}},{...frame,waterTarget:{...frame.waterTarget!,groundY:0}},{...frame,waterTarget:{...frame.waterTarget!,z:6}},{...frame,speed:0.9},{...frame,speed:NaN},{...frame,voyageActive:true},{...frame,boarding:true},{...frame,player:{x:NaN,y:0,z:0}}])assert.equal(createFishing().update(1/60,f,{cast:true}).phase,'idle');
});
test('pause and nonfinite/stale time neither cast nor advance simulation',()=>{const sim=bite();const before=sim.snapshot();for(const dt of [0,-1,NaN,Infinity,10])assert.deepEqual(sim.update(dt,frame,{interact:true}),before);assert.equal(createFishing().update(0,frame,{cast:true}).phase,'idle');});
test('moving away, boarding, switching modes or driving cancels an active line',()=>{for(const f of [{...frame,player:{x:3,y:2,z:0}},{...frame,boarding:true},{...frame,mode:'boat' as const},{...frame,speed:1}]){const sim=bite();assert.equal(sim.update(1/60,f).phase,'escaped');}});
test('boat fishing and seeded variation are reproducible; snapshots are detached',()=>{const a=bite(2),b=bite(2);assert.deepEqual(a.snapshot(),b.snapshot());const s=a.snapshot();s.floatPosition!.x=99;assert.notEqual(a.snapshot().floatPosition!.x,99);const boat=createFishing(8);assert.equal(boat.update(1/60,{...frame,mode:'boat'},{cast:true}).phase,'casting');});
