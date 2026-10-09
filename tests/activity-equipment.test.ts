import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ActivitySession} from '../src/activities/session.ts';
import {ActivityWorld} from '../src/activities/world.ts';
import type {AdventureState} from '../src/world/contracts.ts';

test('stored fishing rod remains rigidly attached as the vessel turns, pitches and rolls',()=>{
 const session=new ActivitySession({heightAt:()=>-5},()=>0,()=>true);
 const world=new ActivityWorld(session),camera=new THREE.PerspectiveCamera();
 const state:AdventureState={mode:'boat',position:new THREE.Vector3(0,1.45,0),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(-118,.2,-91),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''};
 const rod=world.group.getObjectByName('Fishing rod')!;
 try{
  world.update(state,camera,()=>0);
  rod.updateWorldMatrix(true,false);
  const mount=rod.localToWorld(new THREE.Vector3()).sub(state.boatPosition);
  const axis=rod.localToWorld(new THREE.Vector3(0,1,0)).sub(rod.getWorldPosition(new THREE.Vector3()));
  for(const [yaw,pitch,roll] of [[.9,.24,-.28],[-2.1,-.18,.19],[Math.PI,.13,.09]]){
   state.boatYaw=yaw;state.boatPitch=pitch;state.boatRoll=roll;
   world.update(state,camera,()=>0);rod.updateWorldMatrix(true,false);
   const inverseBoat=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,-yaw,roll,'YXZ')).invert();
   const actualMount=rod.getWorldPosition(new THREE.Vector3()).sub(state.boatPosition).applyQuaternion(inverseBoat);
   const actualAxis=rod.localToWorld(new THREE.Vector3(0,1,0)).sub(rod.getWorldPosition(new THREE.Vector3())).applyQuaternion(inverseBoat);
   assert.ok(actualMount.distanceTo(mount)<1e-10,'rod socket must stay at the same vessel-local point');
   assert.ok(actualAxis.distanceTo(axis)<1e-10,'rod shaft must keep its vessel-local direction through wave tilt');
  }
 }finally{world.dispose();}
});
