import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuralCoastHeight } from '../src/world/coast-structure.ts';
import { IslandElevation } from '../src/world/geodata.ts';
import { IslandWorld } from '../src/world/terrain.ts';
import { planWaterRoute,waterSegmentClear } from '../src/world/navigation.ts';
const slope=(x:number,_z:number)=>5+x*1.5;
const sample=(x:number,z:number,y:number,sand=0,toe=true)=>structuralCoastHeight(x,z,y,slope,sand,true,toe);
test('dry toe preserves low, sandy, crown and gentle source anchors',()=>{
 for(const y of [-8,0,1.1,10,30,62,70])assert.equal(sample(2,3,y),sample(2,3,y,0,false));
 for(const y of [2,4,7])assert.equal(sample(2,3,y,1),sample(2,3,y,1,false));
 assert.equal(structuralCoastHeight(2,3,5,()=>5,0,true,true),5);
});
test('dry toe erosion is finite, bounded and continuous with meaningful low-face relief',()=>{
 let impact=0;
 for(let z=-25;z<25;z+=.2)for(const y of [1.1001,2,3,5,7,9.9999]){
  const a=sample(0,z,y),legacy=sample(0,z,y,0,false);
  assert.ok(Number.isFinite(a));assert.ok(Math.abs(a-legacy)<=1.100000001);
  assert.ok(Math.abs(sample(0,z+.00001,y)-a)<.001);
  assert.ok(Math.abs(sample(0,z,y+.00001)-a)<.001);
  impact=Math.max(impact,Math.abs(a-legacy));
 }
 assert.ok(impact>.5,`foot impact ${impact}`);
});
test('actual shared raster field changes dry foot while retaining source raster joins',()=>{
 const old=new IslandElevation(true),toe=new IslandElevation(true,true);
 const r=toe.tomari!.raster;
 for(const [x,z] of [[r.minX,80],[r.maxX,80],[-100,r.minZ],[-100,r.maxZ]])assert.equal(toe.heightAt(x,z),old.heightAt(x,z));
 let changed=0,max=0;
 const a=old.coast!,b=toe.coast!;
 for(let i=0;i<a.ground.length;i++){
  const delta=Math.abs(a.ground[i]-b.ground[i]);assert.ok(Number.isFinite(b.ground[i]));
  max=Math.max(max,delta);if(delta>.05)changed++;
 }
 assert.ok(max>.2,`raster max ${max}`);assert.ok(max<=1.101);assert.ok(changed>50,`changed vertices ${changed}`);
 console.log(JSON.stringify({changedVertices:changed,maxToeDelta:max}));
 for(let z=b.minZ;z<=b.maxZ;z+=10)assert.equal(b.heightAt(b.minX,z),a.heightAt(a.minX,z));
});
test('actual triangle interpolation retains every sampled wet and low coastal point',()=>{
 const old=new IslandElevation(true),toe=new IslandElevation(true,true),c=old.coast!;let checked=0;
 for(let z=c.minZ;z<c.maxZ;z+=.75)for(let x=c.minX;x<c.maxX;x+=.75){const height=old.heightAt(x,z);if(height>1.1)continue;assert.equal(toe.heightAt(x,z),height);checked++;}
 assert.ok(checked>10000);
});
test('steep photographic rock foot is not flattened as sand, while legacy rock disables the whole candidate',()=>{
 const old=new IslandElevation(true),toe=new IslandElevation(true,true);
 assert.ok(Math.abs(toe.heightAt(-92.829,-26.415)-old.heightAt(-92.829,-26.415))>.1);
 const legacy=new IslandElevation(false),disabled=new IslandElevation(false,true);
 assert.equal(disabled.dryToe,false);assert.deepEqual(disabled.coast!.ground,legacy.coast!.ground);assert.deepEqual(disabled.beach!.ground,legacy.beach!.ground);
});
test('candidate ground and generated rock volumes keep the strand and island voyage corridors open',()=>{
 const world=new IslandWorld(true,true);
 try{
  for(let z=27;z>-32;z-=2)assert.equal(world.bodySegmentBlocked({x:-36,y:1,z},{x:-36,y:1,z:z-2}),false);
  for(const destination of world.destinations){
   const route=planWaterRoute(world,{x:-142,z:-97},destination);assert.equal(route.error,undefined,destination.id);
   for(let i=1;i<route.points.length;i++){
    assert.ok(waterSegmentClear(world,route.points[i-1],route.points[i]),destination.id);
    assert.equal(world.bodySegmentBlocked({...route.points[i-1],y:-.2},{...route.points[i],y:-.2},1.4,1.7),false,destination.id);
   }
  }
 }finally{world.dispose();}
});

