import test from 'node:test';
import assert from 'node:assert/strict';
import {foamOpticalCoverage,foamMicroCoverage} from '../src/ocean/foam-appearance.ts';

test('dense aerated crest closes optical holes without strengthening diluted remnants',()=>{
 for(const field of [0,.1,.3,.6,1])for(const footprint of [0,.1,1,4]){
  assert.ok(foamOpticalCoverage(1,field,footprint)>=.9-1e-12);
  assert.equal(foamOpticalCoverage(0,field,footprint),0);
  assert.ok(foamOpticalCoverage(.15,field,footprint)<=.15);
 }
 assert.equal(foamOpticalCoverage(.3,0,0),0,'thin clear pockets still expose the water');
 assert.ok(foamOpticalCoverage(.8,0,0)>.45,'a fresh crest must not stay mirror-clear through atlas holes');
});

test('dilution exposes pores continuously and coverage stays below transported area',()=>{
 for(const field of [0,.05,.2,.8])for(const footprint of [0,.5,4]){
  let previous=0;
  for(let i=0;i<=1000;i++){
   const c=i/1000,value=foamOpticalCoverage(c,field,footprint);
   assert.ok(value>=previous-1e-12&&value<=c+1e-12);
   assert.ok(value-previous<.005,'no density threshold pop');previous=value;
  }
 }
});

test('microstructure cannot reopen clear holes in thick froth but preserves thin rafts',()=>{
 for(const opacity of [0,.2,.6,1]){
  assert.equal(foamMicroCoverage(.3,opacity),opacity);
  assert.equal(foamMicroCoverage(1,opacity),1);
  let previous=opacity;
  for(let i=0;i<=1000;i++){
   const value=foamMicroCoverage(i/1000,opacity);
   assert.ok(value>=previous&&value<=1&&value-previous<.004);
   previous=value;
  }
 }
});
