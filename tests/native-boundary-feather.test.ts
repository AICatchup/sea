import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { featherNativeSurfaceBoundary } from '../src/world/native-boundary-feather.ts';

const zero={x:0,y:0,z:0};
function mesh(p:number[],index:number[]) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(index);return g;
}
// Duplicate chunk vertices along the shared diagonal are intentionally unwelded.
const footprint=()=>mesh([0,0,0,20,0,0,20,0,20, 0,0,0,20,0,20,0,0,20],[0,1,2,3,4,5]);
const cloud=()=>mesh([0,10,10,2,10,10,8,10,10, 0,-10,10,2,-10,10,8,-10,10],[0,1,2,3,4,5]);

test('exact native contact, higher/lower layers, C2 midpoint and unchanged interior; owned snapshot',()=>{
  const c=cloud(),f=footprint(); c.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,0,1,1],2));
  const before=Array.from(c.getAttribute('position').array), fb=Array.from(f.getAttribute('position').array);
  const {geometry:g,diagnostics:d}=featherNativeSurfaceBoundary(c,zero,f,zero,()=>0);
  assert.deepEqual(Array.from(g.getAttribute('position').array),[0,0,10,2,5,10,8,10,10,0,0,10,2,-5,10,8,-10,10]);
  assert.equal(d.boundaryEdges,4);assert.equal(d.queries,4);assert.equal(d.movedVertices,4);assert.equal(d.maxYMovement,10);
  assert.equal(d.authoredDeformation,true);
  assert.deepEqual(Array.from(c.getAttribute('position').array),before);assert.deepEqual(Array.from(f.getAttribute('position').array),fb);
  assert.notEqual(g.getIndex()!.array,c.getIndex()!.array);assert.notEqual(g.getAttribute('uv').array,c.getAttribute('uv').array);
  assert.ok(g.getAttribute('normal'));assert.deepEqual(Array.from(g.getIndex()!.array),Array.from(c.getIndex()!.array));
});

test('translated sheared footprint uses world XZ boundary and world native height',()=>{
  const f=footprint(),p=f.getAttribute('position');
  for(let i=0;i<p.count;i++)p.setX(i,p.getX(i)+p.getZ(i)*.5);
  const co={x:100,y:7,z:200},fo={x:100,y:80,z:200};
  const c=mesh([5,10,10,7,10,10,13,10,10],[0,1,2]);let calls=0;
  const {geometry:g}=featherNativeSurfaceBoundary(c,co,f,fo,(x,z)=>{calls++;assert.equal(z,210);assert.ok(x>=105);return 3;});
  assert.equal(g.getAttribute('position').getY(0),-4);assert.equal(g.getAttribute('position').getY(2),10);assert.equal(calls,2);
});

test('tiny outside clipping residual snaps to finite native floor',()=>{
  const c=mesh([-.000002,8,10,4,8,10,8,8,10],[0,1,2]);
  const {geometry:g,diagnostics:d}=featherNativeSurfaceBoundary(c,zero,footprint(),zero,()=>2);
  assert.equal(g.getAttribute('position').getY(0),2);assert.equal(d.queries,1);
  assert.equal(g.getAttribute('position').getX(0),c.getAttribute('position').getX(0));
});

test('quintic transitions have vanishing endpoint first and second derivatives',()=>{
  const xs=[0,.01,.02,3.98,3.99,4,8];
  const c=mesh(xs.flatMap(x=>[x,1,10]),[0,1,2,3,4,5]);
  const {geometry:g}=featherNativeSurfaceBoundary(c,zero,footprint(),zero,()=>0);
  const y=xs.map((_,i)=>g.getAttribute('position').getY(i));
  assert.ok(Math.abs(y[1]!-y[0]!)<.000001);assert.ok(Math.abs(y[5]!-y[4]!)<.000001);
  assert.ok(Math.abs(y[2]!-2*y[1]!+y[0]!)<.000002);assert.ok(Math.abs(y[5]!-2*y[4]!+y[3]!)<.000002);
  assert.equal(y[5],1);assert.equal(y[6],1);
});

test('invalid, missing floor, nonmanifold and budgets fail without source mutation',()=>{
  const c=cloud(),f=footprint(),before=Array.from(c.getAttribute('position').array);
  for(const options of [{featherWidthM:0},{maxVertices:2},{maxInputTriangles:1},{maxEdges:1},
    {maxBoundaryEdges:3},{maxGridReferences:1},{maxGridCells:1},{maxDistanceTests:1},{maxQueries:1}])
    assert.throws(()=>featherNativeSurfaceBoundary(c,zero,f,zero,()=>0,options));
  assert.throws(()=>featherNativeSurfaceBoundary(c,zero,f,zero,()=>null),/floor/);
  assert.throws(()=>featherNativeSurfaceBoundary(c,zero,f,zero,()=>NaN),/floor/);
  assert.throws(()=>featherNativeSurfaceBoundary(c,zero,f,zero,()=>1e40),/overflow/);
  const bad=f.clone();bad.setIndex([0,1,2,0,1,2,0,1,2]);
  assert.throws(()=>featherNativeSurfaceBoundary(c,zero,bad,zero,()=>0),/Nonmanifold/);
  const invalid=c.clone();invalid.setIndex([0,1,100]);
  assert.throws(()=>featherNativeSurfaceBoundary(invalid,zero,f,zero,()=>0),/index/);
  const invalidPosition=c.clone();invalidPosition.getAttribute('position').setX(0,Infinity);
  assert.throws(()=>featherNativeSurfaceBoundary(invalidPosition,zero,f,zero,()=>0),/Nonfinite/);
  assert.deepEqual(Array.from(c.getAttribute('position').array),before);
});
