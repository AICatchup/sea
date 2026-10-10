import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {IslandElevation} from '../src/world/geodata.ts';
import {TomariMeasuredCoast} from '../src/world/tomari-measured.ts';
import {TOMARI_SURVEY as data} from '../src/world/tomari-survey.generated.ts';
import {cliffOutcrops,type CliffCollisionProxy} from '../src/world/cliff-detail.ts';

const elevation=new IslandElevation(true,true,false,true),material=new THREE.MeshStandardMaterial();
const measured=new TomariMeasuredCoast(elevation,material);
after(()=>{measured.dispose();material.dispose();});

test('Tokyo derivative has intact payload and declares reprojection/precision limits',()=>{
 const bytes=Buffer.from(data.heightsCentimetres,'base64');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),data.heightsSha256);
 assert.equal(bytes.length,data.width*data.height*2);
 assert.equal(data.runtimeReprojected,true);assert.equal(data.centimetreSurveyAccuracyEstablished,false);
 assert.equal(data.nativeSpacingMetres,.25);assert.equal(data.license,'CC BY 4.0');
});
test('patch boundary coincides with both existing terrain lattices',()=>{
 for(const g of [elevation.coast!,elevation.beach!]){
  for(const x of [measured.bounds.minX,measured.bounds.maxX])assert.ok(Math.abs((x-g.minX)/g.dx-Math.round((x-g.minX)/g.dx))<1e-8);
  for(const z of [measured.bounds.minZ,measured.bounds.maxZ])assert.ok(Math.abs((z-g.minZ)/g.dz-Math.round((z-g.minZ)/g.dz))<1e-8);
 }
});
test('render triangle centroids and sampled footing agree, including chunk edges',()=>{
 let count=0;
 measured.group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
  const p=o.geometry.getAttribute('position'),idx=o.geometry.index!;
  for(const k of [0,3,Math.floor(idx.count/6)*3,idx.count-3]){
   const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)];
   const x=ids.reduce((s,n)=>s+p.getX(n),0)/3+o.position.x,z=ids.reduce((s,n)=>s+p.getZ(n),0)/3+o.position.z,y=ids.reduce((s,n)=>s+p.getY(n),0)/3;
   const h=measured.heightAt(x,z);assert.notEqual(h,null);assert.ok(Math.abs(h!-y)<1e-4,`${x},${z}: ${h} vs ${y}`);count++;
  }
 });assert.equal(count,168);
});
test('outer seam retains old rendered heights at common vertices',()=>{
 const b=measured.bounds,g=elevation.coast!;
 for(let n=0;n<=192;n+=4)for(const x of [b.minX,b.maxX]){
  const z=b.minZ+n*g.dz,h=measured.heightAt(x,z);assert.notEqual(h,null);assert.ok(Math.abs(h!-elevation.heightAt(x,z))<2e-4);
 }
 for(let n=0;n<=208;n+=4)for(const z of [b.minZ,b.maxZ]){
  const x=b.minX+n*g.dx,h=measured.heightAt(x,z);assert.notEqual(h,null);assert.ok(Math.abs(h!-elevation.heightAt(x,z))<2e-4);
 }
});
test('western cliff changes, berth water and spawn remain outside land reconstruction',()=>{
 assert.ok(measured.heightAt(-100,-30)!-elevation.heightAt(-100,-30)>5);
 for(const [x,z] of [[-116,-90],[-50,-25]])assert.ok(Math.abs(measured.heightAt(x,z)!-elevation.heightAt(x,z))<.003);
 assert.equal(measured.heightAt(-36,27),null);
 assert.equal(measured.heightAt(NaN,0),null);
});
test('measured dry rock cannot be suppressed into the old authored beach',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/tomari-dry-rock-source.json',import.meta.url),'utf8'));
 assert.equal(fixture.samples.length,8);
 for(const p of fixture.samples){
  assert.ok(p.height>=4&&p.previousAuthoredHeight<2,'fixture describes dry survey above the old strand');
  const actual=measured.heightAt(p.x,p.z);assert.notEqual(actual,null);
  assert.ok(Math.abs(actual!-p.height)<.15,`survey dry rock ${p.x},${p.z}: ${actual} vs source ${p.height}`);
 }
});
test('dispose does not destroy borrowed terrain material',()=>{
 let disposed=0;material.addEventListener('dispose',()=>disposed++);
 const p=new TomariMeasuredCoast(elevation,material);p.dispose();p.dispose();assert.equal(disposed,0);assert.equal(p.heightAt(-100,-30),null);
});
test('survey exclusion omits whole legacy rock cells, keeping every visible remnant collidable',()=>{
 const ground={heightAt:(x:number,z:number)=>measured.heightAt(x,z)??elevation.heightAt(x,z)};
 const geometry=cliffOutcrops(ground,elevation.coast!,true,true,measured.bounds),p=geometry.getAttribute('position'),idx=geometry.index!;
 const proxies=geometry.userData.collisionProxies as CliffCollisionProxy[];
 const b=measured.bounds;
 for(const v of proxies)assert.ok(v.maxX<b.minX||v.minX>b.maxX||v.maxZ<b.minZ||v.minZ>b.maxZ);
 for(let k=0;k<idx.count;k+=3){
  const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)];
  assert.ok(proxies.some(v=>ids.every(n=>p.getX(n)>=v.minX-1e-4&&p.getX(n)<=v.maxX+1e-4&&p.getY(n)>=v.minY-1e-4&&p.getY(n)<=v.maxY+1e-4&&p.getZ(n)>=v.minZ-1e-4&&p.getZ(n)<=v.maxZ+1e-4)),'visible triangle has no retained rock proxy');
 }
 geometry.dispose();
});
