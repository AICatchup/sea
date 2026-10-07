import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';
import {createNiijimaCliffSkin} from '../src/world/niijima-cliff-skin.ts';

test('actual Niijima replacement, shoreline and water texels share the visible terrain',()=>{
  const material=new THREE.MeshStandardMaterial();
  const coast=new NiijimaCoast({heightAt:()=>-30},material,{coastConfidence:true});
  const skin=createNiijimaCliffSkin({heightAt:(x,z)=>coast.baseHeightAt(x,z)},material,{faceSteps:144,meso:true});
  try{
    const base=coast.baseHeightAt(5882.6,-1318.3);
    coast.replaceCliffSurface(skin);
    assert.ok(coast.cliffReplacement.removedTriangles>10000);
    assert.equal(coast.baseHeightAt(5882.6,-1318.3),base,'source surface must remain immutable');
    assert.ok(Math.abs(coast.heightAt(5882.6,-1318.3)-base)>.1);
    coast.group.updateMatrixWorld(true);skin.group.updateMatrixWorld(true);
    const ray=new THREE.Raycaster();
    // Independent downward ray against the actual retained terrain + closed skin.
    // Includes cut interior, an endpoint, the user's slope, and the former false sea ridge.
    for(const [x,z]of [[5882.6,-1318.3],[5868.34,-1236.6],[5811.3,-1073.2],[5839.82,-991.5],
      [5867.738,-986.716],[5890,-1125],[5898,-923.918],[5907,-923.918],[5920,-1321]]){
      ray.set(new THREE.Vector3(x,400,z),new THREE.Vector3(0,-1,0));
      const hits=ray.intersectObjects([...coast.group.children,...skin.group.children],false);
      assert.ok(hits.length,`missing render floor at ${x},${z}`);
      assert.ok(Math.abs(hits[0].point.y-coast.heightAt(x,z))<.002,`render/floor mismatch at ${x},${z}`);
    }
    const map=coast.waterMap(5890,-1125),image=map.texture.image as {width:number;height:number;data:Uint16Array};
    const dx=map.size.x/image.width,dz=map.size.y/image.height;
    for(const [x,z]of [[5890,-1125],[5898,-923.918],[5907,-923.918],[5920,-1321]]){
      const ix=Math.round((x-map.origin.x)/dx-.5),iz=Math.round((z-map.origin.y)/dz-.5);
      const px=map.origin.x+(ix+.5)*dx,pz=map.origin.y+(iz+.5)*dz;
      const actual=THREE.DataUtils.fromHalfFloat(image.data[(iz*image.width+ix)*4]);
      assert.ok(Math.abs(actual-coast.heightAt(px,pz))<.004,'near-shore water depth must use the current source repair');
    }
  }finally{skin.dispose();coast.dispose();material.dispose();}
});
