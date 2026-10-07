import test from 'node:test';
import assert from 'node:assert/strict';
import {WALK_FOV,BOAT_FOV,boatWheelFov,targetCameraFov,approachCameraFov} from '../src/world/camera-lens.ts';
import {ControlSettings,defaultControls,parseControls} from '../src/input/control-settings.ts';

test('boat lens expands with seating and returns through the same continuous boarding pose',()=>{
 assert.equal(targetCameraFov({mode:'walk'},78),WALK_FOV);
 assert.equal(targetCameraFov({mode:'boat'},78),78);
 for(const mode of ['walk','boat'] as const){
  const values=[0,.25,.5,.75,1].map(seatingBlend=>targetCameraFov({mode,avatarAction:seatingBlend>.5?'helm':'climb',seatingBlend},78));
  assert.deepEqual(values,[62,66,70,74,78]);
 }
 let fov=WALK_FOV;for(let i=0;i<90;i++){const next=approachCameraFov(fov,78,1/60);assert.ok(next>=fov&&next<=78);fov=next;}assert.equal(fov,78);
 for(let i=0;i<90;i++)fov=approachCameraFov(fov,WALK_FOV,1/60);assert.equal(fov,WALK_FOV);
});
test('wheel pixel/line/page deltas have bounded consistent zoom; old preferences gain the wider boat default',()=>{
 assert.equal(boatWheelFov(78,100,0),80);assert.equal(boatWheelFov(78,1,1),boatWheelFov(78,16,0));
 assert.equal(boatWheelFov(78,1,2),boatWheelFov(78,160,0));assert.equal(boatWheelFov(94,10000,0),95);assert.equal(boatWheelFov(66,-10000,0),65);
 assert.equal(boatWheelFov(78,Infinity,0),78);assert.equal(boatWheelFov(78,100,9),78);
 const legacy={version:1,...defaultControls(),boatFov:undefined};assert.equal(parseControls(JSON.stringify(legacy)).boatFov,BOAT_FOV.default);
 const store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
 const a=new ControlSettings(storage);a.setBoatFov(90);assert.equal(new ControlSettings(storage).value.boatFov,90);a.reset();assert.equal(a.value.boatFov,78);
});
