import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';
import {createNiijimaCliffSkin} from '../src/world/niijima-cliff-skin.ts';

test('native-backed inferred cliff retains source, shares visible floor and water contact, and stays bounded',()=>{
 const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide});
 const coast=new NiijimaCoast({heightAt:()=>-30},material,{measured:true,coastConfidence:true});
 const native=coast.measuredPatch!,source=new Map<string,number>();
 const sample=(x:number,z:number)=>native.surfaceHeightAt(x,z)??coast.baseHeightAt(x,z);
 const skin=createNiijimaCliffSkin({heightAt:sample},material,{zMin:-1070,zMax:-960,eastX:5950,westX:5810,sampleX:.25,alongZ:.5,faceSteps:512,chunkLength:120,meso:true,geology:true,topLimit:85});
 try{
  assert.ok(skin.diagnostics.frontTriangles>10000,JSON.stringify(skin.diagnostics));assert.ok(skin.diagnostics.maxCarving<=.800001);assert.ok(skin.diagnostics.maxRelief<=.300001);
  const coordinates:number[][]=[];for(let z=-1050;z<=-980;z+=10)for(let x=5850;x<=5895;x+=3){coordinates.push([x,z]);source.set(`${x},${z}`,sample(x,z));}
  const original=coast.measured!.grid.heights.slice();skin.group.updateMatrixWorld(true);
  native.replaceInteriorSurface(skin,new THREE.Box3().setFromObject(skin.group));coast.invalidateWaterMaps();
  assert.ok(native.diagnostics.replacement!.removedTriangles>10000);
  assert.deepEqual(coast.measured!.grid.heights,original,'source samples are immutable');
  coast.group.updateMatrixWorld(true);const ray=new THREE.Raycaster();let changed=0,checks=0;
  for(const [x,z]of coordinates){
   const y=coast.heightAt(x,z);if(Math.abs(y-source.get(`${x},${z}`)!)>.02)changed++;
   if(checks++%5!==0)continue;
   ray.set(new THREE.Vector3(x,400,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObjects([...native.group.children,...skin.group.children],false);
   assert.ok(hits.length);assert.ok(Math.abs(y-hits[0].point.y)<.005,`native/render mismatch ${x},${z}: ${y}/${hits[0].point.y}`);
  }
  assert.ok(changed>5,'actual native-backed relief must change the visible surface');
  const map=coast.waterMap(5890,-1020),image=map.texture.image as {width:number;height:number;data:Uint16Array};
  for(const [x,z]of [[5880,-1030],[5885,-1020],[5895,-990]]){
   const ix=Math.round((x-map.origin.x)/(map.size.x/image.width)-.5),iz=Math.round((z-map.origin.y)/(map.size.y/image.height)-.5);
   const px=map.origin.x+(ix+.5)*map.size.x/image.width,pz=map.origin.y+(iz+.5)*map.size.y/image.height;
   const actual=THREE.DataUtils.fromHalfFloat(image.data[(iz*image.width+ix)*4]);
   assert.ok(Math.abs(actual-coast.heightAt(px,pz))<.08,'half-float water depth must use the replaced floor');
  }
 }finally{skin.dispose();coast.dispose();material.dispose();}
});
