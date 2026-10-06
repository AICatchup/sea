import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {IslandWorld} from '../src/world/terrain.ts';

test('joined presentation skin preserves every terrain mesh, ground sample, and arrival location',()=>{
 const before=new IslandWorld(true,true,false,false,false),after=new IslandWorld(true,true,false,false,true);
 try{
  const digest=(world:IslandWorld)=>world.group.children.filter(o=>o.name.includes('DEM coast')).map(o=>{
   const geometry=(o as THREE.Mesh).geometry;
   const hash=createHash('sha256');
   for(const a of [geometry.getAttribute('position').array,geometry.index!.array])hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
   return [o.name,hash.digest('hex')];
  });
  assert.ok(digest(before).length>=3);assert.deepEqual(digest(after),digest(before));
  assert.deepEqual(after.destinations,before.destinations);assert.deepEqual(after.spawnPoint,before.spawnPoint);
  for(let z=-250;z<=240;z+=5)for(let x=-300;x<=260;x+=5)assert.equal(after.heightAt(x,z),before.heightAt(x,z));
  const skin=after.group.getObjectByName('Tomari jointed rhyolite ledges and fissures') as THREE.Mesh;
  assert.ok(skin.geometry.index!.count>0);
  assert.ok(skin.geometry.userData.minExposedVertexHeightM>3.4);
  assert.ok(skin.geometry.userData.triangleCount<80000);
  // Strand and normal swimmer body volumes stay outside the elevated shell.
  for(let z=22;z>=-120;z-=2)assert.equal(after.bodySegmentBlocked({x:-36,y:Math.max(-2,after.heightAt(-36,z)),z},{x:-36,y:Math.max(-2,after.heightAt(-36,z-2)),z:z-2}),false);
 }finally{before.dispose();after.dispose();}
});
