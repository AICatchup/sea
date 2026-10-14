import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {refreshReflection} from '../src/ocean/reflection-cadence.ts';

test('stationary reflection retains the existing cadence, moving view refreshes immediately',()=>{
  const camera=new PerspectiveCamera(62,1.5),cached=camera.clone();
  assert.equal(refreshReflection(1,camera,cached,false,false,false),false);
  assert.equal(refreshReflection(3,camera,cached,false,false,false),true);
  camera.position.x+=.02;assert.equal(refreshReflection(1,camera,cached,false,false,false),true);
  cached.copy(camera);assert.equal(refreshReflection(2,camera,cached,false,false,false),false);
  camera.rotateY(.01);assert.equal(refreshReflection(2,camera,cached,false,false,false),true);
});
test('interface, FOV, aspect and resized target invalidate reflection without waiting three frames',()=>{
  const camera=new PerspectiveCamera(62,1.5),cached=camera.clone();
  assert.equal(refreshReflection(1,camera,cached,true,false,false),true);
  assert.equal(refreshReflection(1,camera,cached,false,false,true),true);
  camera.fov=78;assert.equal(refreshReflection(1,camera,cached,false,false,false),true);
  cached.copy(camera);camera.aspect=2;assert.equal(refreshReflection(1,camera,cached,false,false,false),true);
});
