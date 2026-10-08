import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipProjectedSurface } from '../src/world/projected-surface-clip.ts';
const zero = { x: 0, y: 0, z: 0 };
function mesh(p: number[], indices?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(indices ?? p.map((_, i) => i).filter(i => i % 3 === 0).map(i => i / 3));
  return g;
}
const square = () => mesh([0,0,0, 1,0,0, 1,0,1, 0,0,1], [0,1,2, 0,2,3]);
function area(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'); let sum = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p,i), b = new THREE.Vector3().fromBufferAttribute(p,i+1), c = new THREE.Vector3().fromBufferAttribute(p,i+2);
    sum += b.sub(a).cross(c.sub(a)).length()/2;
  }
  return sum;
}
test('clips partial coverage and retains interpolated local Y and float attributes', () => {
  const cloud = mesh([-1,-2,0, 2,4,0, 0,-0,2]);
  cloud.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0, 0,1,0, 0,1,0],3));
  const {geometry,diagnostics} = clipProjectedSurface(cloud,zero,square(),zero);
  assert.ok(diagnostics.outputTriangles > 0);
  const p = geometry.getAttribute('position');
  for(let i=0;i<p.count;i++) {
    assert.ok(p.getX(i)>=0 && p.getX(i)<=1 && p.getZ(i)>=0 && p.getZ(i)<=1);
    assert.ok(Math.abs(p.getY(i)-2*p.getX(i))<1e-6);
  }
  assert.equal(geometry.getAttribute('normal').count,p.count);
});
test('crosses native diagonal without overlap and keeps elevated and lowered layers',()=>{
  const cloud=mesh([0,8,0, 1,8,0, 0,8,1, 0,-3,0, 1,-3,0, 0,-3,1]);
  const {geometry}=clipProjectedSurface(cloud,zero,square(),zero);
  assert.ok(Math.abs(area(geometry)-1)<1e-7);
  const p=geometry.getAttribute('position');
  for(let i=0;i<p.count;i++) assert.ok(p.getY(i)===8 || p.getY(i)===-3);
});
test('footprint holes remain uncovered',()=>{
  const mask=mesh([0,0,0, 1,0,0, 0,0,1, 2,0,0, 3,0,0, 3,0,1]);
  const {geometry}=clipProjectedSurface(mesh([-1,7,-1, 4,7,-1, 1.5,7,3]),zero,mask,zero);
  const p=geometry.getAttribute('position');
  for(let i=0;i<p.count;i+=3) {
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
    assert.ok(x<=1 || x>=2);
  }
});
test('vertical wall clipping preserves 3D area including native shared diagonal',()=>{
  const wall=mesh([-1,0,-1, 2,0,2, 2,3,2]);
  const {geometry}=clipProjectedSurface(wall,zero,square(),zero);
  assert.ok(Math.abs(area(geometry)-Math.SQRT2*1.5)<1e-6);
});
test('large translation keeps original cloud local coordinates and overhang Y',()=>{
  const origin={x:5000,y:100,z:-5000};
  const {geometry}=clipProjectedSurface(mesh([0,12,0,1,12,0,0,12,1]),origin,square(),origin);
  assert.equal(area(geometry),0.5);
  assert.equal(geometry.getAttribute('position').getY(0),12);
});
test('rejects invalid data and fails on every bounded budget',()=>{
  assert.throws(()=>clipProjectedSurface(mesh([NaN,0,0,1,0,0,0,0,1]),zero,square(),zero),/Nonfinite/);
  const invalid=mesh([0,0,0,1,0,0,0,0,1],[0,1,99]);
  assert.throws(()=>clipProjectedSurface(invalid,zero,square(),zero),/index/);
  const cloud=mesh([-1,0,-1,2,0,-1,-1,0,2, -1,1,-1,2,1,-1,-1,1,2]);
  for(const option of [{maxInputTriangles:1},{maxFootprintTriangles:1},{maxGridReferences:1},{maxCellsPerTriangle:1},{maxCandidateTests:1},{maxQueryOperations:1},{maxOutputTriangles:1}])
    assert.throws(()=>clipProjectedSurface(cloud,zero,square(),zero,option),/budget/);
});

test('different origin translations align geometry without changing source coordinates',()=>{
  const cloudOrigin={x:5880,y:9,z:-1015};
  const maskOrigin={x:5579.552887560167,y:0,z:-1456.5887732721694};
  const mask=square();
  mask.translate(cloudOrigin.x-maskOrigin.x,0,cloudOrigin.z-maskOrigin.z);
  const {geometry}=clipProjectedSurface(mesh([0.1,12,0.1,0.9,12,0.1,0.1,12,0.9]),cloudOrigin,mask,maskOrigin);
  assert.ok(Math.abs(area(geometry)-0.32)<1e-5);
  assert.equal(geometry.getAttribute('position').getY(0),12);
});
test('vertical wall partially clips on an exterior grid border',()=>{
  const {geometry}=clipProjectedSurface(mesh([0,0,-1,0,0,2,0,3,2]),zero,square(),zero);
  assert.ok(Math.abs(area(geometry)-1.5)<1e-6);
});

test('minimum 3D triangle area is explicit and quantified; strict default retains tiny faces',()=>{
  const cloud=mesh([0.2,0,0.1,0.20001,0,0.1,0.2,0,0.10001]);
  const strict=clipProjectedSurface(cloud,zero,square(),zero);
  assert.equal(strict.diagnostics.outputTriangles,1);
  assert.equal(strict.diagnostics.rejectedTinyTriangles,0);
  const approximate=clipProjectedSurface(cloud,zero,square(),zero,{minimumTriangleAreaM2:1e-8});
  assert.equal(approximate.diagnostics.outputTriangles,0);
  assert.equal(approximate.diagnostics.rejectedTinyTriangles,1);
  assert.ok(approximate.diagnostics.rejectedTinyAreaM2>0);
  assert.throws(()=>clipProjectedSurface(cloud,zero,square(),zero,{minimumTriangleAreaM2:-1}),/minimumTriangleArea/);
});

test('whole union passthrough avoids native diagonal fragmentation',()=>{
  const cloud=mesh([0,8,0,1,8,0,0,8,1]);
  const clipped=clipProjectedSurface(cloud,zero,square(),zero);
  assert.equal(clipped.diagnostics.outputTriangles,2);
  const union=clipProjectedSurface(cloud,zero,square(),zero,{unionCoverageAreaToleranceM2:0});
  assert.equal(union.diagnostics.outputTriangles,1);
  assert.equal(union.diagnostics.unionPassthroughTriangles,1);
  assert.equal(area(union.geometry),0.5);
});
test('union passthrough leaves real holes clipped; tiny gaps require explicit allowance',()=>{
  const mask=mesh([0,0,0,.4999,0,0,.4999,0,1,0,0,1, .5001,0,0,1,0,0,1,0,1,.5001,0,1], [0,1,2,0,2,3,4,5,6,4,6,7]);
  const cloud=mesh([0,5,0,1,5,0,0,5,1]);
  const strict=clipProjectedSurface(cloud,zero,mask,zero,{unionCoverageAreaToleranceM2:0});
  assert.equal(strict.diagnostics.unionPassthroughTriangles,0);
  assert.ok(area(strict.geometry)<.5);
  const allowed=clipProjectedSurface(cloud,zero,mask,zero,{unionCoverageAreaToleranceM2:.001});
  assert.equal(allowed.diagnostics.unionPassthroughTriangles,1);
  assert.equal(allowed.diagnostics.unionCoverageDiagnostics?.approximateCoverageAcceptances,1);
  assert.equal(area(allowed.geometry),.5);
});
