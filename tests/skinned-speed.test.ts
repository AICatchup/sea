import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonBody } from '../src/world/player-body.ts';
import { SkinnedReceivers } from '../src/ocean/skinned-receivers.ts';
import type { AdventureState } from '../src/world/contracts.ts';
test('actual-body moving pose benchmark',()=>{
 const body=new FirstPersonBody(),camera=new THREE.PerspectiveCamera();camera.position.set(0,1.64,0);
 const state={mode:'walk',position:new THREE.Vector3(),yaw:0,pitch:0,speed:4,oxygen:100,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''} as AdventureState;
 body.update(state,camera,.08,0);const r=new SkinnedReceivers(body.group);const result:Record<string,object>={};
 for(const action of ['idle','walk','run','swim','dive','helm','climb'] as const){const samples:number[]=[];
 for(let j=0;j<70;j++){state.avatarAction=action;state.gaitPhase=j*.13;state.immersion=action==='swim'||action==='dive'?1:0;body.update(state,camera,.016,j*.016);r.update();assert.ok(r.diagnostics.available,r.diagnostics.reason);if(j>=10)samples.push(r.diagnostics.timeMs);}
 samples.sort((a,b)=>a-b);result[action]={median:samples[30],p95:samples[57],max:samples[59]};}
 console.log(JSON.stringify({movingPoseMs:result,vertices:r.diagnostics.vertices,triangles:r.diagnostics.triangles}));r.dispose();body.dispose();
});
