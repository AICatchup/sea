import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonBody, PLAYER_BODY_DIMENSIONS } from '../../player-body.ts';

// CPU contract check: node --experimental-strip-types src/world/models/player/player-body.test.mjs
// It checks render geometry and pose contracts. It does not establish GPU appearance.

const body = new FirstPersonBody(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(68, 16/9, .08, 100);
scene.add(body.group); camera.position.set(0, 1.64, 0);
const mesh = body.group.children.find(x => x.isSkinnedMesh);
const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
assert.equal(geometry.groups.length, 7);
assert.ok(geometry.index.count / 3 < 120000);
assert.equal(mesh.skeleton.bones.filter(x=>(x.name.includes('proximal')&&!x.name.includes('thumb'))||x.name.includes('metacarpal')).length, 10);
assert.equal(PLAYER_BODY_DIMENSIONS.height, 1.75);
for (let i=0;i<position.count;i++) {
  assert.ok([position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i)].every(Number.isFinite));
  const w=geometry.getAttribute('skinWeight'); assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-6);
}
let volume=0;
const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
for(let i=0;i<geometry.index.count;i+=3) {
  a.fromBufferAttribute(position,geometry.index.getX(i));b.fromBufferAttribute(position,geometry.index.getX(i+1));c.fromBufferAttribute(position,geometry.index.getX(i+2));
  volume+=a.dot(b.cross(c))/6;
}
assert.ok(volume>.045&&volume<.16,`outward closed-volume anatomy: ${volume}`);
const leftHand=new THREE.Box3();
const leftWrist=mesh.skeleton.bones.find(x=>x.name==='left wrist'), handBones=new Set();leftWrist.traverse(x=>handBones.add(mesh.skeleton.bones.indexOf(x)));
const skinIndex=geometry.getAttribute('skinIndex'), skinWeight=geometry.getAttribute('skinWeight');
for(let i=0;i<position.count;i++) { a.fromBufferAttribute(position,i); if(handBones.has(skinIndex.getX(i))&&skinWeight.getX(i)>.5)leftHand.expandByPoint(a); }
assert.ok(leftHand.getSize(a).z>.044,'palm has actual palmar/dorsal volume');
assert.ok(leftHand.getSize(a).x>.10,'opposed thumb broadens the hand silhouette');
const state={mode:'walk',position:new THREE.Vector3(0,1.64,0),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',grounded:true,immersion:0,gaitPhase:0,stamina:1,avatarAction:'idle'};
const eyeBone=mesh.skeleton.bones.find(x=>x.name==='head');
const endpoints=mesh.skeleton.bones.filter(x=>x.name.endsWith('wrist')||x.name.endsWith('ankle'));
let previous, maxStep=0, totalFrames=0, maxAt='';
for(const action of ['idle','walk','run','swim','dive','climb','helm','idle'])for(let frame=0;frame<90;frame++) {
  state.avatarAction=action; state.mode=action==='helm'?'boat':action==='swim'?'swim':action==='dive'?'dive':'walk';
  state.speed=action==='run'?5:action==='walk'?1.6:action==='swim'?1.2:0;
  state.gaitPhase+=1/60*(state.speed*2.2+(action==='swim'||action==='dive'?3.4:0));
  state.immersion=action==='swim'?.65:action==='dive'?1:0; state.boardingProgress=frame/90;
  // Keep the eye fixed so continuity is measured independently of controller motion.
  body.update(state,camera,1/60,totalFrames++/60);
  const transformed=endpoints.map(x=>x.getWorldPosition(new THREE.Vector3()));
  if(previous) transformed.forEach((x,i)=>{const step=x.distanceTo(previous[i]);if(step>maxStep){maxStep=step;maxAt=`${action}/${frame}/${endpoints[i].name}`;}});
  previous=transformed;
  assert.ok(mesh.skeleton.boneMatrices.every(Number.isFinite));
  const eye=new THREE.Vector3().applyMatrix4(eyeBone.matrixWorld); assert.ok(eye.distanceTo(camera.position)<1e-6);
}
assert.ok(maxStep<.16,`per-frame endpoint movement ${maxStep} at ${maxAt}`);
for(const pitch of [-1.3,-.7,0,.6,1.3]) {
  state.avatarAction='idle';state.pitch=pitch;state.speed=0;state.yaw=.72;
  for(let i=0;i<120;i++)body.update(state,camera,1/60,i/60);
  const direction=new THREE.Vector3(Math.sin(state.yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(state.yaw)*Math.cos(pitch));
  const hits=new THREE.Raycaster(camera.position,direction,camera.near,5).intersectObject(mesh);
  assert.ok(!hits.length||hits[0].distance>.12,`head/near intrusion at pitch ${pitch}: ${hits[0]?.distance}`);
}
// View-only bob must not lift the whole body or leave the camera outside the head.
state.pitch=0;state.yaw=0;state.viewOffset=new THREE.Vector3();camera.position.copy(state.position);
body.update(state,camera,0,3);
const planted=mesh.skeleton.bones.filter(x=>x.name.endsWith('ankle')).map(x=>x.getWorldPosition(new THREE.Vector3()));
state.viewOffset.set(.008,.035,-.004);camera.position.copy(state.position).add(state.viewOffset);body.update(state,camera,0,3);
assert.ok(mesh.skeleton.bones.filter(x=>x.name.endsWith('ankle')).every((x,i)=>x.getWorldPosition(new THREE.Vector3()).distanceTo(planted[i])<1e-6));
state.viewOffset.set(0,0,0);
// Verify the actual seat/helm configuration in boat coordinates, including look-around.
state.avatarAction='helm';state.mode='boat';state.speed=0;state.yaw=0;state.pitch=0;
camera.position.set(.48,1.45,.76);
for(let i=0;i<180;i++)body.update(state,camera,1/60,i/60);
const ankles=mesh.skeleton.bones.filter(x=>x.name.endsWith('ankle')).map(x=>x.getWorldPosition(new THREE.Vector3()));
assert.ok(ankles.every(x=>x.y>.14&&x.y<.24),'seated feet remain above boat floor');
const ankleIndices=new Set(mesh.skeleton.bones.map((x,i)=>x.name.endsWith('ankle')?i:-1).filter(i=>i>=0));
let bootFloor=Infinity;
for(let i=0;i<position.count;i++)if(ankleIndices.has(skinIndex.getX(i))&&skinWeight.getX(i)>.99){a.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,a);a.applyMatrix4(mesh.matrixWorld);bootFloor=Math.min(bootFloor,a.y);}
assert.ok(bootFloor>.106&&bootFloor<.125,`boot contact at the boat's .1125 m floor: ${bootFloor}`);
const wrists=mesh.skeleton.bones.filter(x=>x.name.endsWith('wrist')).map(x=>x.getWorldPosition(new THREE.Vector3()));
const wristBefore=wrists.map(x=>x.clone());state.yaw=.8;
for(let i=0;i<180;i++)body.update(state,camera,1/60,i/60);
const wristAfter=mesh.skeleton.bones.filter(x=>x.name.endsWith('wrist')).map(x=>x.getWorldPosition(new THREE.Vector3()));
assert.ok(wristAfter.every((x,i)=>x.distanceTo(wristBefore[i])<.06),'helm hands stay near the wheel during head yaw');
// Bad optional telemetry must not poison matrices or material roughness.
state.boatPitch=NaN;state.boatRoll=NaN;state.immersion=NaN;state.velocity=new THREE.Vector3(0,NaN,0);
body.update(state,camera,1/60,10); assert.ok(mesh.skeleton.boneMatrices.every(Number.isFinite));
assert.ok(mesh.material.every(x=>Number.isFinite(x.roughness)));
let disposals=0; for(const item of [mesh.geometry,...mesh.material,...new Set(mesh.material.flatMap(x=>[x.normalMap,x.roughnessMap]).filter(Boolean))])item.addEventListener('dispose',()=>disposals++);
body.dispose();body.dispose();assert.equal(disposals,12);assert.equal(body.group.children.length,0);assert.equal(body.group.parent,null);
console.log(JSON.stringify({triangles:geometry.index.count/3,vertices:position.count,bones:mesh.skeleton.bones.length,draws:geometry.groups.length,signedVolume:volume,handSize:leftHand.getSize(new THREE.Vector3()).toArray(),maxEndpointStep:maxStep,helmWrists:wrists.map(x=>x.toArray()),helmAnkles:ankles.map(x=>x.toArray()),disposedResources:disposals,pass:true},null,2));
