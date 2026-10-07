import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMeasuredGridPatch} from '../src/world/measured-grid-patch.ts';
import type {MeasuredGrid} from '../src/world/measured-grid-patch.ts';
const material=()=>new THREE.MeshStandardMaterial({side:THREE.DoubleSide});
function data(w=20,h=17):MeasuredGrid{return {width:w,height:h,heights:Float32Array.from({length:w*h},(_,n)=>Math.sin(n*.37)*8+Math.floor(n/w)*.5),origin:{x:5581.205201475545,z:-1155.5147510964644},column:{x:.24977463723981239,z:-.0013802832786325436},row:{x:.0013741188552665873,z:.2508951490081665}};}
const world=(g:MeasuredGrid,i:number,j:number)=>({x:g.origin.x+g.column.x*i+g.row.x*j,z:g.origin.z+g.column.z*i+g.row.z*j});
const opts={chunkCells:6,blendStartMetres:0,blendEndMetres:.1,cutInsetMetres:.3};
test('native tilted affine samples retain interior heights and inverse query matches',()=>{
 const g=data(),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>-2},m,opts);
 for(let j=1;j<g.height-1;j++)for(let i=1;i<g.width-1;i++){const p=world(g,i,j),y=patch.surfaceHeightAt(p.x,p.z);assert.notEqual(y,null);assert.ok(Math.abs(y!-g.heights[j*g.width+i])<.0001);}
 assert.equal(patch.diagnostics.maxUnblendedHeightError,0);assert.equal(patch.diagnostics.fullResolutionOnly,true);assert.equal(patch.diagnostics.triangles,2*(g.width-1)*(g.height-1));patch.dispose();m.dispose();
});
test('height query matches actual rendered triangle ray intersections independently',()=>{
 const g=data(),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>-2},m,opts),ray=new THREE.Raycaster();patch.group.updateMatrixWorld(true);
 for(let j=1;j<g.height-2;j+=2)for(let i=1;i<g.width-2;i+=2){const p=world(g,i+.36,j+.27);ray.set(new THREE.Vector3(p.x,1000,p.z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(patch.group,true);assert.ok(hits.length);assert.ok(Math.abs(patch.surfaceHeightAt(p.x,p.z)!-hits[0].point.y)<1e-7);}
 patch.dispose();m.dispose();
});
test('unknown and boundary use fallback; blending uses world metres and outside returns null',()=>{
 const g=data(40,40);g.heights.fill(20);g.valid=new Uint8Array(1600).fill(1);g.valid[20*40+20]=0;const m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>4},m,{chunkCells:16,blendStartMetres:1,blendEndMetres:3,cutInsetMetres:.5});
 for(const [i,j,y]of [[0,20,4],[2,20,4],[20,20,4],[16,16,20]]){const p=world(g,i,j);assert.ok(Math.abs(patch.surfaceHeightAt(p.x,p.z)!-y)<.0001);}
 const p=world(g,8,20),t=(Math.abs(g.column.x*g.row.z-g.column.z*g.row.x)/Math.hypot(g.row.x,g.row.z)*8-1)/2,expected=4+16*t*t*(3-2*t);assert.ok(Math.abs(patch.surfaceHeightAt(p.x,p.z)!-expected)<.001);
 const out=world(g,-1,20);assert.equal(patch.surfaceHeightAt(out.x,out.z),null);assert.equal(patch.surfaceHeightAt(NaN,0),null);assert.equal(patch.diagnostics.unknownSamples,1);patch.dispose();m.dispose();
});
test('full-only chunk seams share bit-identical positions and global native normals',()=>{
 const g=data(),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,opts),seen=new Map<string,number[]>();let duplicates=0;
 for(const geometry of patch.geometries){const p=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),o=geometry.userData.nativeCellOrigin,s=geometry.userData.nativeCellSize;
 for(let j=0;j<=s.height;j++)for(let i=0;i<=s.width;i++){const n=j*(s.width+1)+i,key=`${o.i+i},${o.j+j}`,v=[p.getX(n),p.getY(n),p.getZ(n),normal.getX(n),normal.getY(n),normal.getZ(n)],old=seen.get(key);if(old){assert.deepEqual(v,old);duplicates++;}else seen.set(key,v);}}
 assert.ok(duplicates>50);assert.equal(seen.size,g.width*g.height);patch.dispose();m.dispose();
});
test('1600x1200 native grid keeps every sample and full-resolution triangle budget',()=>{
 const g=data(1600,1200),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m);
 assert.equal(patch.diagnostics.nativeSamples,1920000);assert.equal(patch.diagnostics.chunks,130);assert.equal(patch.diagnostics.triangles,2*1599*1199);assert.equal(patch.diagnostics.vertices,1612*1209);assert.equal(patch.diagnostics.maxUnblendedHeightError,0);
 const geometry=patch.geometries.find(v=>v.userData.nativeCellOrigin.i===768&&v.userData.nativeCellOrigin.j===512)!;const p=geometry.getAttribute('position'),s=geometry.userData.nativeCellSize;assert.equal(p.getY(40*(s.width+1)+32),g.heights[(512+40)*g.width+768+32]);patch.dispose();m.dispose();
});
test('triangle removal requires every vertex within affine inset, independent of camera',()=>{
 const g=data(),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,opts),p=(i:number,j:number)=>({...world(g,i,j),y:10});
 assert.equal(patch.coversOriginalTriangle([p(3,3),p(7,3),p(3,7)]),true);assert.equal(patch.coversOriginalTriangle([p(0,3),p(7,3),p(3,7)]),false);assert.equal(patch.coversOriginalTriangle([p(-20,3),p(7,3),p(3,7)]),false);patch.dispose();assert.equal(patch.surfaceHeightAt(p(3,3).x,p(3,3).z),null);m.dispose();
});
test('owned geometry disposal preserves borrowed arrays, material and texture',()=>{
 const g=data(),before=g.heights.slice(),m=material(),texture=new THREE.Texture();m.map=texture;let md=0,td=0,gd=0;m.addEventListener('dispose',()=>md++);texture.addEventListener('dispose',()=>td++);const patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,opts);
 for(const geometry of patch.geometries)geometry.addEventListener('dispose',()=>gd++);for(const mesh of patch.group.children){assert.equal((mesh as THREE.Mesh).material,m);assert.equal(mesh.userData.worldSolid,undefined);}
 patch.dispose();patch.dispose();assert.equal(gd,patch.geometries.length);assert.equal(md,0);assert.equal(td,0);assert.deepEqual(g.heights,before);assert.equal(m.map,texture);m.dispose();texture.dispose();
});
test('finite geometry budgets and invalid data are rejected',()=>{
 const m=material(),g=data(130,130),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,{blendStartMetres:0,blendEndMetres:1});assert.equal(patch.diagnostics.chunks,4);assert.ok(patch.diagnostics.vertices<=132*132);for(const geometry of patch.geometries)for(const name of ['position','normal','uv'])for(const v of geometry.getAttribute(name).array)assert.ok(Number.isFinite(v));patch.dispose();
 for(const bad of [{...g,width:1},{...g,row:g.column},{...g,origin:{x:NaN,z:0}},{...g,valid:new Uint8Array(1)},{...g,heights:Float32Array.from(g.heights,(v,i)=>i===0?NaN:v)}])assert.throws(()=>createMeasuredGridPatch(bad,{heightAt:()=>0},m));assert.throws(()=>createMeasuredGridPatch(g,{heightAt:()=>NaN},m));assert.throws(()=>createMeasuredGridPatch(g,{heightAt:()=>0},m,{blendStartMetres:5,blendEndMetres:3}));m.dispose();
});
