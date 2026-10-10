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
import {segmentBoxFraction} from '../src/world/third-person-camera.ts';
import {WorldCollision} from '../src/world/world-collision.ts';
test('an overhanging solid between eye and lens pulls the lens in front of it',()=>{
 const solids=new WorldCollision();
 // A 4m-wide rock slab hanging 1-3m above the beach, 2m behind the player.
 solids.addBox(new THREE.Box3(new THREE.Vector3(-2,1,6.5),new THREE.Vector3(2,3,7.5)));
 const eye=new THREE.Vector3(0,1.7,5),p=new THREE.Vector3(),aim=new THREE.Vector3();
 const free=thirdPersonPose({eye,yaw:0,pitch:0,mode:'walk',heightAt:flat,waterAt:sea},p,aim);
 const d=thirdPersonPose({eye,yaw:0,pitch:0,mode:'walk',heightAt:flat,waterAt:sea,blocked:(a,b)=>solids.segmentFraction(a,b)},p,aim);
 assert.equal(free,THIRD_PERSON.walk.distance);assert.ok(d<1.5,`lens stopped at ${d}`);assert.ok(p.z<6.5,'lens stays in front of the slab');
 assert.equal(solids.segmentFraction({x:0,y:5,z:0},{x:0,y:5,z:10}),1,'clear line above it');
});
test('the vessel box blocks a lens line from outside but not from its own deck',()=>{
 const box=new THREE.Box3(new THREE.Vector3(-1.5,-.5,-4),new THREE.Vector3(1.5,2,4)),pose=new THREE.Matrix4().makeRotationY(.6).setPosition(10,0,0),inverse=pose.clone().invert();
 const outside=segmentBoxFraction(new THREE.Vector3(10,1,-10),new THREE.Vector3(10,1,10),box,inverse);
 assert.ok(outside>0&&outside<.5);
 assert.equal(segmentBoxFraction(new THREE.Vector3(10,1,0),new THREE.Vector3(10,1,10),box,inverse),1,'from the deck outwards');
 assert.equal(segmentBoxFraction(new THREE.Vector3(30,1,-10),new THREE.Vector3(30,1,10),box,inverse),1,'miss');
});

test('solid occlusion uses the water-corrected lens line',()=>{
 const solids=new WorldCollision();
 solids.addBox(new THREE.Box3(new THREE.Vector3(-2,.2,1.2),new THREE.Vector3(2,.5,3)));
 const p=new THREE.Vector3(),aim=new THREE.Vector3();
 thirdPersonPose({eye:new THREE.Vector3(0,.1,0),yaw:0,pitch:.6,mode:'swim',heightAt:()=>-20,waterAt:()=>0,blocked:(a,b)=>solids.segmentFraction(a,b)},p,aim);
 assert.ok(p.z<1.2,'the corrected sightline stops before the low overhang');
 assert.ok(p.y>=THIRD_PERSON.surface);
});

test('a shallow dive keeps feasible margins on both sides of the lens',()=>{
 const p=new THREE.Vector3(),aim=new THREE.Vector3();
 thirdPersonPose({eye:new THREE.Vector3(0,-.1,0),yaw:0,pitch:.4,mode:'dive',heightAt:()=>-.4,waterAt:()=>0},p,aim);
 assert.ok(p.y>-.4&&p.y<0,`lens stays within the water column: ${p.y}`);
 assert.ok(p.y+.4>.15&&-p.y>.15,'both margins shrink together in shallow water');
});
