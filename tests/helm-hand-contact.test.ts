import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FirstPersonBody} from '../src/world/player-body.ts';
import {BOAT_ACCESS,type AdventureState} from '../src/world/contracts.ts';

test('both rendered palms and every digit reach the tilted wheel without deep penetration across boat and head poses',()=>{
 const body=new FirstPersonBody(),camera=new THREE.PerspectiveCamera(78,16/9,.08,100),scene=new THREE.Scene();scene.add(body.group);
 const mesh=body.group.children.find(o=>(o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
 const p=mesh.geometry.getAttribute('position'),ids=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 const selections:Record<string,number[]>={};
 for(const side of ['left','right']){
  const wrist=mesh.skeleton.bones.find(b=>b.name===`${side} wrist`)!,parts=new Map<number,string>();parts.set(mesh.skeleton.bones.indexOf(wrist),'palm');
  wrist.traverse(o=>{if(o===wrist||!(o as THREE.Bone).isBone)return;let top=o;while(top.parent!==wrist)top=top.parent!;parts.set(mesh.skeleton.bones.indexOf(o as THREE.Bone),top.name.replace(/^(left|right) /,'').replace(/ proximal| metacarpal/,''));});
  for(let i=0;i<p.count;i++){let strongest=0;for(let j=1;j<4;j++)if(weights.getComponent(i,j)>weights.getComponent(i,strongest))strongest=j;const part=parts.get(ids.getComponent(i,strongest));if(part)(selections[`${side} ${part}`]??=[]).push(i);}
 }
 const state:AdventureState={mode:'boat',position:new THREE.Vector3(),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',avatarAction:'helm',grounded:true};
 const point=new THREE.Vector3(),boat=new THREE.Quaternion(),inverseBoat=new THREE.Quaternion(),inverseTilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.26);
 try{
  for(const [yaw,pitch,roll] of [[0,0,0],[.9,.24,-.28],[-2.7,-.24,.28]])for(const look of [-Math.PI-.02,-Math.PI,-1.4,0,1.4,Math.PI,Math.PI+.02])for(const glance of [-1.3,0,1.3]){
   state.boatPosition.set(-118,.38,-91);state.boatYaw=yaw;state.boatPitch=pitch;state.boatRoll=roll;state.yaw=yaw+look;state.pitch=glance;
   boat.setFromEuler(new THREE.Euler(pitch,-yaw,roll,'YXZ'));inverseBoat.copy(boat).invert();
   camera.position.set(...BOAT_ACCESS.helm).applyQuaternion(boat).add(state.boatPosition);state.position.copy(camera.position);
   for(let i=0;i<150;i++)body.update(state,camera,1/60,i/60);
   for(const [part,selection] of Object.entries(selections)){
    let minimum=Infinity,closest=Infinity,near=0;
    for(const index of selection){point.fromBufferAttribute(p,index);mesh.applyBoneTransform(index,point);point.applyMatrix4(mesh.matrixWorld).sub(state.boatPosition).applyQuaternion(inverseBoat).sub(new THREE.Vector3(.26,1.065,.23)).applyQuaternion(inverseTilt);
     const distance=Math.hypot(Math.hypot(point.x,point.y)-.15,point.z)-.017;minimum=Math.min(minimum,distance);closest=Math.min(closest,Math.abs(distance));if(Math.abs(distance)<.007)near++;}
    const label=`${part}, boat ${yaw}/${pitch}/${roll}, look ${look}/${glance}`;
    assert.ok(closest<.004,`surface gap ${closest}: ${label}`);
    assert.ok(minimum>-.004,`deep skin penetration ${minimum}: ${label}`);
    assert.ok(near/selection.length>.02,`contact must involve a region, not one coincident vertex: ${label}`);
   }
  }
 }finally{body.dispose();}
});

test('seated boots and pelvis stay in the same vessel frame through its full roll and pitch',()=>{
 const body=new FirstPersonBody(),camera=new THREE.PerspectiveCamera(),scene=new THREE.Scene();scene.add(body.group);
 const mesh=body.group.children.find(o=>(o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
 const p=mesh.geometry.getAttribute('position'),ids=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 const ankles=new Set(mesh.skeleton.bones.map((b,i)=>b.name.endsWith('ankle')?i:-1).filter(i=>i>=0));
 const pelvis=mesh.skeleton.bones.find(b=>b.name==='pelvis')!;
 const pelvisIndex=mesh.skeleton.bones.indexOf(pelvis);
 const state:AdventureState={mode:'boat',position:new THREE.Vector3(),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(83,.5,-201),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',avatarAction:'helm',grounded:true};
 let baseline:THREE.Vector3|undefined;
 try{
  for(const [yaw,pitch,roll] of [[0,0,0],[.9,.24,-.28],[-2.7,-.24,.28]]){
   const boat=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,-yaw,roll,'YXZ')),inverse=boat.clone().invert();
   state.boatYaw=state.yaw=yaw;state.boatPitch=pitch;state.boatRoll=roll;
   camera.position.set(...BOAT_ACCESS.helm).applyQuaternion(boat).add(state.boatPosition);state.position.copy(camera.position);
   for(let i=0;i<150;i++)body.update(state,camera,1/60,i/60);
   const pelvisLocal=pelvis.getWorldPosition(new THREE.Vector3()).sub(state.boatPosition).applyQuaternion(inverse);
   if(!baseline)baseline=pelvisLocal;else assert.ok(pelvisLocal.distanceTo(baseline)<1e-5,'seat anchor must move with the tilted vessel');
   let minimumY=Infinity,seatSurface=Infinity;
   for(let i=0;i<p.count;i++)if(ankles.has(ids.getX(i))&&weights.getX(i)>.99){const point=new THREE.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld).sub(state.boatPosition).applyQuaternion(inverse);minimumY=Math.min(minimumY,point.y);}
   for(let i=0;i<p.count;i++)if(ids.getX(i)===pelvisIndex&&weights.getX(i)>.99&&p.getY(i)<.94){const point=new THREE.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld).sub(state.boatPosition).applyQuaternion(inverse);seatSurface=Math.min(seatSurface,point.y);}
   assert.ok(minimumY>.106&&minimumY<.125,`boots remain on .1125 m vessel-local deck: ${minimumY}`);
   assert.ok(Math.abs(seatSurface-(.64+.115/2))<.0075,`skin remains at the authored cushion top: ${seatSurface}`);
  }
 }finally{body.dispose();}
});
