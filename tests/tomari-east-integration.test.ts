import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {IslandWorld} from '../src/world/terrain.ts';
import {isNavigableWater,planWaterRoute,waterSegmentClear} from '../src/world/navigation.ts';

test('normal east survey shares render, feet and water depth and keeps every island route reachable',()=>{
 const world=new IslandWorld(true,true,false,true,true,true),ray=new THREE.Raycaster();
 try{
  assert.equal(world.tomariMeasured?.diagnostics.id,'tomari-east-tokyo-mosaic');
  world.group.updateMatrixWorld(true);
  for(const [x,z] of [[-.1837,-95.2353],[16.519,-99.6125],[19.383061,-93.245595]]){
   const y=world.heightAt(x,z);ray.set(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));
   const hits=ray.intersectObject(world.group,true);
   assert.ok(hits.length);assert.match(hits[0].object.name,/measured-grid/);
   assert.ok(Math.abs(hits[0].point.y-y)<.0001);
   assert.ok(hits.every(hit=>hit.object.name.startsWith('measured-grid')),'legacy terrain must not remain under replacement');
  }
  const map=world.waterMapFor(16,-94),p=map.texture.image as {width:number;height:number;data:Uint16Array};
  for(const [x,z] of [[0,-96],[16,-99],[20,-92],[7,-84]]){
   const i=Math.round((x-map.origin.x)/map.size.x*(p.width-1)),j=Math.round((z-map.origin.y)/map.size.y*(p.height-1));
   const xx=map.origin.x+i*map.size.x/(p.width-1),zz=map.origin.y+j*map.size.y/(p.height-1);
   assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(p.data[(j*p.width+i)*4])-world.heightAt(xx,zz))<.015);
  }
  assert.equal(isNavigableWater(world,{x:16.519,z:-99.6125}),false);
  const berth={x:-118.5950068345507,z:-90.9578943776148};assert.ok(isNavigableWater(world,berth));
  for(const destination of world.destinations.filter(d=>d.id!=='tomari')){
   const route=planWaterRoute(world,berth,destination);assert.equal(route.error,undefined,destination.id);
   for(let i=1;i<route.points.length;i++)assert.ok(waterSegmentClear(world,route.points[i-1],route.points[i]),destination.id);
  }
 }finally{world.dispose();}
});
