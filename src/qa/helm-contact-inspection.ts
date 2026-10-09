import * as THREE from 'three';
import type {Ocean} from '../ocean/renderer.ts';
import {HELM_WHEEL} from '../world/helm-contact.ts';

/** Read-only CPU skin observer of the currently rendered actor, not a posed clone. */
export function inspectCurrentHelmContact(ocean:Ocean){
 const state=ocean.adventure.state;
 if(state.mode!=='boat'||state.avatarAction!=='helm'||(state.boardingProgress??0)>0||state.activity==='fishing')return {available:false,reason:'Current actor is not at an unoccupied, completed helm pose'};
 const mesh=ocean.body.group.children.find(o=>(o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
 if(!mesh)return {available:false,reason:'Current skin mesh unavailable'};
 const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 const parts=new Map<number,string>();
 for(const side of ['left','right']){
  const wrist=mesh.skeleton.bones.find(b=>b.name===`${side} wrist`)!;
  parts.set(mesh.skeleton.bones.indexOf(wrist),`${side} palm`);
  wrist.traverse(o=>{if(o===wrist||!(o as THREE.Bone).isBone)return;let root=o;while(root.parent!==wrist)root=root.parent!;parts.set(mesh.skeleton.bones.indexOf(o as THREE.Bone),`${side} ${root.name.replace(/^(left|right) /,'').replace(/ proximal| metacarpal/,'')}`);});
 }
 const boatInverse=new THREE.Quaternion().setFromEuler(new THREE.Euler(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ')).invert();
 const tiltInverse=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-HELM_WHEEL.tilt);
 const center=new THREE.Vector3(HELM_WHEEL.x,HELM_WHEEL.y,HELM_WHEEL.z),point=new THREE.Vector3();
 const groups:Record<string,{vertices:number;minimumSignedDistanceM:number;nearestDistanceM:number;within7mm:number;deeperThan4mm:number}>={};
 for(let i=0;i<position.count;i++){
  let strongest=0;for(let j=1;j<4;j++)if(weights.getComponent(i,j)>weights.getComponent(i,strongest))strongest=j;
  const part=parts.get(indices.getComponent(i,strongest));if(!part)continue;
  point.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld).sub(state.boatPosition).applyQuaternion(boatInverse).sub(center).applyQuaternion(tiltInverse);
  const d=Math.hypot(Math.hypot(point.x,point.y)-HELM_WHEEL.radius,point.z)-HELM_WHEEL.tube;
  const result=groups[part]??={vertices:0,minimumSignedDistanceM:Infinity,nearestDistanceM:Infinity,within7mm:0,deeperThan4mm:0};
  result.vertices++;result.minimumSignedDistanceM=Math.min(result.minimumSignedDistanceM,d);result.nearestDistanceM=Math.min(result.nearestDistanceM,Math.abs(d));if(Math.abs(d)<.007)result.within7mm++;if(d<-.004)result.deeperThan4mm++;
 }
 return {available:true,evidence:'CPU-skinned vertices from current rendered actor against analytic wheel torus; not GPU depth, photographs or human acceptance',frames:ocean.diagnostics.frames,clock:ocean.diagnostics.time,camera:ocean.camera.position.toArray(),mode:state.mode,boat:{position:state.boatPosition.toArray(),yaw:state.boatYaw,pitch:state.boatPitch,roll:state.boatRoll},groups};
}
