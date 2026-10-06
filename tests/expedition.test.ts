import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Expedition,createExpeditionMap,SAVE_KEY,segmentDistance,type Find} from '../src/game/expedition.ts';
import type {AdventureState} from '../src/world/contracts.ts';
import {IslandElevation} from '../src/world/geodata.ts';
import {ExpeditionWorld} from '../src/game/expedition-world.ts';

const ground={heightAt:(_x:number,z:number)=>z>0?.5:z>-50?-.7:-8};
const destinations=[{id:'tomari',label:'泊',island:'式根島',x:-118,z:-90,heading:0,landingX:-33,landingZ:29},{id:'nakanoura',label:'中の浦',island:'式根島',x:400,z:-90,heading:0,landingX:400,landingZ:29}];
const map=()=>createExpeditionMap(ground,destinations);
const state=():AdventureState=>({mode:'walk',position:new THREE.Vector3(-36,2.14,27),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(-118,0,-90),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',grounded:true,avatarAction:'idle'});
const lookAtFind=(s:AdventureState,f:Find)=>{const up=f.depth?.8:1.4;s.position.set(f.x,f.y+up,f.z+1);s.yaw=0;s.pitch=-Math.atan2(up,1);s.mode=f.depth?'dive':'walk';s.depth=Math.max(0,-s.position.y);};
const collect=(g:Expedition,s:AdventureState,id:string)=>{lookAtFind(s,g.map.finds.find(f=>f.id===id)!);assert.equal(g.interact(s),true,id);};
const camp=(g:Expedition,s:AdventureState)=>{s.mode='walk';s.grounded=true;s.position.set(g.map.camp.x,ground.heightAt(g.map.camp.x,g.map.camp.z)+1.64,g.map.camp.z);s.depth=0;};
const store=()=>{let value:string|null=null;return {getItem:()=>value,setItem:(key:string,next:string)=>{assert.equal(key,SAVE_KEY);value=next;}};};

test('field equipment rests on the floor and recovered objects disappear from the rendered world',()=>{
 const g=new Expedition(map(),ground),s=state(),world=new ExpeditionWorld(g);
 try{
  for(const f of g.map.finds){
   const object=world.group.getObjectByName(`Expedition record ${f.id}`)!;
   assert.ok(Math.abs(new THREE.Box3().setFromObject(object).min.y-ground.heightAt(f.x,f.z))<1e-6,f.id);
  }
  const base=new THREE.Box3().setFromObject(world.solids);
  assert.ok(Math.abs(base.min.y-ground.heightAt(g.map.camp.x,g.map.camp.z))<1e-6,'camp must not hover');
  collect(g,s,'notebook');collect(g,s,'glass');world.update(2,s,()=>.8);
  assert.equal(world.group.getObjectByName('Expedition record glass')!.visible,false);
  assert.equal(world.group.getObjectByName('Expedition record camera')!.visible,true);
  const buoy=world.group.getObjectByName('Course marker 1')!;
  assert.ok(Math.abs(buoy.position.y-.95)<1e-6,'course markers follow the actual water sample');
 }finally{world.dispose();world.dispose();}
});

test('first task has real proximity, view direction, depth and terrain visibility requirements',()=>{
 const g=new Expedition(map(),ground),s=state();assert.equal(g.target(s)?.id,'notebook');assert.equal(g.interact(s),false);
 const notebook=g.map.finds[0];lookAtFind(s,notebook);s.yaw=Math.PI;assert.equal(g.interact(s),false);
 collect(g,s,'notebook');assert.equal(g.notebook,true);assert.equal(g.cargo.length,0);
 const camera=g.map.finds.find(f=>f.id==='camera')!;lookAtFind(s,camera);s.depth=0;assert.equal(g.interact(s),false);
 s.depth=7;s.mode='boat';assert.equal(g.interact(s),false);
 const wall={heightAt:(x:number,z:number)=>z>notebook.z+.2&&z<notebook.z+.8?100:ground.heightAt(x,z)};
 const blocked=new Expedition(map(),wall);lookAtFind(s,notebook);assert.equal(blocked.interact(s),false);
});

test('finite backpack, physical delivery, once-only credits, equipment and reload form one progression loop',()=>{
 const storage=store(),g=new Expedition(map(),ground,storage),s=state();
 collect(g,s,'notebook');for(const id of ['glass','compass','camera'])collect(g,s,id);
 assert.equal(g.cargo.length,3);collect(g,s,'logger');assert.equal(g.cargo.length,3);assert.equal(g.found('logger'),false);
 assert.equal(g.credits,0,'recovered cargo is not yet banked');assert.equal(g.buy('fins',s),false);
 camp(g,s);assert.equal(g.interact(s),true);assert.equal(g.banked.length,3);assert.equal(g.credits,4);assert.equal(g.cargo.length,0);
 g.interact(s);assert.equal(g.credits,4,'repeated delivery gives no additional points');
 assert.equal(g.buy('air',s),true);assert.equal(g.credits,0);assert.equal(g.buy('air',s),false);
 const restored=new Expedition(map(),ground,storage);assert.deepEqual(restored.snapshot,g.snapshot);assert.equal(restored.hasGear('air'),true);
 lookAtFind(s,restored.map.finds.find(f=>f.id==='camera')!);assert.equal(restored.interact(s),false,'collected prop stays collected after reload');
});

test('a landing stamp needs an actual on-foot dwell and cannot be repeatedly farmed',()=>{
 const g=new Expedition(map(),ground),s=state();collect(g,s,'notebook');camp(g,s);
 s.mode='boat';for(let i=0;i<30;i++)g.update(.1,s);assert.deepEqual(g.stamps,[]);
 s.mode='walk';s.grounded=true;for(let i=0;i<10;i++)g.update(.1,s);assert.deepEqual(g.stamps,[]);
 s.position.x+=100;g.update(.1,s);camp(g,s);for(let i=0;i<16;i++)g.update(.1,s);
 assert.deepEqual(g.stamps,['tomari']);assert.equal(g.credits,2);for(let i=0;i<100;i++)g.update(.1,s);assert.equal(g.credits,2);
});

test('save validation removes unknown/duplicate entries, bounds rewards, and tolerates denied storage',()=>{
 const storage={getItem:()=>'{"version":1,"notebook":true,"banked":["glass","glass","bad"],"cargo":["glass","camera","camera"],"stamps":["tomari","unknown"],"gear":["air","fins","fins"],"bestRace":1e309}',setItem:()=>{throw Error('quota');}};
 const g=new Expedition(map(),ground,storage),s=state();assert.deepEqual(g.banked,['glass']);assert.deepEqual(g.cargo,['camera']);assert.equal(g.hasGear('air'),false);assert.equal(g.hasGear('fins'),true);assert.equal(g.credits,0);assert.equal(g.bestRace,null);
 camp(g,s);assert.doesNotThrow(()=>g.interact(s));assert.equal(g.saveStatus,'unavailable');assert.ok(g.banked.includes('camera'));
 const denied=new Expedition(map(),ground,{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});assert.equal(denied.saveStatus,'unavailable');collect(denied,s,'notebook');assert.equal(denied.notebook,true);
});

function sail(g:Expedition,s:AdventureState){
 for(const target of g.map.course.slice(1)){
  for(let i=0;i<2000&&Math.hypot(s.boatPosition.x-target.x,s.boatPosition.z-target.z)>.001;i++){
   const dx=target.x-s.boatPosition.x,dz=target.z-s.boatPosition.z,d=Math.hypot(dx,dz),step=Math.min(1,d);s.boatPosition.x+=dx/d*step;s.boatPosition.z+=dz/d*step;g.update(.1,s);
  }
 }
}
test('manual boat course requires ordered gates, rejects warps/autopilot, persists a best and pays once',()=>{
 const storage=store(),g=new Expedition(map(),ground,storage),s=state();collect(g,s,'notebook');assert.equal(g.startRace(s),false);
 s.mode='boat';s.avatarAction='helm';s.boatPosition.set(g.map.course[0].x,0,g.map.course[0].z);s.voyageTarget='nakanoura';assert.equal(g.startRace(s),false);s.voyageTarget=null;
 assert.equal(g.startRace(s),true);s.boatPosition.set(-139,0,-115);g.update(.1,s);assert.equal(g.race,null);assert.equal(g.bestRace,null);
 s.boatPosition.set(g.map.course[0].x,0,g.map.course[0].z);assert.equal(g.startRace(s),true);sail(g,s);assert.equal(g.race,null);assert.ok(g.bestRace!==null&&g.bestRace>10&&g.bestRace<90);assert.equal(g.credits,2);
 assert.equal(g.startRace(s),true);sail(g,s);assert.equal(g.credits,2);assert.equal(new Expedition(map(),ground,storage).bestRace,g.bestRace);
 assert.equal(segmentDistance({x:0,z:0},{x:10,z:0},{x:5,z:2}),2);
});

test('the actual Tomari targets sit on valid ground and all course legs have hull clearance',()=>{
 const actual=new IslandElevation(true,true,false),m=createExpeditionMap(actual,destinations);
 assert.equal(m.course.length,6);assert.ok(m.finds.find(f=>f.id==='notebook')!.y>.5);
 assert.ok(m.finds.find(f=>f.id==='capsule')!.y< -7&&m.finds.find(f=>f.id==='capsule')!.y> -10);
 assert.ok(m.finds.every(f=>Number.isFinite(f.y)&&f.y>actual.heightAt(f.x,f.z)));
});
