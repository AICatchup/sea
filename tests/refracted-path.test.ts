import test from 'node:test';import assert from 'node:assert/strict';
import {flatWaterPath} from '../src/ocean/refracted-path.ts';
test('Snell path retains normal incidence and limits grazing underwater absorption distance',()=>{
  assert.equal(flatWaterPath(4,1),4);
  const grazing=flatWaterPath(.4,.3);assert.ok(grazing>.4&&grazing<.6);
  assert.ok(Math.abs(flatWaterPath(.4,.3,1)-.4/.3)<1e-12);
  assert.ok(flatWaterPath(4,0)<6.1,'water path remains finite at air grazing');
  assert.ok(Math.exp(-.105*grazing)>Math.exp(-.105*(.4/.3)),'shorter underwater path transmits source red light without tint gain');
});
test('flat ray path scales with depth and rejects unphysical arguments',()=>{
  assert.equal(flatWaterPath(0,.3),0);assert.ok(Math.abs(flatWaterPath(10,.5)-flatWaterPath(1,.5)*10)<1e-12);
  for(const args of [[-1,.5],[1,NaN],[1,1.1],[1,.5,.9]])assert.throws(()=>flatWaterPath(...args as [number,number,number?]));
});
