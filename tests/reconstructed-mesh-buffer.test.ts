import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {decodeReconstructedMeshBuffer} from '../src/world/reconstructed-mesh-buffer.ts';
import type {ReconstructedMeshDescriptor} from '../src/world/reconstructed-mesh-buffer.ts';

function fixture() {
  const descriptor:ReconstructedMeshDescriptor={vertices:4,triangles:2,origin:[5880,0,-1015],positionsBytes:48,indicesBytes:24};
  const buffer=new ArrayBuffer(72),view=new DataView(buffer);
  // Inclined square y=2+x. Explicit encoding tests the wire endianness.
  [0,2,0,1,3,0,1,3,1,0,2,1].forEach((v,i)=>view.setFloat32(i*4,v,true));
  [0,2,1,0,3,2].forEach((v,i)=>view.setUint32(48+i*4,v,true));
  return {buffer,descriptor};
}
test('little-endian indexed relative mesh has exact coordinates, bounds, normals and a world-space ray hit',()=>{
  const {buffer,descriptor}=fixture(),{geometry,origin}=decodeReconstructedMeshBuffer(buffer,descriptor);
  assert.deepEqual(origin.toArray(),[5880,0,-1015]);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array),[0,2,0,1,3,0,1,3,1,0,2,1]);
  assert.ok(geometry.getAttribute('position').array instanceof Float32Array);assert.ok(geometry.index!.array instanceof Uint32Array);
  assert.deepEqual(Array.from(geometry.index!.array),[0,2,1,0,3,2]);
  assert.deepEqual(geometry.boundingBox!.min.toArray(),[0,2,0]);assert.deepEqual(geometry.boundingBox!.max.toArray(),[1,3,1]);
  assert.ok(Math.abs(geometry.boundingSphere!.radius-Math.sqrt(.75))<1e-12);
  const normal=new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'),0);
  assert.ok(normal.distanceTo(new THREE.Vector3(-1,1,0).normalize())<1e-6);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.position.copy(origin);mesh.updateMatrixWorld();
  const hit=new THREE.Raycaster(new THREE.Vector3(5880.25,20,-1014.75),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];
  assert.ok(hit);assert.deepEqual(hit.point.toArray(),[5880.25,2.25,-1014.75]);
  geometry.dispose();material.dispose();assert.equal(buffer.byteLength,72);
});
test('returned arrays and origin are independent snapshots of borrowed inputs',()=>{
  const {buffer,descriptor}=fixture(),{geometry,origin}=decodeReconstructedMeshBuffer(buffer,descriptor);
  new DataView(buffer).setFloat32(0,99,true);new DataView(buffer).setUint32(48,99,true);(descriptor.origin as number[])[0]=99;
  assert.equal(geometry.getAttribute('position').getX(0),0);assert.equal(geometry.index!.getX(0),0);assert.equal(origin.x,5880);geometry.dispose();
});
test('rejects malformed counts, byte layout, length, alignment and allocation limits before decoding',()=>{
  const {buffer,descriptor}=fixture();
  for(const changes of [{vertices:0},{vertices:-1},{vertices:1.5},{vertices:NaN},{vertices:Infinity},{vertices:Number.MAX_SAFE_INTEGER+1},{triangles:0},{triangles:2.5},{positionsBytes:47},{indicesBytes:23},{positionsBytes:52},{indicesBytes:28}])assert.throws(()=>decodeReconstructedMeshBuffer(buffer,{...descriptor,...changes}));
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer.slice(0,71),descriptor),/length/);
  assert.throws(()=>decodeReconstructedMeshBuffer(new ArrayBuffer(76),descriptor),/length/);
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor,{maxVertices:3}),/budget/);
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor,{maxTriangles:1}),/budget/);
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor,{maxBufferBytes:71}),/budget/);
  for(const v of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor,{maxVertices:v}));
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer,{...descriptor,vertices:1_000_001}),/budget/);
  assert.throws(()=>decodeReconstructedMeshBuffer(new Uint8Array(buffer) as unknown as ArrayBuffer,descriptor),/ArrayBuffer/);
});
test('rejects nonfinite coordinates, invalid origins and out-of-range uint32 indices without repairing bytes',()=>{
  for(const bad of [NaN,Infinity,-Infinity]) {
    const {buffer,descriptor}=fixture();new DataView(buffer).setFloat32(4,bad,true);
    assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor),/Nonfinite/);assert.ok(!Number.isFinite(new DataView(buffer).getFloat32(4,true)));
    const good=fixture();assert.throws(()=>decodeReconstructedMeshBuffer(good.buffer,{...good.descriptor,origin:[5880,bad,-1015]}),/origin/);
  }
  for(const bad of [4,0xffffffff]) {
    const {buffer,descriptor}=fixture();new DataView(buffer).setUint32(48,bad,true);assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor),/index/);assert.equal(new DataView(buffer).getUint32(48,true),bad);
  }
  const f=fixture();assert.throws(()=>decodeReconstructedMeshBuffer(f.buffer,{...f.descriptor,origin:[1,2] as never}),/origin/);
});
test('finite wire coordinates producing overflowing derived normals are rejected',()=>{
  const {buffer,descriptor}=fixture(),view=new DataView(buffer);
  [0,0,0,1e30,0,0,0,1e30,0,0,0,1e30].forEach((v,i)=>view.setFloat32(i*4,v,true));
  assert.throws(()=>decodeReconstructedMeshBuffer(buffer,descriptor),/derived normals/);
});
