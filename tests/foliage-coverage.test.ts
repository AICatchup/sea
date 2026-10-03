import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {representativeLeaves} from '../src/world/foliage-coverage.ts';
import * as THREE from 'three';
import {coarseFoliage} from '../src/world/foliage-coarse.ts';
import {ModelResources} from '../src/world/models/procedural.ts';

function source(file:string,nodeName:string){
 const data=readFileSync(new URL(`../src/assets/foliage/cc0/${file}`,import.meta.url));
 const length=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+length).toString('utf8')),binary=20+length+8;
 const node=json.nodes.find((n:any)=>n.name===nodeName);
 const primitive=json.meshes[node.mesh].primitives.find((p:any)=>json.materials[p.material].name.includes('leaves'))??json.meshes[node.mesh].primitives[0];
 const attribute=(id:number)=>{const a=json.accessors[id],v=json.bufferViews[a.bufferView],stride=v.byteStride??(a.type==='VEC3'?12:a.componentType===5125?4:2),offset=binary+(v.byteOffset??0)+(a.byteOffset??0);assert.ok(!a.sparse);assert.equal(a.type==='VEC3'?a.componentType:5126,5126);if(a.type==='VEC3')return Float32Array.from({length:a.count*3},(_,i)=>data.readFloatLE(offset+Math.floor(i/3)*stride+i%3*4));return Uint32Array.from({length:a.count},(_,i)=>a.componentType===5125?data.readUInt32LE(offset+i*stride):data.readUInt16LE(offset+i*stride));};
 return {positions:attribute(primitive.attributes.POSITION) as Float32Array,indices:attribute(primitive.indices) as Uint32Array};
}
test('native source component selection is bounded, deterministic and reports three-axis geometric coverage',()=>{
 for(const [file,node,budget] of [['canopy/canopy0-lod-1k.glb','canopy0_near_0',720],['canopy/canopy1-lod-1k.glb','canopy1_near_0',720],['canopy/canopy2-lod-1k.glb','canopy2_near_0',720],...Array.from({length:3},(_,i)=>['shrub-lod-1k.glb',`shrub_near_${i}`,160])] as [string,string,number][]){
  const s=source(file,node),before=Array.from(s.positions),r=representativeLeaves(s.positions,s.indices,budget,128);
  assert.equal(r.unsupported,false);assert.ok(r.indices.length/3<=budget);assert.deepEqual(Array.from(s.positions),before);
  assert.deepEqual(r.indices,representativeLeaves(s.positions,s.indices,budget,128).indices);
  assert.ok(r.candidatePixels.every((p,i)=>p>0&&p<=r.originalPixels[i]));
  console.log(JSON.stringify({node,sourceTriangles:s.indices.length/3,candidateTriangles:r.indices.length/3,components:r.components,originalPixels:r.originalPixels,candidatePixels:r.candidatePixels,ratios:r.candidatePixels.map((p,i)=>+(p/r.originalPixels[i]).toFixed(3))}));
 }
});
test('unsupported large connected topology is explicit',()=>{const r=representativeLeaves(new Float32Array([0,0,0,1,0,0,0,1,0]),new Uint32Array([0,1,2]),0);assert.equal(r.unsupported,true);});
test('refinement retains attributes, material ownership and a whole curved component within the budget',async()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,1,1,.2,0,1,0,2,0,0,3,0,0,3,1,.2,2,1,0],3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(Array(24).fill(1),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(Array(16).fill(.5),2));geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
 const material=new THREE.MeshStandardMaterial(),resources=new ModelResources();
 const result=await coarseFoliage({parts:[{geometry,material}],triangles:4},resources,'shrub',()=>false,2,true);
 assert.equal(result.triangles,2);assert.equal(result.parts[0].material,material);assert.deepEqual(result.parts[0].geometry.getAttribute('uv').array,geometry.getAttribute('uv').array);assert.equal(resources.geometries.size,1);assert.equal(resources.materials.size,0);assert.equal(result.parts[0].geometry.userData.coverage.components,2);resources.dispose();geometry.dispose();material.dispose();
});
