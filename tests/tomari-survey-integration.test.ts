import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {IslandWorld} from '../src/world/terrain.ts';
import {isNavigableWater,planWaterRoute,waterSegmentClear} from '../src/world/navigation.ts';

test('measured dry-foot correction reaches actual world render, bathymetry and routes',()=>{
 const saved=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('http://example.test/?tomarisurvey=1')});
 let world:IslandWorld|undefined;
 try{
  world=new IslandWorld(true,true,false,true,true,true);assert.ok(world.tomariMeasured);assert.equal(world.cliffVolume,null);
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/tomari-dry-rock-source.json',import.meta.url),'utf8'));
  world.group.updateMatrixWorld(true);const ray=new THREE.Raycaster();
  for(const p of fixture.samples){
   const h=world.heightAt(p.x,p.z);assert.ok(Math.abs(h-p.height)<.15);
   ray.set(new THREE.Vector3(p.x,80,p.z),new THREE.Vector3(0,-1,0));
   const hits=ray.intersectObject(world.group,true);
   assert.ok(hits.length);assert.match(hits[0].object.name,/measured-grid/);assert.ok(Math.abs(hits[0].point.y-h)<.002);
   assert.ok(hits.every(hit=>hit.object.name.startsWith('measured-grid')),'legacy geometry remains in replacement footprint');
  }
  const map=world.waterMapFor(-87,-37),pixels=map.texture.image as {width:number;height:number;data:Uint16Array};
  for(const p of fixture.samples){
   const i=Math.round((p.x-map.origin.x)/map.size.x*(pixels.width-1)),j=Math.round((p.z-map.origin.y)/map.size.y*(pixels.height-1));
   const x=map.origin.x+i*map.size.x/(pixels.width-1),z=map.origin.y+j*map.size.y/(pixels.height-1);
   const textureHeight=THREE.DataUtils.fromHalfFloat(pixels.data[(j*pixels.width+i)*4]);
   assert.ok(textureHeight>3,'water map must not retain the old low beach');
   assert.ok(Math.abs(textureHeight-world.heightAt(x,z))<.01,'shader bathymetry samples actual new ground');
  }
  const berth={x:-118.5950068345507,z:-90.9578943776148};assert.ok(isNavigableWater(world,berth));
  let checked=0;
  for(const destination of world.destinations.filter(d=>d.id!=='tomari')){
   const route=planWaterRoute(world,berth,destination);assert.equal(route.error,undefined,destination.id);
   for(let i=1;i<route.points.length;i++)assert.ok(waterSegmentClear(world,route.points[i-1],route.points[i]),`${destination.id} segment${i}`);
   checked++;
  }
  assert.ok(checked>=3);assert.equal(isNavigableWater(world,{x:fixture.samples[0].x,z:fixture.samples[0].z}),false);
 }finally{world?.dispose();if(saved)Object.defineProperty(globalThis,'location',saved);else Reflect.deleteProperty(globalThis,'location');}
});
