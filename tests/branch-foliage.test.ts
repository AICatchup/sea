import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {branchCanopyLevels,branchClusters,branchGeometry} from '../src/world/branch-foliage.ts';
import {ModelResources} from '../src/world/models/procedural.ts';
import {FoliageLodField} from '../src/world/foliage-lod.ts';
import type {FoliageVariant,FoliageLevels} from '../src/world/foliage.ts';

function nativeCanopy(id:number):FoliageLevels{
 const bytes=readFileSync(new URL(`../src/assets/foliage/cc0/canopy/canopy${id}-lod-1k.glb`,import.meta.url)),length=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+length).toString()),binary=bytes.subarray(28+length);
 const attribute=(index:number)=>{const a=g.accessors[index],v=g.bufferViews[a.bufferView],T=a.componentType===5126?Float32Array:a.componentType===5125?Uint32Array:Uint16Array,components=a.type==='VEC3'?3:a.type==='VEC2'?2:1;assert.equal(v.byteStride,undefined);return new THREE.BufferAttribute(new T(new T(binary.buffer,binary.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*components)),components);};
 const level=(name:string):FoliageVariant=>{
  const node=g.nodes.find((n:{name:string})=>n.name===`canopy${id}_${name}_0`);
  const parts=g.meshes[node.mesh].primitives.map((p:{material:number;indices:number;attributes:{POSITION:number}})=>{
   const material=new THREE.MeshStandardMaterial();material.name=g.materials[p.material].name;material.userData.foliageRole=material.name.includes('leaves')?'leaves':material.name.includes('branches')?'branches':'trunk';
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',attribute(p.attributes.POSITION));geometry.setIndex(attribute(p.indices));geometry.computeBoundingBox();return {geometry,material};
  });return {parts,triangles:parts.reduce((sum:number,p:{geometry:THREE.BufferGeometry})=>sum+p.geometry.index!.count/3,0)};
 };
 return {near:[level('near')],mid:[level('mid')],far:[level('far')]};
}

test('all three native crowns retain their trunks, source detail and bounded branch volumes across distance bands',()=>{
 for(let id=0;id<3;id++){
  const original=nativeCanopy(id),resources=new ModelResources(),material=new THREE.MeshStandardMaterial(),group=new THREE.Group();
  const source=original.near[0],bytes=source.parts.map(p=>Buffer.from(p.geometry.getAttribute('position').array.buffer).toString('base64'));
  const clusters=branchClusters(source,'pine',817+id*127),copy=branchClusters(source,'pine',817+id*127);
  assert.deepEqual(clusters,copy);assert.ok(clusters.length>30&&clusters.length<=42);
  const changed=branchCanopyLevels(source,{near:source,mid:original.mid[0],far:original.far[0]},material,resources,'pine',817+id*127);
  const candidate={near:[changed[0]],mid:[changed[1]],far:[changed[2]]};
  assert.equal(changed[0],source,'no extra geometry at first-person distances');
  assert.ok(changed[2].triangles<=original.far[0].triangles+168,'bounded supplementary far crown');
  source.parts.forEach((part,i)=>{assert.ok(changed[0].parts.includes(part));assert.equal(Buffer.from(part.geometry.getAttribute('position').array.buffer).toString('base64'),bytes[i]);});
  const sourceBounds=new THREE.Box3();source.parts.forEach(p=>sourceBounds.union(p.geometry.boundingBox!));sourceBounds.expandByScalar(.6);
  for(const variant of changed.slice(1)){
   const geom=variant.parts.at(-1)!.geometry,points=geom.getAttribute('position'),normals=geom.getAttribute('normal');assert.ok(sourceBounds.containsBox(geom.boundingBox!));
   for(let i=0;i<points.count;i++){assert.ok([points.getX(i),points.getY(i),points.getZ(i)].every(Number.isFinite));assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5);}
  }
  const matrices=[[new THREE.Matrix4().makeTranslation(11,7,-32),new THREE.Matrix4().makeRotationY(.8).setPosition(-80,4,-100)]];
  const config={nearDistance:35,midDistance:210,nearCapacity:2,midCapacity:2};
  const before=new FoliageLodField(group,'before',original,matrices,config),after=new FoliageLodField(group,'after',candidate,matrices,config);
  assert.deepEqual(after.getTrunkProxies(),before.getTrunkProxies());
  after.update(new THREE.Vector3(150,5,20),true);assert.deepEqual(after.getTrunkProxies(),before.getTrunkProxies());
  before.dispose();after.dispose();resources.dispose();material.dispose();
 }
});

test('branch patches have multiple fixed surface directions and different detail levels do not move their centres',()=>{
 const levels=nativeCanopy(0),clusters=branchClusters(levels.near[0],'pine',918),near=branchGeometry(clusters,3),far=branchGeometry(clusters,1);
 const normals=near.getAttribute('normal'),directions=new Set<string>();for(let i=0;i<normals.count;i++)directions.add(`${Math.round(normals.getX(i)*3)}:${Math.round(normals.getY(i)*3)}:${Math.round(normals.getZ(i)*3)}`);
 assert.ok(directions.size>12);assert.ok(near.boundingBox!.getCenter(new THREE.Vector3()).distanceTo(far.boundingBox!.getCenter(new THREE.Vector3()))<.2);
 assert.throws(()=>branchGeometry(clusters,0));near.dispose();far.dispose();
});
