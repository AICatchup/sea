import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {IslandElevation} from '../src/world/geodata.ts';
import {WorldCollision} from '../src/world/world-collision.ts';
const bytes=fs.readFileSync(new URL('../src/assets/coast/tomari-west-volume-v32.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
const e=new IslandElevation(true,true,false),result={meshes:meshes.length,bytes:bytes.length,vertices:0,triangles:0,nonfinite:0,hiddenSamples:0,maxHiddenExposure:-Infinity,exposedFront:0,minExposedY:Infinity,maxExposedY:-Infinity,edgesNotPaired:0,probes:[]};
const solids=new WorldCollision();result.exposedHiddenFaces=[];
for(const mesh of meshes){
 mesh.geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);mesh.matrixWorld.identity();mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);
 const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;result.vertices+=p.count;result.triangles+=index.count/3;
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e4)).join(',');const edges=new Map();
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
 for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
  for(let k=0;k<3;k++){const x=key(ids[k]),y=key(ids[(k+1)%3]),edge=x<y?x+'|'+y:y+'|'+x;edges.set(edge,(edges.get(edge)??0)+1);}
  normal.crossVectors(b.clone().sub(a),c.clone().sub(a));const hidden=normal.x<1e-9;
  const mid=a.clone().add(b).add(c).multiplyScalar(1/3),above=mid.y-e.heightAt(mid.x,mid.z);
  if(hidden){for(const point of [a,b,c,mid,a.clone().add(b).multiplyScalar(.5),b.clone().add(c).multiplyScalar(.5),c.clone().add(a).multiplyScalar(.5)]){const exposure=point.y-e.heightAt(point.x,point.z);result.hiddenSamples++;result.maxHiddenExposure=Math.max(result.maxHiddenExposure,exposure);if(exposure>.03)result.exposedHiddenFaces.push({mid:point.toArray(),above:exposure,normal:normal.clone().normalize().toArray()});}}
  else if(above>.03){result.exposedFront++;result.minExposedY=Math.min(result.minExposedY,a.y,b.y,c.y);result.maxExposedY=Math.max(result.maxExposedY,a.y,b.y,c.y);}
 }
 result.edgesNotPaired+=[...edges.values()].filter(n=>n!==2).length;
 result.nonfinite+=Array.from(p.array).filter(v=>!Number.isFinite(v)).length;
 solids.addMesh(mesh,new THREE.Matrix4());
}
for(const [z,y] of [[-32,8],[-22,10],[-9,12],[4,10],[15,10]]){
 const from={x:-75,y,z},to={x:-143,y,z};const hit=solids.sweepBody(from,to,.38,1.72);result.probes.push({kind:'wall',from,to,blocked:hit.blocked,fraction:hit.fraction});
}
for(const [from,to] of [[{x:-86,y:0,z:-36},{x:-86,y:0,z:-10}],[{x:-42,y:0,z:9},{x:-36,y:0,z:27}],[{x:-56,y:-1,z:-50},{x:-20,y:-1,z:-40}]]){const hit=solids.sweepBody(from,to,.38,1.72);result.probes.push({kind:'shore/boat-clearance',from,to,blocked:hit.blocked});}
result.exposedHiddenFaceCount=result.exposedHiddenFaces.length;result.exposedHiddenFaces.sort((a,b)=>b.above-a.above);result.exposedHiddenFaces.length=Math.min(6,result.exposedHiddenFaces.length);
console.log(JSON.stringify(result,null,2));
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
solids.dispose();
assert.equal(result.meshes,1);assert.ok(result.triangles<130000);assert.equal(result.nonfinite,0);assert.equal(result.edgesNotPaired,0);
assert.ok(result.maxHiddenExposure<.03,`Closure exposed by ${result.maxHiddenExposure}m`);
for(const p of result.probes)assert.equal(p.blocked,p.kind==='wall',p.kind);
