import * as THREE from 'three';
import {FirstPersonBody} from '../world/player-body.ts';
import type {AdventureState} from '../world/contracts.ts';
import {SkinnedReceivers} from '../ocean/skinned-receivers.ts';
import {gpuSkinnedParity} from './gpu-skinned-parity.ts';

/** A separate instance of the actual full body. No live player, save, or pose is edited. */
export function inspectGpuSkinOnDevice(renderer:THREE.WebGLRenderer){
 const body=new FirstPersonBody(),camera=new THREE.PerspectiveCamera();camera.position.set(0,1.64,0);
 const state={mode:'walk',position:new THREE.Vector3(),yaw:0,pitch:0,speed:4,oxygen:1,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''} as AdventureState;
 body.update(state,camera,.08,0);
 body.group.traverse(o=>{if(o instanceof THREE.SkinnedMesh&&!o.skeleton.boneTexture)o.skeleton.computeBoneTexture();});
 const oracle=new SkinnedReceivers(body.group),labels:string[]=[],poses:(()=>void)[]=[];
 const actions=['idle','walk','run','swim','dive','helm','climb'] as const;
 for(const action of actions)for(let j=0;j<3;j++){
  labels.push(`${action}-${j}`);poses.push(()=>{state.avatarAction=action;state.gaitPhase=j*2.1;state.immersion=action==='swim'||action==='dive'?1:0;body.update(state,camera,.08,j*.4);});
 }
 for(const x of [6000,-6000]){labels.push(`island-offset-${x}`);poses.push(()=>{camera.position.set(x,1.64,-4000);state.position.set(x,0,-4000);state.avatarAction='walk';state.immersion=0;body.update(state,camera,.08,2);});}
 try{return {...gpuSkinnedParity(renderer,oracle,poses),labels,scope:'Actual full FirstPersonBody in a separate instance, 21 animation poses plus two 6km offsets; full packed GPU readback vs CPU, not gameplay speed or whole optical quality'};}
 finally{oracle.dispose();body.dispose();}
}
