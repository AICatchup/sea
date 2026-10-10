import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FoliageLodField as Current} from '../src/world/foliage-lod.ts';
import {FoliageLodField as Legacy} from './fixtures/foliage-lod-v62-legacy.ts';
import {levels,placements,snapshot} from './fixtures/foliage-v62-harness.ts';
test('v62 exact legacy equivalence across selection, lifecycle and view changes',()=>{
 for(const distant of [false,true])for(const viewAware of [false,true])for(const preserveCrowns of [false,true]){
 const source=levels(distant),matrices=placements(360),settings={nearDistance:60,midDistance:160,nearCapacity:12,midCapacity:60,triangleBudget:25000,viewAware,preserveCrowns,nearPixels:80,midPixels:35,farPixels:12};
 const a=new THREE.Group(),b=new THREE.Group(),old=new Legacy(a,'field',source,matrices,settings),now=new Current(b,'field',source,matrices,settings);
 const compare=()=>assert.deepEqual(snapshot(b),snapshot(a));compare();
 for(let i=0;i<16;i++){const pos=new THREE.Vector3(i*22,1.7,i*-11),forward=new THREE.Vector3(Math.sin(i),.3,Math.cos(i));old.update(pos,i%3===0,forward,i%2?500:800);now.update(pos,i%3===0,forward,i%2?500:800);compare();old.update(pos,false,forward,i%2?500:800);now.update(pos,false,forward,i%2?500:800);compare();}
 const dynamic=placements(20);old.setDynamic(dynamic);now.setDynamic(dynamic);old.update(new THREE.Vector3(),false,new THREE.Vector3(1,0,0),700);now.update(new THREE.Vector3(),false,new THREE.Vector3(1,0,0),700);compare();
 const replacement=levels(distant);old.replaceLevels(replacement);now.replaceLevels(replacement);assert.ok(Object.values((now as any).matrixBuckets).every((x:any)=>x.length===0));old.update(new THREE.Vector3(20,2,30),false,new THREE.Vector3(0,0,-1),400);now.update(new THREE.Vector3(20,2,30),false,new THREE.Vector3(0,0,-1),400);compare();
 old.dispose();now.dispose();assert.ok(Object.values((now as any).matrixBuckets).every((x:any)=>x.length===0));compare();old.update(new THREE.Vector3(),true);now.update(new THREE.Vector3(),true);compare();
 }
});
