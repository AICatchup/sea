import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildPhotoCoastPresentation } from '../src/world/photo-coast-presentation.ts';
import { IslandElevation, sandAt } from '../src/world/geodata.ts';
import type { ScannedRockVariant } from '../src/world/scanned-rocks.ts';

/** CPU-only position/index readback of the bundled untransformed GLB nodes.
 * This does not load maps, instantiate a renderer, or alter production loading.
 */
function scan(file:string,kind:'shelf'|'boulder'):ScannedRockVariant {
  const bytes=readFileSync(new URL(`../src/assets/marine/${file}`,import.meta.url));
  const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8'));
  assert.ok(json.nodes.every((n:{matrix?:unknown;translation?:unknown;rotation?:unknown;scale?:unknown})=>!n.matrix&&!n.translation&&!n.rotation&&!n.scale));
  const binary=bytes.subarray(28+jsonLength),primitive=json.meshes[0].primitives[0];
  const read=(id:number,components:number)=>{
    const a=json.accessors[id],v=json.bufferViews[a.bufferView],offset=(v.byteOffset??0)+(a.byteOffset??0);
    assert.equal(v.byteStride,undefined);
    const data=binary.subarray(offset,offset+a.count*components*(a.componentType===5126||a.componentType===5125?4:2));
    const copy=Uint8Array.from(data).buffer;
    return a.componentType===5126?new Float32Array(copy):a.componentType===5125?new Uint32Array(copy):new Uint16Array(copy);
  };
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(read(primitive.attributes.POSITION,3),3));
  geometry.setIndex(new THREE.BufferAttribute(read(primitive.indices,1),1));
  if(primitive.attributes.TEXCOORD_0!==undefined)geometry.setAttribute('uv',new THREE.BufferAttribute(read(primitive.attributes.TEXCOORD_0,2),2));
  geometry.computeBoundingBox();const box=geometry.boundingBox!,dimensions=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const footprint=kind==='shelf'?8:2,unit=footprint/Math.max(dimensions.x,dimensions.z);
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(unit,unit,unit).multiply(new THREE.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z)));
  return {id:file,kind,geometry,material:new THREE.MeshStandardMaterial(),triangles:geometry.index!.count/3,nativeDimensions:dimensions,footprint};
}
const variants=[scan('coast-rocks-01-2k.glb','shelf'),scan('coast-rocks-03-2k.glb','shelf'),scan('boulder-01-2k.glb','boulder'),
  scan('namaqualand-boulder-02-2k.glb','boulder'),scan('namaqualand-boulder-03-2k.glb','boulder')];

test('actual bundled scans form bounded terrain-fixed patches without mutating borrowed resources',()=>{
  const ground=new IslandElevation();
  const originals=variants.map(v=>({p:v.geometry.getAttribute('position').array.slice(),uv:v.geometry.getAttribute('uv')?.array.slice(),box:v.geometry.boundingBox!.clone()}));
  let sourceDisposals=0;variants.forEach(v=>{v.geometry.addEventListener('dispose',()=>sourceDisposals++);v.material.addEventListener('dispose',()=>sourceDisposals++);});
  const result=buildPhotoCoastPresentation(ground,variants);
  const d=result.diagnostics;
  console.log('photo coast actual scan CPU diagnostics',JSON.stringify({instances:d.instances,triangles:d.triangles,draws:d.draws,roles:d.roles,eligible:d.eligible,rejectedSupport:d.rejectedSupport,rejectedStrand:d.rejectedStrand,rejectedOverlap:d.rejectedOverlap,rejectedBudget:d.rejectedBudget,bounds:d.bounds}));
  assert.ok(d.instances>20);assert.ok(d.triangles<=1_500_000);assert.ok(d.draws<=10);assert.equal(d.textureAdditions,0);
  assert.match(d.provenance,/not measured Tomari/);
  for(const p of d.patches){assert.ok(p.exposedFraction>=.38);assert.ok(p.embeddedFraction>=.12);assert.ok(p.bounds.min.y>=2);assert.ok(p.scale<=1.45);
    for(const x of [p.bounds.min.x,p.bounds.max.x])for(const z of [p.bounds.min.z,p.bounds.max.z])assert.ok(p.bounds.min.y>=9||sandAt(x,z)<=.48);
  }
  for(const child of result.group.children){assert.ok(child instanceof THREE.InstancedMesh);assert.ok(variants.some(v=>v.geometry===child.geometry&&v.material===child.material));assert.ok(child.boundingBox&&!child.boundingBox.isEmpty());}
  result.dispose();result.dispose();assert.equal(sourceDisposals,0);assert.equal(result.group.children.length,0);
  variants.forEach((v,i)=>{assert.deepEqual(v.geometry.getAttribute('position').array,originals[i].p);assert.deepEqual(v.geometry.getAttribute('uv')?.array,originals[i].uv);assert.ok(v.geometry.boundingBox!.equals(originals[i].box));});
});

test('empty, flat, nonfinite, malformed and zero-budget cases remain empty',()=>{
  const flat={heightAt:()=>10},bad={heightAt:()=>NaN};
  for(const [ground,input,options] of [[flat,variants,{}],[bad,variants,{}],[flat,[],{}],[new IslandElevation(),variants,{triangleBudget:0}]] as const){
    const r=buildPhotoCoastPresentation(ground,input,options);assert.equal(r.diagnostics.instances,0);r.dispose();
  }
  const invalid={...variants[0],geometry:new THREE.BufferGeometry()};
  const r=buildPhotoCoastPresentation(flat,[invalid]);assert.equal(r.diagnostics.invalidVariants,1);assert.equal(r.diagnostics.draws,0);r.dispose();
  for(const options of [{triangleBudget:NaN},{bounds:{minX:0,maxX:Infinity,minZ:0,maxZ:10}},
    {bounds:{minX:10,maxX:0,minZ:0,maxZ:10}}]){
    const result=buildPhotoCoastPresentation(new IslandElevation(),variants,options);assert.equal(result.diagnostics.instances,0);result.dispose();
  }
});
