import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';
import {NiijimaPointCliff,pointCliffCoverage} from '../src/world/niijima-point-cliff.ts';
import {WorldCollision} from '../src/world/world-collision.ts';
import {createMeasuredGridPatch} from '../src/world/measured-grid-patch.ts';

const readAsset=async(url:string)=>{const b=await readFile(new URL(url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;};

test('actual expanded continuous LiDAR study shares native floor, water map and static mesh collision with source intact',async()=>{
 const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),coast=new NiijimaCoast({heightAt:()=>-30},material,{measured:true,coastConfidence:true});
 const original=coast.measured!.grid.heights.slice(),native=coast.measuredPatch!;
 const coordinates:number[][]=[];for(let z=-1057.137;z< -973;z+=17.23)for(let x=5843.113;x<5890;x+=7.19)coordinates.push([x,z]);
 coordinates.push([5900,-1015],[5888,-1069],[5888,-961],[5850,-1050],[5875,-1020]);
 const baseline=coordinates.map(([x,z])=>coast.heightAt(x,z));
 const cliff=new NiijimaPointCliff(native,material,{colorAt:(x,y,z,c)=>coast.colorAt(x,y,z,c),invalidateWaterMaps:()=>coast.invalidateWaterMaps(),loadBuffer:readAsset,expanded:true});
 const collision=new WorldCollision();
 try{
  await cliff.ready;assert.equal(cliff.diagnostics.state,'ready',JSON.stringify(cliff.diagnostics));assert.equal(cliff.diagnostics.removedNativeTriangles,414399);assert.equal(cliff.diagnostics.renderTriangles,606336);
  assert.deepEqual(coast.measured!.grid.heights,original);
  const mesh=cliff.group.children[0] as THREE.Mesh;coast.group.updateMatrixWorld(true);cliff.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster();
  let changes=0,maxError=0,checked=0;for(const [x,z]of coordinates){
   ray.set(new THREE.Vector3(x,300,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObjects([...native.group.children,...cliff.group.children],false);
   assert.ok(hits.length,`render floor missing ${x},${z}`);const y=coast.heightAt(x,z),error=Math.abs(y-hits[0].point.y);maxError=Math.max(maxError,error);
   assert.ok(error<.005,`render/floor mismatch ${x},${z}: ${y}/${hits[0].point.y}`);
   if(Math.abs(y-baseline[checked++])>.005)changes++;
  }
  assert.ok(changes>5);
  const map=coast.waterMap(5880,-1020),image=map.texture.image as {width:number;height:number;data:Uint16Array};
  for(const [px,pz]of [[5880,-1030],[5885,-1020],[5895,-990]]){
   const ix=Math.round((px-map.origin.x)/(map.size.x/image.width)-.5),iz=Math.round((pz-map.origin.y)/(map.size.y/image.height)-.5);
   const x=map.origin.x+(ix+.5)*map.size.x/image.width,z=map.origin.y+(iz+.5)*map.size.y/image.height;
   assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(image.data[(iz*image.width+ix)*4])-coast.heightAt(x,z))<.08);
  }
  collision.addMesh(mesh,mesh.matrixWorld);
  assert.ok(collision.stats.triangles>600_000 && collision.stats.triangles<=606336);
  assert.equal(cliff.group.children.length,1);assert.equal(cliff.diagnostics.stitch,null);
  let wallChecks=0;for(const z of [-1055,-1035,-1015,-995,-975]){
   ray.set(new THREE.Vector3(5900,12,z),new THREE.Vector3(-1,0,0));const hit=ray.intersectObject(mesh,false)[0];if(!hit)continue;
   const sweep=collision.sweepBody({x:hit.point.x+1.2,y:11.2,z},{x:hit.point.x-1.2,y:11.2,z},.3,1.7);
   assert.equal(sweep.blocked,true,`actual cliff contact ${z}`);wallChecks++;
  }
  assert.ok(wallChecks>=3);console.log(JSON.stringify({scope:'CPU native/render floor rays and static surface sweeps; no browser movement or photoreal acceptance',rayChecks:coordinates.length,maxRayErrorM:maxError,wallChecks,cliff:cliff.diagnostics}));
 }finally{collision.dispose();cliff.dispose();coast.dispose();material.dispose();}
});
