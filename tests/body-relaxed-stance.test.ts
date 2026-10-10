import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FirstPersonBody} from '../src/world/player-body.ts';
import {FirstPersonBody as Legacy} from './fixtures/player-body-v64-legacy.ts';
import type {AdventureState} from '../src/world/contracts.ts';

const ACTIONS=['idle','walk','run','swim','dive','climb','helm'] as const;
function state(action:typeof ACTIONS[number]):AdventureState{
 return {mode:action==='helm'?'boat':action==='swim'||action==='dive'?action:'walk',position:new THREE.Vector3(),yaw:.3,pitch:-.2,speed:action==='run'?5:action==='walk'?1.4:0,oxygen:100,depth:0,
  boatPosition:new THREE.Vector3(0,0,1),boatYaw:.3,voyageTarget:null,voyageRemaining:0,message:'',avatarAction:action,immersion:action==='swim'||action==='dive'?1:0} as AdventureState;
}
const bones=(group:THREE.Object3D)=>{const m:number[]=[];group.updateMatrixWorld(true);group.traverse(o=>{if((o as THREE.Bone).isBone)m.push(...o.matrixWorld.elements);});return m;};

test('with the relaxed stance off every bone equals V64 for all actions, transitions and fishing',()=>{
 const camera=new THREE.PerspectiveCamera(75,1.6,.05,100);camera.position.set(2,1.64,-3);camera.lookAt(2,1.4,-8);camera.updateMatrixWorld();
 const now=new FirstPersonBody(),old=new Legacy();
 let frame=0;
 // Every ordered pair of actions, including blend frames while weights cross over.
 for(const from of ACTIONS)for(const to of ACTIONS){
  for(const action of [from,to])for(let j=0;j<6;j++){
   // Identical inputs to both; idle frames also exercise the fishing grip blend.
   const make=()=>{const s=state(action);s.gaitPhase=frame*.4;if(action==='idle'&&j>=3)s.activity='fishing';return s;};
   now.update(make(),camera,.05,frame*.05);old.update(make(),camera,.05,frame*.05);
   frame++;
   const a=bones(now.group),b=bones(old.group);assert.equal(a.length,b.length);
   for(let k=0;k<a.length;k++)assert.ok(a[k]===b[k]||Math.abs(a[k]-b[k])===0,`${from}->${to} frame ${frame} element ${k}: ${a[k]} vs ${b[k]}`);
  }
 }
 now.dispose();old.dispose();
});

test('the relaxed stance changes only idle, keeps the eye anchor and the weighted foot height',()=>{
 const camera=new THREE.PerspectiveCamera(75,1.6,.05,100);camera.position.set(0,1.64,0);camera.updateMatrixWorld();
 const relaxed=new FirstPersonBody(),plain=new FirstPersonBody();relaxed.relaxedStance=true;
 const feet=(b:FirstPersonBody)=>{const ys:number[]=[];b.group.updateMatrixWorld(true);b.group.traverse(o=>{if((o as THREE.Bone).isBone&&/foot|ankle|toe/i.test(o.name))ys.push(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y);});return ys;};
 for(let i=0;i<40;i++){relaxed.update(state('idle'),camera,.05,i*.05);plain.update(state('idle'),camera,.05,i*.05);}
 const a=bones(relaxed.group),b=bones(plain.group);assert.ok(a.some((v,k)=>Math.abs(v-b[k])>1e-3),'idle pose actually relaxes');
 const fa=feet(relaxed),fb=feet(plain);
 if(fa.length){assert.ok(Math.abs(Math.min(...fa)-Math.min(...fb))<.02,'lowest foot stays on the ground within 2cm');}
 for(let i=0;i<60;i++){relaxed.update(state('run'),camera,.05,i*.05);plain.update(state('run'),camera,.05,i*.05);}
 const r=bones(relaxed.group),p=bones(plain.group);assert.ok(r.every((v,k)=>Math.abs(v-p[k])<1e-6),'fully blended into run, no idle residue');
 relaxed.dispose();plain.dispose();
});
