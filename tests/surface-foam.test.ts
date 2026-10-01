import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceFoamCoverage} from '../src/ocean/surface-foam.ts';
test('quiet water has no white coverage and dense foam can close its holes',()=>{
  for(let i=0;i<=100;i++)assert.equal(surfaceFoamCoverage(0,i/100,.05),0);
  assert.equal(surfaceFoamCoverage(1,.5,.05),1);
  assert.equal(surfaceFoamCoverage(.4,.2,.05),0,'low pattern regions stay green rather than receiving a white floor');
});
test('advected concentration erodes coverage continuously and monotonically',()=>{
  for(const pattern of [.2,.5,.8]){
    let previous=0;
    for(let i=0;i<=1000;i++){
      const coverage=surfaceFoamCoverage(i/1000,pattern,.05);
      assert.ok(coverage>=previous&&coverage<=1);assert.ok(coverage-previous<.02);previous=coverage;
    }
  }
});
