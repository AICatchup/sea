import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { supportLowShrubs } from '../src/world/shrub-support.ts';

function nativeFixture() {
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute([-2,.8,0, 2,.8,0, 0,1,1, 0,1,-1],3));
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,.5,0, .01,0,0],3));
  const leafMaterial = new THREE.MeshStandardMaterial(); leafMaterial.userData.foliageRole='leaves';
  const barkMaterial = new THREE.MeshStandardMaterial(); barkMaterial.userData.foliageRole='trunk';
  return {parts:[{geometry:leaves,material:leafMaterial},{geometry:trunk,material:barkMaterial}],triangles:2};
}

test('wide native low shrub improves uphill burial within root/shrink bounds without population changes',()=>{
  const variant=nativeFixture(), normal=new THREE.Vector3(-Math.tan(Math.PI*35/180),1,0).normalize();
  const low=new THREE.Matrix4().compose(new THREE.Vector3(12,16,4),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal),new THREE.Vector3(2.55,.7,2.2));
  const untouched=new THREE.Matrix4().makeTranslation(5,10,0), initial=untouched.clone();
  const matrices=[[low,untouched]], source=Array.from(variant.parts[0].geometry.getAttribute('position').array);
  const d=supportLowShrubs({heightAt:(x)=>10+.5*x},[variant],matrices,new Set([low]));
  assert.equal(d.tested,1); assert.equal(d.changed,1); assert.equal(d.shrunk,1);
  assert.ok(d.maxBurialAfter<d.maxBurialBefore); assert.ok(d.maxRootGap<=.08000001);
  assert.ok(d.minWidthFactor>=.7); assert.ok(d.maxLift<=.095);
  assert.equal(matrices[0].length,2); assert.deepEqual(untouched.elements,initial.elements);
  assert.ok(low.elements.every(Number.isFinite));
  assert.deepEqual(Array.from(variant.parts[0].geometry.getAttribute('position').array),source);
});

test('invalid terrain leaves existing matrix intact and returns finite diagnostics',()=>{
  const variant=nativeFixture(), matrix=new THREE.Matrix4(), copy=matrix.clone();
  const d=supportLowShrubs({heightAt:()=>NaN},[variant],[[matrix]],new Set([matrix]));
  assert.equal(d.invalid,1); assert.equal(d.changed,0); assert.deepEqual(matrix.elements,copy.elements);
  for(const value of Object.values(d)) if(typeof value==='number')assert.ok(Number.isFinite(value));
});
import { readFileSync } from 'node:fs';

test('all three real shrub GLB near variants support without geometry mutation',()=>{
  const data=readFileSync(new URL('../src/assets/foliage/cc0/shrub-lod-1k.glb',import.meta.url));
  const length=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+length).toString('utf8')),binary=20+length+8;
  for(let v=0;v<3;v++){
    const node=json.nodes.find((n:any)=>n.name===`shrub_near_${v}`);
    const parts=json.meshes[node.mesh].primitives.map((primitive:any)=>{
      const a=json.accessors[primitive.attributes.POSITION],view=json.bufferViews[a.bufferView];
      assert.equal(a.componentType,5126); assert.equal(a.type,'VEC3'); assert.ok(!a.sparse);
      const offset=binary+(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??12;
      const array=Float32Array.from({length:a.count*3},(_,i)=>data.readFloatLE(offset+Math.floor(i/3)*stride+i%3*4));
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(array,3));
      const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='leaves';
      return {geometry,material};
    });
    const variant={parts,triangles:0},matrix=new THREE.Matrix4().compose(new THREE.Vector3(0,10,0),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),35*Math.PI/180),new THREE.Vector3(2.55,.7,2.2));
    const originals=parts.map((p:any)=>Array.from(p.geometry.getAttribute('position').array));
    const d=supportLowShrubs({heightAt:(x)=>10+x*.85},[variant],[[matrix]],new Set([matrix]));
    assert.equal(d.invalid,0);assert.equal(d.tested,1);assert.ok(d.maxBurialAfter<=d.maxBurialBefore);assert.ok(d.maxRootGap<=.0800001);assert.ok(matrix.elements.every(Number.isFinite));
    parts.forEach((p:any,i:number)=>assert.deepEqual(Array.from(p.geometry.getAttribute('position').array),originals[i]));
    console.log(JSON.stringify({variant:v,...d}));
  }
});
