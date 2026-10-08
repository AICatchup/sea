import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {stitchNativeSurfaceBoundary} from '../src/world/native-surface-stitch.ts';
const zero={x:0,y:0,z:0};
function mesh(p:number[],i:number[]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(i);return g;}
const square=()=>mesh([0,0,0,1,0,0,1,0,1,0,0,1],[0,1,2,0,2,3]);
function area(g:THREE.BufferGeometry){const p=g.getAttribute('position');let total=0;for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);total+=b.sub(a).cross(c.sub(a)).length()/2;}return total;}
test('higher and lower replacement close only outer boundary with native winding',()=>{
 for(const height of [2,-2]){const {geometry,diagnostics}=stitchNativeSurfaceBoundary(square(),zero,()=>height,{subdivisionM:1});assert.equal(diagnostics.boundaryEdges,4);assert.equal(diagnostics.outputTriangles,8);assert.equal(diagnostics.maximumHeightDeltaM,2);assert.equal(area(geometry),8);assert.equal(geometry.getAttribute('normal').count,24);}
});
test('native slope, signed sheared coordinates and translated query retain local native Y',()=>{
 const g=mesh([-2,1,-3, -1,2,-2, -2,3,-1, -3,2,-2],[0,1,2,0,2,3]);
 const origin={x:5000,y:100,z:-4000};const calls:number[][]=[];
 const result=stitchNativeSurfaceBoundary(g,origin,(x,z)=>{calls.push([x,z]);return 110;},{subdivisionM:.4});
 assert.ok(calls.every(([x,z])=>x>=4997&&x<=4999&&z>=-4003&&z<=-4001));
 const p=result.geometry.getAttribute('position');assert.ok(Array.from({length:p.count},(_,i)=>p.getY(i)).includes(1));assert.ok(Array.from({length:p.count},(_,i)=>p.getY(i)).includes(10));assert.equal(result.diagnostics.maximumHeightDeltaM,9);
});
test('bit-identical duplicate chunk vertices cancel common boundary',()=>{
 const g=mesh([0,0,0,1,0,0,0,0,1, 1,0,0,1,0,1,0,0,1],[0,1,2,3,4,5]);
 const result=stitchNativeSurfaceBoundary(g,zero,()=>2,{subdivisionM:1});
 assert.equal(result.diagnostics.boundaryEdges,4);assert.equal(area(result.geometry),8);
});
test('mixed signed heights split at zero and avoid folded bowtie quads',()=>{
 const result=stitchNativeSurfaceBoundary(square(),zero,x=>2*x-1,{subdivisionM:1});
 assert.equal(result.diagnostics.signCrossings,2);assert.equal(result.diagnostics.outputTriangles,8);
 assert.equal(area(result.geometry),3);
 const p=result.geometry.getAttribute('position');
 for(let i=0;i<p.count;i+=3){const ys=[p.getY(i),p.getY(i+1),p.getY(i+2)];assert.ok(!(ys.some(y=>y<0)&&ys.some(y=>y>0)));}
});
test('zero height produces declared zero-area rejection',()=>{
 const result=stitchNativeSurfaceBoundary(square(),zero,()=>0,{subdivisionM:1});
 assert.equal(result.diagnostics.outputTriangles,0);assert.equal(result.diagnostics.zeroAreaTriangles,8);
});
test('invalid data, missing heights, nonmanifold and bounded work fail atomically',()=>{
 for(const option of [{maxBoundaryEdges:1},{maxOutputTriangles:1},{maxInputTriangles:1},{subdivisionM:0}])assert.throws(()=>stitchNativeSurfaceBoundary(square(),zero,()=>2,option),/budget|limit/);
 for(const height of [null,NaN,Infinity])assert.throws(()=>stitchNativeSurfaceBoundary(square(),zero,()=>height),/query/);
 const bad=mesh([0,0,0,1,0,0,0,0,1],[0,1,9]);assert.throws(()=>stitchNativeSurfaceBoundary(bad,zero,()=>2),/index/);
 const nonmanifold=mesh([0,0,0,1,0,0,0,0,1],[0,1,2,0,1,2,0,1,2]);assert.throws(()=>stitchNativeSurfaceBoundary(nonmanifold,zero,()=>2),/Nonmanifold/);
 assert.throws(()=>stitchNativeSurfaceBoundary(square(),{...zero,x:NaN},()=>2),/origin/);
});
