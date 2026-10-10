import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {FirstPersonBody} from '../src/world/player-body.ts';
import {boneKey,makeHumanGeometries,wearFields,type MakeHumanMeta,type MakeHumanSource} from '../src/world/makehuman-body.ts';
import type {AdventureState} from '../src/world/contracts.ts';

const dir=new URL('../src/assets/player/makehuman-v65/',import.meta.url);
const meta=JSON.parse(readFileSync(new URL('makehuman-body.json',dir),'utf8')) as MakeHumanMeta;
const raw=readFileSync(new URL('makehuman-body.bin',dir));
const source=():MakeHumanSource=>({meta,bin:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)});
const bonesOf=(body:FirstPersonBody)=>{const b:THREE.Bone[]=[];body.group.traverse(o=>{if((o as THREE.Bone).isBone)b.push(o as THREE.Bone);});return b;};

test('CC0 MakeHuman body data is intact and every joint key maps onto the game skeleton',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),meta.sha256);
 const body=new FirstPersonBody(),keys=new Set(bonesOf(body).map(boneKey));
 for(const key of meta.boneKeys)assert.ok(keys.has(key),key);
 const geometries=makeHumanGeometries(source(),bonesOf(body));
 assert.deepEqual([...geometries.keys()],['body','eyes','eyebrows','eyelashes']);
 const g=geometries.get('body')!,w=g.getAttribute('skinWeight'),p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){
  assert.ok([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));
  assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-4);
 }
 g.computeBoundingBox();const box=g.boundingBox!;
 assert.ok(Math.abs(box.max.y-1.748)<.01,`head top ${box.max.y}`);assert.ok(box.min.y> -.01);
 // The first-person eye (head bone origin) lies inside the head, behind the real eyes.
 const eyes=geometries.get('eyes')!;eyes.computeBoundingBox();const e=eyes.boundingBox!.getCenter(new THREE.Vector3());
 assert.ok(Math.abs(e.y-1.64)<.02);assert.ok(e.z< -.056,'eyes in front of the camera');assert.ok(-.056-e.z<.12,'within the 12cm near plane');
 body.dispose();
});

test('swapping to MakeHuman changes no bone, keeps the gear and skins finitely across actions',()=>{
 const camera=new THREE.PerspectiveCamera(75,1.6,.05,100);camera.position.set(0,1.64,0);camera.updateMatrixWorld();
 const plain=new FirstPersonBody(),swapped=new FirstPersonBody();swapped.useMakeHuman(source());
 const meshes=swapped.group.children.filter(c=>(c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
 assert.equal(meshes.length,5,'sculpted gear + body, eyes, eyebrows, eyelashes');
 const gear=meshes[0];assert.ok(gear.geometry.index!.count/3===swapped.group.userData.makehuman.gearTriangles&&gear.geometry.index!.count>3000);
 for(const m of meshes.slice(1))assert.equal(m.skeleton,gear.skeleton,'one shared skeleton');
 const state={mode:'walk',position:new THREE.Vector3(),yaw:0,pitch:-.3,speed:1.4,oxygen:100,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''} as AdventureState;
 const v=new THREE.Vector3();
 for(const action of ['idle','walk','run','swim','dive','climb','helm'] as const){
  state.avatarAction=action;state.immersion=action==='swim'||action==='dive'?1:0;
  for(let j=0;j<8;j++){state.gaitPhase=j*.7;plain.update(state,camera,.05,j*.05);swapped.update(state,camera,.05,j*.05);}
  const a:number[]=[],b:number[]=[];plain.group.traverse(o=>{if((o as THREE.Bone).isBone)a.push(...o.matrixWorld.elements);});swapped.group.traverse(o=>{if((o as THREE.Bone).isBone)b.push(...o.matrixWorld.elements);});
  assert.deepEqual(a,b,`${action}: bones identical`);
  const body=meshes[1],p=body.geometry.getAttribute('position');
  for(let i=0;i<p.count;i+=97){v.fromBufferAttribute(p,i);body.applyBoneTransform(i,v);assert.ok([v.x,v.y,v.z].every(Number.isFinite));}
 }
 plain.dispose();swapped.dispose();
});

test('wear fields open the hood on the face only and bare the hands',()=>{
 const forward=new THREE.Vector3(0,0,-1),back=new THREE.Vector3(0,0,1);
 assert.ok(wearFields(new THREE.Vector3(0,1.62,-.12),forward,0).face>0,'cheek-nose plane is bare');
 assert.ok(wearFields(new THREE.Vector3(0,1.62,.08),back,0).face<0,'back of the head is hooded');
 assert.ok(wearFields(new THREE.Vector3(0,1.76,-.08),forward,0).face<0,'crown is hooded');
 assert.ok(wearFields(new THREE.Vector3(0,1.48,-.06),forward,0).face<0,'throat is hooded');
 assert.ok(wearFields(new THREE.Vector3(.26,.8,-.05),forward,1).hand>.5&&wearFields(new THREE.Vector3(.1,.05,0),forward,0).boot>0);
});
