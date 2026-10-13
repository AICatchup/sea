import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {IslandElevation} from '../src/world/geodata.ts';
import {TomariMeasuredCoast} from '../src/world/tomari-measured.ts';
import {TOMARI_EAST_SURVEY as data} from '../src/world/tomari-east-survey.generated.ts';
import {eastHeadlandExposure} from '../src/world/measured-rock-exposure.ts';
import {TOMARI_STRAND_POINTS} from '../src/world/tomari-strand.ts';
import {createHash} from 'node:crypto';

test('mosaicked east cliff recovers independent native TIFF heights and preserves wet ground',()=>{
 const elevation=new IslandElevation(true,true,false,true),material=new THREE.MeshStandardMaterial();
 const coast=new TomariMeasuredCoast(elevation,material,data,true);
 try{
  // Direct native TIFF bilinear probes (EPSG:6677 pixel centres), computed
  // independently of the shipped reprojection by source-probe/two-tile.py.
  const samples=[[-.1837,-95.2353,7.396649360656738],[16.519,-99.6125,11.138699531555176],[-7.9965,-97.7045,10.236910820007324]];
  for(const [x,z,y] of samples){
   const actual=coast.heightAt(x,z)!;
   assert.ok(Math.abs(actual-y)<.18,`reprojected cliff ${x},${z}: ${actual} vs native ${y}`);
   assert.ok(actual-elevation.heightAt(x,z)>3,'metre-scale dry rock cannot remain the old low strand');
  }
  const x=data.origin.x+192*data.column.x,z=data.origin.z+309*data.row.z;
  assert.ok(Math.abs(coast.heightAt(x,z)!-elevation.heightAt(x,z))<.00001,'survey below -1m retains the inferred deeper bed');
  // Native grid neighbours at the visible toe formerly fell 2.144m even
  // though the measured drop was .92m. Keep the positive rock continuous
  // through the shoreline instead of depressing it into the old sea bed.
  const tx=data.origin.x+158*data.column.x;
  const za=data.origin.z+280*data.row.z,zb=za+data.row.z;
  assert.ok(Math.abs(coast.heightAt(tx,za)!-2)<.0001);
  assert.ok(Math.abs(coast.heightAt(tx,zb)!-1.08)<.0001);
  assert.ok(Math.abs((coast.heightAt(tx,za)!-coast.heightAt(tx,zb)!)-.92)<.0001);
  assert.equal(data.sources.length,2);
  assert.equal(createHash('sha256').update(Buffer.from(data.heightsCentimetres,'base64')).digest('hex'),data.heightsSha256);
  assert.equal(data.centimetreSurveyAccuracyEstablished,false);
  assert.ok(coast.heightAt(7,-84)!<-.3,'isolated uncertain +25cm wet feature must not raise a new offshore slab');
  // No tile-edge no-data stripe can be introduced by separate reprojection.
  for(let zz=-120;zz<-70;zz+=.31)for(let xx=-8.6;xx<-6.3;xx+=.19)assert.ok(Number.isFinite(coast.heightAt(xx,zz)));
 }finally{coast.dispose();material.dispose();}
});

test('east render triangles agree with foot height and join old outer triangles',()=>{
 const elevation=new IslandElevation(true,true,false,true),material=new THREE.MeshStandardMaterial();
 const coast=new TomariMeasuredCoast(elevation,material,data,true),ray=new THREE.Raycaster(),b=coast.bounds;
 coast.group.updateMatrixWorld(true);
 try{
  for(const [x,z] of [[-.18,-95.23],[16.51,-99.61],[-7.99,-97.7],[42,-76],[73,-125],[-17,-90]]){
   ray.set(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));
   const hit=ray.intersectObject(coast.group,true)[0];assert.ok(hit);
   assert.ok(Math.abs(hit.point.y-coast.heightAt(x,z)!)<.00005);
  }
  for(let i=0;i<=48;i++){
   const u=i/48;
   for(const [x,z] of [[b.minX,b.minZ+(b.maxZ-b.minZ)*u],[b.maxX,b.minZ+(b.maxZ-b.minZ)*u],[b.minX+(b.maxX-b.minX)*u,b.minZ],[b.minX+(b.maxX-b.minX)*u,b.maxZ]]){
    assert.ok(Math.abs(coast.heightAt(x,z)!-elevation.heightAt(x,z))<.00015,`outer seam ${x},${z}`);
   }
  }
  assert.equal(coast.heightAt(b.maxX+1,-95),null);
 }finally{coast.dispose();material.dispose();}
});

test('photographic strand stays sandy while the east dry headland has a rocky toe',()=>{
 for(const [x,z] of TOMARI_STRAND_POINTS)assert.equal(eastHeadlandExposure(x,z,1.5),0);
 assert.equal(eastHeadlandExposure(0,-95,.8),1);
 assert.equal(eastHeadlandExposure(20,-110,1.2),1);
 assert.equal(eastHeadlandExposure(0,-95,-1),0,'underwater sediment is not classified as exposed rock');
});
