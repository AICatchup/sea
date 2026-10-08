import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMeasuredGridPatch,type MeasuredGrid,type MeasuredPoint} from '../src/world/measured-grid-patch.ts';

const key=(points:readonly MeasuredPoint[])=>points.map(p=>[p.x,p.z].map(v=>v.toFixed(5)).join(',')).sort().join(';');
function fixture(sign:number){
 const grid:MeasuredGrid={width:8,height:8,heights:new Float32Array(64).fill(5),origin:{x:55,z:-30},column:{x:sign,z:.13},row:{x:.17,z:1}};
 const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide});
 const patch=createMeasuredGridPatch(grid,{heightAt:()=>5},material,{chunkCells:3,blendStartMetres:0,blendEndMetres:.1});
 patch.group.updateMatrixWorld(true);
 const accepted=new Set<string>(),positions:number[]=[],index:number[]=[];
 for(const g of patch.geometries){const p=g.getAttribute('position'),idx=g.index!,o=g.userData.nativeCellOrigin;
  const size=g.userData.nativeCellSize;
  for(let k=0;k<idx.count;k+=3){const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)];
   const row=Math.floor(k/6/size.width)+o.j,col=Math.floor(k/6)%size.width+o.i;
   // One diagonal half in each cell; selection crosses both chunk boundaries.
   if(row<2||row>4||col<2||col>4||k%6!==0)continue;
   const points=ids.map(i=>({x:p.getX(i)+grid.origin.x,y:p.getY(i),z:p.getZ(i)+grid.origin.z}));
   accepted.add(key(points));const start=positions.length/3;
   for(const point of points)positions.push(point.x-grid.origin.x,point.y+2,point.z-grid.origin.z);index.push(start,start+1,start+2);
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(index);geometry.computeVertexNormals();
 const mesh=new THREE.Mesh(geometry,material);mesh.position.set(grid.origin.x,0,grid.origin.z);mesh.updateMatrixWorld(true);
 const surface={coversOriginalTriangle:(points:readonly [MeasuredPoint,MeasuredPoint,MeasuredPoint])=>accepted.has(key(points)),surfaceHeightAt:()=>7};
 return{grid,patch,mesh,surface,material,geometry,accepted};
}
for(const sign of [1,-1])test(`interior replacement preserves native halves, diagonal ties and chunk seams with affine sign ${sign}`,()=>{
 const f=fixture(sign),{grid,patch,mesh}=f,before=patch.geometries.reduce((n,g)=>n+g.index!.count/3,0);
 try{
  patch.replaceInteriorSurface(f.surface,new THREE.Box3().setFromObject(mesh).expandByScalar(3));
  assert.equal(patch.diagnostics.replacement?.removedTriangles,f.accepted.size);
  assert.equal(patch.geometries.reduce((n,g)=>n+g.index!.count/3,0),before-f.accepted.size);
  patch.group.updateMatrixWorld(true);const ray=new THREE.Raycaster();
  for(const [i,j]of [[2.2,2.2],[2.8,2.8],[3,3],[2.5,2.5],[3.001,3],[2.999,3],[4.4,4.2],[1.99,2.4],[5.01,3.4]]){
   const x=grid.origin.x+grid.column.x*i+grid.row.x*j,z=grid.origin.z+grid.column.z*i+grid.row.z*j;
   ray.set(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObjects([patch.group,mesh],true);
   assert.ok(hits.length);assert.ok(Math.abs(patch.surfaceHeightAt(x,z)!-hits[0].point.y)<1e-5,`${i},${j}`);
  }
  assert.throws(()=>patch.replaceInteriorSurface(f.surface,new THREE.Box3().setFromObject(mesh)));
 }finally{patch.dispose();f.geometry.dispose();f.material.dispose();}
});
test('false coverage leaves source intact and invalid finite-floor contract is rejected atomically',()=>{
 const f=fixture(1),before=f.patch.geometries.map(g=>Array.from(g.index!.array));
 try{
  assert.throws(()=>f.patch.replaceInteriorSurface({coversOriginalTriangle:()=>true,surfaceHeightAt:()=>null},new THREE.Box3(new THREE.Vector3(0,0,-100),new THREE.Vector3(100,10,100))),/finite floor/);
  assert.deepEqual(f.patch.geometries.map(g=>Array.from(g.index!.array)),before);
  f.patch.replaceInteriorSurface({coversOriginalTriangle:()=>false,surfaceHeightAt:()=>7},new THREE.Box3().setFromObject(f.mesh));
  assert.equal(f.patch.diagnostics.replacement?.removedTriangles,0);assert.deepEqual(f.patch.geometries.map(g=>Array.from(g.index!.array)),before);
 }finally{f.patch.dispose();f.geometry.dispose();f.material.dispose();}
});

test('preparing a replacement exposes actual local native footprint and commits only a valid final surface',()=>{
 const f=fixture(1),before=f.patch.geometries.map(g=>Array.from(g.index!.array));
 const plan=f.patch.prepareInteriorReplacement(f.surface,new THREE.Box3().setFromObject(f.mesh).expandByScalar(3));
 try{
  assert.deepEqual(f.patch.geometries.map(g=>Array.from(g.index!.array)),before);
  assert.equal(plan.coverageGeometry.index!.count/3,f.accepted.size);
  assert.equal(plan.origin.x,f.grid.origin.x);assert.equal(plan.origin.z,f.grid.origin.z);
  const p=plan.coverageGeometry.getAttribute('position'),idx=plan.coverageGeometry.index!;
  for(let k=0;k<idx.count;k+=3){
   const q=[0,1,2].map(n=>{const i=idx.getX(k+n);return{x:p.getX(i)+plan.origin.x,y:p.getY(i),z:p.getZ(i)+plan.origin.z};});
   assert.ok(f.accepted.has(key(q)));assert.ok(q.every(q=>q.y===5));
  }
  assert.throws(()=>plan.commit({coversOriginalTriangle:()=>false,surfaceHeightAt:()=>7}),/prepared footprint/);
  assert.deepEqual(f.patch.geometries.map(g=>Array.from(g.index!.array)),before);
  assert.throws(()=>plan.commit({coversOriginalTriangle:()=>true,surfaceHeightAt:()=>null}),/finite floor/);
  plan.commit();assert.equal(f.patch.diagnostics.replacement!.removedTriangles,f.accepted.size);
  assert.throws(()=>plan.commit(),/consumed/);
 }finally{plan.dispose();f.patch.dispose();f.geometry.dispose();f.material.dispose();}
});

test('disposed or stale plans cannot mutate native topology',()=>{
 const f=fixture(1),bounds=new THREE.Box3().setFromObject(f.mesh).expandByScalar(3);
 const disposed=f.patch.prepareInteriorReplacement(f.surface,bounds);disposed.dispose();assert.throws(()=>disposed.commit(),/disposed/);
 const stale=f.patch.prepareInteriorReplacement(f.surface,bounds),before=f.patch.geometries.map(g=>Array.from(g.index!.array));
 try{const g=f.patch.geometries[0];g.setIndex(Array.from(g.index!.array));assert.throws(()=>stale.commit(),/topology/);assert.deepEqual(f.patch.geometries.map(g=>Array.from(g.index!.array)),before);}
 finally{stale.dispose();f.patch.dispose();f.geometry.dispose();f.material.dispose();}
});
