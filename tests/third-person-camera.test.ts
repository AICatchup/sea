import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {THIRD_PERSON,ThirdPersonCamera,thirdPersonPose,unobstructedFraction} from '../src/world/third-person-camera.ts';
import {parseControls,defaultControls} from '../src/input/control-settings.ts';

const flat=()=>0,sea=()=>-100;
test('open ground places the lens behind and above the eye, aiming along the view',()=>{
 const p=new THREE.Vector3(),aim=new THREE.Vector3(),eye=new THREE.Vector3(10,1.7,5);
 const d=thirdPersonPose({eye,yaw:0,pitch:0,mode:'walk',heightAt:flat,waterAt:sea},p,aim);
 assert.equal(d,THIRD_PERSON.walk.distance);
 assert.ok(p.z>eye.z+3,'behind: yaw 0 looks toward -z');assert.ok(p.y>eye.y);
 assert.ok(aim.z<eye.z-7);
});
test('a hill behind the player pulls the lens in instead of burying it',()=>{
 const wall=(_x:number,z:number)=>z>6.5?10:0,p=new THREE.Vector3(),aim=new THREE.Vector3(),eye=new THREE.Vector3(0,1.7,5);
 const d=thirdPersonPose({eye,yaw:0,pitch:0,mode:'walk',heightAt:wall,waterAt:sea},p,aim);
 assert.ok(d<THIRD_PERSON.walk.distance);assert.ok(p.y>=wall(p.x,p.z)+THIRD_PERSON.ground-1e-9);
 assert.equal(unobstructedFraction(new THREE.Vector3(0,1,0),new THREE.Vector3(0,1,10),flat,.35,20),1);
});
test('the lens stays on the player side of the water surface',()=>{
 const p=new THREE.Vector3(),aim=new THREE.Vector3();
 thirdPersonPose({eye:new THREE.Vector3(0,.1,0),yaw:0,pitch:-.6,mode:'swim',heightAt:()=>-20,waterAt:()=>0},p,aim);
 assert.ok(p.y>=THIRD_PERSON.surface);
 thirdPersonPose({eye:new THREE.Vector3(0,-3,0),yaw:0,pitch:.5,mode:'dive',heightAt:()=>-20,waterAt:()=>0},p,aim);
 assert.ok(p.y<=-THIRD_PERSON.surface);
});
test('toggling eases out from the eye and first person leaves the camera alone',()=>{
 const view=new ThirdPersonCamera(),camera=new THREE.PerspectiveCamera();camera.position.set(1,2,3);
 const input={eye:new THREE.Vector3(1,2,3),yaw:0,pitch:0,mode:'walk' as const,heightAt:flat,waterAt:sea};
 view.apply(camera,input,1/60);assert.deepEqual(camera.position.toArray(),[1,2,3]);
 assert.equal(view.toggle(),'third');
 view.apply(camera,input,1/60);const first=camera.position.distanceTo(input.eye);
 for(let i=0;i<180;i++)view.apply(camera,input,1/60);
 assert.ok(first<1,'starts near the eye');assert.ok(camera.position.distanceTo(input.eye)>3);
 assert.equal(view.toggle(),'first');
});
test('saves from before the view key keep their bindings and get a free key',()=>{
 assert.deepEqual(defaultControls().bindings.view,['KeyV','']);
 const old=defaultControls(),bindings:Record<string,readonly string[]>={...old.bindings,activity:['KeyV','']};delete bindings.view;
 const parsed=parseControls(JSON.stringify({version:1,...old,bindings}));
 assert.deepEqual(parsed.bindings.activity,['KeyV','']);assert.deepEqual(parsed.bindings.view,['KeyB','']);
});
