import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {surveyCanopyPlacements} from '../src/world/tomari-canopy.ts';
import {TOMARI_CANOPY as data} from '../src/world/tomari-canopy.generated.ts';
import {FoliageLodField} from '../src/world/foliage-lod.ts';
import {measurePlant} from '../src/world/crown-support.ts';
const variants=[0,1,2].map(v=>{
 const f=readFileSync(new URL(`../src/assets/foliage/cc0/${v===0?'original-lod':`native-v60/canopy${v}`}/original-canopy-lod-1k.glb`,import.meta.url)),len=f.readUInt32LE(12),j=JSON.parse(f.subarray(20,20+len).toString()),offset=28+len;
 const node=j.nodes.find((n:{name:string})=>n.name==='canopy_original_near');
 const parts=j.meshes[node.mesh].primitives.map((p:{attributes:{POSITION:number};material:number})=>{
  const a=j.accessors[p.attributes.POSITION],b=j.bufferViews[a.bufferView],array=new Float32Array(a.count*3);
  for(let i=0;i<array.length;i++)array[i]=f.readFloatLE(offset+(b.byteOffset??0)+(a.byteOffset??0)+i*4);
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(array,3)),material=new THREE.MeshStandardMaterial();material.name=j.materials[p.material].name??'';
  material.userData.foliageRole=material.name.includes('leaves')?'leaves':material.name.includes('branches')?'branches':'trunk';
  return{geometry,material};
 });return{parts,triangles:0};
});
const points=new Map(data.plants.map(p=>[`${p[0]}:${p[1]}`,p]));
const ground={heightAt:(x:number,z:number)=>points.get(`${x}:${z}`)?.[3]??0};
const levels={near:variants,mid:variants,far:variants};
test('point-guided native canopies retain source proportions and root contact',()=>{
 const result=surveyCanopyPlacements(ground,levels);assert.ok(result.diagnostics.accepted>150);assert.ok(result.diagnostics.accepted<data.count);
 result.matrices.forEach((matrices,v)=>{const source=measurePlant(variants[v]);for(const m of matrices){
  const scale=new THREE.Vector3().setFromMatrixScale(m);assert.ok(Math.abs(scale.x-scale.y)<1e-12&&Math.abs(scale.z-scale.y)<1e-12);
  const root=source.foot.clone().applyMatrix4(m),key=`${Math.round(root.x*1000)/1000}:${Math.round(root.z*1000)/1000}`,p=points.get(key);assert.ok(p);
  assert.ok(Math.abs(root.y-p[3]+.02)<1e-9);assert.ok(Math.abs(root.y+(source.bounds.max.y-source.foot.y)*scale.y-p[2]+.02)<1e-9);
 }});
 const repeat=surveyCanopyPlacements(ground,levels);assert.deepEqual(result.matrices.map(a=>a.map(m=>m.elements)),repeat.matrices.map(a=>a.map(m=>m.elements)));
 assert.equal(result.diagnostics.stemPositionsMeasured,false);
});
test('invalid or underwater roots cannot create survey trees',()=>{
 for(const value of [NaN,0,-5,100])assert.equal(surveyCanopyPlacements({heightAt:()=>value},levels).diagnostics.accepted,0);
});

test('physical proxies share the actual native near root even when far wood is displaced',()=>{
 const placed=surveyCanopyPlacements(ground,levels);
 const far=variants.map(v=>({parts:v.parts.map(p=>({geometry:p.geometry.clone().translate(.9,0,.5),material:p.material})),triangles:0}));
 const field=new FoliageLodField(new THREE.Group(),'root-test',{near:variants,mid:variants,far},placed.matrices,{nearDistance:30,midDistance:100,nearCapacity:2,midCapacity:5});
 const proxies=field.getTrunkProxies();let index=0;
 placed.matrices.forEach((list,v)=>{const foot=measurePlant(variants[v]).foot;for(const matrix of list){const world=foot.clone().applyMatrix4(matrix),proxy=proxies[index++];assert.ok(Math.hypot(proxy.x-world.x,proxy.y-world.y,proxy.z-world.z)<1e-8);}});
 field.update(new THREE.Vector3(1000,0,1000),true);assert.equal(field.getTrunkProxies(),proxies);
 field.dispose();far.forEach(v=>v.parts.forEach(p=>p.geometry.dispose()));
});
