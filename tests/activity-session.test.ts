import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {ActivitySession} from '../src/activities/session.ts';import type {AdventureState} from '../src/world/contracts.ts';
function traveller():AdventureState{return{mode:'boat',position:new THREE.Vector3(0,1.45,0),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''};}
test('integrated reel actions count one catch and preserve existing expedition storage',()=>{
 const values=new Map([['sea.expedition.v1','old progress']]);const store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)} as unknown as Storage;
 const ground={heightAt:()=>-5},a=new ActivitySession(ground,()=>0,()=>true,store),s=traveller();a.activate(s);a.update(.02,s);a.activate(s);
 for(let i=0;i<3000&&a.catches===0;i++){const f=a.fishing.snapshot();if(f.phase==='bite'||f.phase==='reeling'&&(f.reeling&&f.tension>.70||!f.reeling&&f.tension<.32))a.activate(s);a.update(.02,s);}
 assert.equal(a.catches,1);for(let i=0;i<100;i++)a.update(.02,s);assert.equal(a.catches,1);
 const restored=new ActivitySession(ground,()=>0,()=>true,store);assert.equal(restored.catches,1);assert.equal(restored.bestFish,a.bestFish);assert.equal(restored.tool,'none');assert.equal(values.get('sea.expedition.v1'),'old progress');
 for(let i=0;i<3;i++){a.stow(s);a.activate(s);a.update(.02,s);assert.equal(a.catches,1,'putting away and picking up the same rod must not count the old catch again');}
 a.activate(s);a.update(.02,s);assert.equal(a.fishing.snapshot().phase,'casting');assert.equal(a.stow(s),true);assert.equal(a.tool,'none');assert.equal(a.fishing.snapshot().phase,'escaped');
});
test('physical board pickup, carrying and launch preserve east-positive movement and local stow',()=>{
 const ground={heightAt:(x:number)=>x<=5838?0:-3},a=new ActivitySession(ground,()=>0,()=>true),s=traveller();s.mode='walk';s.position.set(5832,1.64,-4507);s.yaw=Math.PI/2;
 a.activate(s);assert.equal(a.tool,'none');s.position.x=5836;a.activate(s);assert.equal(a.tool,'board');assert.equal(a.surf.phase,'carried');
 s.position.set(5845,.34,-4507);s.mode='swim';a.activate(s);let distance=0;
 for(let i=0;i<100;i++){const step=a.motion(.02,{x:0,forward:1},s);assert.ok(step);assert.ok(step.dx>=0);distance+=step.dx;s.position.x+=step.dx;}
 assert.ok(distance>1);assert.equal(a.surf.phase,'paddling');assert.equal(a.stow(s),true);assert.ok(Math.hypot(a.board.x-s.position.x,a.board.z-s.position.z)<=.81);assert.equal(a.surf.phase,'absent');
});

test('map pause keeps current water references without queuing a stale stand action',()=>{
 let level=0;const a=new ActivitySession({heightAt:()=>-4},(x:number)=>level+.1*x,()=>true),s=traveller();
 s.mode='swim';s.position.set(0,.4,0);s.yaw=-Math.PI/2;a.tool='board';a.surf.phase='paddling';a.surf.yaw=s.yaw;a.surf.speed=1.5;
 a.motion(.02,{x:0,forward:0},s);a.surf.catchWindow=.6;a.surf.movingWave=.6;a.activate(s);
 level=.8;a.syncPausedFrame(s);
 assert.equal(a.surf.previousWaterHeight,.8);assert.equal(a.surf.catchWindow,0);assert.equal(a.surf.movingWave,0);
 a.motion(.02,{x:0,forward:0},s);
 assert.equal(a.surf.phase,'paddling');assert.equal(a.surf.movingWave,0);
});
