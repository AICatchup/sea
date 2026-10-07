import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {MeasuredNiijimaTile} from '../src/world/niijima-measured.ts';
import {NIIJIMA_NATIVE_SURVEY as source} from '../src/world/niijima-survey-native.generated.ts';
import {createMeasuredGridPatch} from '../src/world/measured-grid-patch.ts';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';

test('native provider samples are pinned and remain on their unresampled coordinate lattice',()=>{
  const raw=Buffer.from(source.heightsCentimetres,'base64');
  assert.equal(createHash('sha256').update(raw).digest('hex'),source.heightsSha256);
  const tile=new MeasuredNiijimaTile(),grid=tile.grid;
  assert.equal(grid.width*grid.height,1920000);
  for(let i=0;i<grid.heights.length;i+=97)assert.ok(Math.abs(grid.heights[i]-raw.readInt16LE(i*2)*.01)<.00002);
  assert.equal(source.centimetreSurveyAccuracyEstablished,false);
  assert.equal(source.datumTransformAccuracyMetres,1);
  assert.ok(source.numericalComparison.maximumVertexErrorMetres<.007);
  // Registration checks use the pure survey interior, without the production
  // 32m join into a different dataset. The separate integration test covers it.
  const material=new THREE.MeshStandardMaterial(),patch=createMeasuredGridPatch(grid,{heightAt:()=>-30},material,{blendStartMetres:0,blendEndMetres:1});
  try{
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/niijima-measured-reference.json',import.meta.url),'utf8'));
    assert.equal(fixture.sourceSha256,source.sourceTiffSha256);
    for(const p of fixture.samples){const h=patch.surfaceHeightAt(p.x,p.z);assert.notEqual(h,null);assert.ok(Math.abs(h!-p.height)<.025,`native sample registration at ${p.x},${p.z}`);}
    assert.equal(patch.diagnostics.maxUnblendedHeightError,0);
    assert.equal(patch.diagnostics.nativeSamples,1920000);
  }finally{patch.dispose();material.dispose();}
});

test('measured coast cutout and map handoff keep the visible floor and whole shore-solver domain',()=>{
  const material=new THREE.MeshStandardMaterial(),coast=new NiijimaCoast({heightAt:()=>-30},material,{coastConfidence:true,measured:true});
  try{
    assert.ok(coast.measuredPatch);assert.ok(coast.cliffReplacement.removedTriangles>50000);
    coast.group.updateMatrixWorld(true);const ray=new THREE.Raycaster();
    for(const [x,z]of [[5867.738,-986.716],[5898,-923.918],[5907,-923.918],[5590.533134,-914.900388],[5934,-957]]){
      ray.set(new THREE.Vector3(x,400,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(coast.group,true);
      assert.ok(hits.length);assert.ok(Math.abs(hits[0].point.y-coast.heightAt(x,z))<.002);
    }
    const map=coast.waterMap(5940,-950),image=map.texture.image as {width:number;height:number;data:Uint16Array};
    const dx=map.size.x/image.width,dz=map.size.y/image.height;
    // At a tile transition, the camera can be half a stride from the centre.
    // 96m SWE half-span plus a cell/stencil guard must still be inside the map.
    assert.ok((image.width-1024)*dx/2>98);assert.ok((image.height-1024)*dz/2>98);
    for(const [x,z]of [[5898,-923.918],[5907,-923.918],[5934,-957]]){
      const ix=Math.round((x-map.origin.x)/dx-.5),iz=Math.round((z-map.origin.y)/dz-.5);
      const px=map.origin.x+(ix+.5)*dx,pz=map.origin.y+(iz+.5)*dz;
      assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(image.data[(iz*image.width+ix)*4])-coast.heightAt(px,pz))<.003);
    }
  }finally{coast.dispose();material.dispose();}
});
