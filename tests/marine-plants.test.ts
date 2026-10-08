import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createServer} from 'vite';
import {ModelResources} from '../src/world/models/procedural.ts';
import {coastalAlgaeGeometry,coastalAlgaeMaterial,type AlgaeFamily} from '../src/world/models/coastal-algae.ts';
import {groundedPlantMatrix} from '../src/world/marine-plant-grounding.ts';

test('branched algae families have closed finite surfaces and deterministic structural diversity',()=>{
 const resources=new ModelResources(),hashes=new Set<string>();
 for(const family of ['branched','turf'] as AlgaeFamily[])for(const seed of [41,214,387,560]){
  const g=coastalAlgaeGeometry(resources,seed,family),a=g.getAttribute('position'),n=g.getAttribute('normal'),ix=g.index!;
  assert.ok(ix.count/3<40000);assert.ok(g.userData.leaves>=12);assert.ok(g.userData.branches>=6);
  const edges=new Map<string,number>();
  for(let t=0;t<ix.count;t+=3)for(const [u,v] of [[ix.getX(t),ix.getX(t+1)],[ix.getX(t+1),ix.getX(t+2)],[ix.getX(t+2),ix.getX(t)]]){
   assert.notEqual(u,v);const key=u<v?`${u}:${v}`:`${v}:${u}`;edges.set(key,(edges.get(key)??0)+1);
  }
  assert.ok([...edges.values()].every(count=>count===2),'every separate lamina/stipe surface is closed');
  for(let i=0;i<a.count;i++){
   assert.ok([a.getX(i),a.getY(i),a.getZ(i)].every(Number.isFinite));
   assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.002);
  }
  const hash=createHash('sha256').update(Buffer.from(a.array.buffer)).digest('hex');hashes.add(hash);
  const again=coastalAlgaeGeometry(resources,seed,family);
  assert.equal(createHash('sha256').update(Buffer.from(again.getAttribute('position').array.buffer)).digest('hex'),hash);
 }
 assert.equal(hashes.size,8);resources.dispose();assert.equal(resources.geometries.size,0);
});
test('final jittered root samples slope and rejects dry or invalid support',()=>{
 const ground={heightAt:(x:number,z:number)=>-4+x*.4+z*.15},p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 const matrix=groundedPlantMatrix(ground,.65,1.7,.4,1.2)!;matrix.decompose(p,q,s);
 assert.equal(p.x,.65);assert.equal(p.z,1.7);assert.ok(Math.abs(p.y+.018-ground.heightAt(p.x,p.z))<1e-10);
 assert.notEqual(p.y+.018,ground.heightAt(0,1.7),'pre-jitter height would float or bury the root');
 assert.equal(groundedPlantMatrix({heightAt:()=>.5},1,2,0,1),null);
 assert.equal(groundedPlantMatrix({heightAt:()=>NaN},1,2,0,1),null);
 assert.equal(groundedPlantMatrix(ground,NaN,2,0,1),null);
 groundedPlantMatrix({heightAt:()=>-.7},0,0,0,2,1)!.decompose(p,q,s);assert.ok(p.y+s.y<=-.12);
});
test('thin algae write real depth and share the same deformation with their shadow surface',()=>{
 const resources=new ModelResources(),time={value:4},pair=coastalAlgaeMaterial(resources,time);
 assert.equal(pair.material.transparent,false);assert.equal(pair.material.depthWrite,true);assert.equal(pair.material.side,THREE.FrontSide);
 assert.notEqual(pair.material.map,pair.material.bumpMap);assert.equal(pair.material.map!.colorSpace,THREE.SRGBColorSpace);assert.equal(pair.material.bumpMap!.colorSpace,THREE.NoColorSpace);
 const shaders=[pair.material,pair.depth].map(material=>{const shader={uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:''};material.onBeforeCompile(shader as never,{} as never);return shader;});
 assert.equal(shaders[0].vertexShader,shaders[1].vertexShader);assert.equal((shaders[0].uniforms as Record<string,unknown>).uAlgaeTime,time);
 resources.dispose();assert.equal(resources.textures.size,0);assert.equal(resources.materials.size,0);
});
test('actual habitat keeps fish seeds and grounds every opaque plant at its final position',async()=>{
 const vite=await createServer({configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'});
 try{
  const {MarineLife}=await vite.ssrLoadModule('/src/world/marine-life.ts'),height=(x:number,z:number)=>-8+x*.018+z*.025;
  const old=new MarineLife({heightAt:height},false),current=new MarineLife({heightAt:height},true);
  await Promise.all([old.ready,current.ready]);
  assert.deepEqual(current.inspectFishMotion(),old.inspectFishMotion(),'plant generation must not shift the shared fish random stream');
  const plants=current.group.children.filter((o:THREE.Object3D)=>o.userData.marinePlant) as THREE.InstancedMesh[];
  assert.equal(plants.length,12);
  const matrix=new THREE.Matrix4(),p=new THREE.Vector3();let count=0;
  for(const mesh of plants){assert.ok(mesh.customDepthMaterial);for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix);assert.ok(Math.abs(p.y+.018-height(p.x,p.z))<2e-6);count++;}}
  assert.ok(count>100);old.dispose();current.dispose();current.dispose();assert.equal(current.group.children.length,0);
 }finally{await vite.close();}
});
