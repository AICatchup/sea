import test from 'node:test';
import assert from 'node:assert/strict';
import {coastalWindDetailScale,coastalWaveScale} from '../src/ocean/surface-detail.ts';

test('short wind waves survive where the metre-scale storm swell is depth-limited',()=>{
  assert.equal(coastalWindDetailScale(2,1,16),1);
  assert.ok(coastalWaveScale(-2,1,1.8,16)<.2);
  assert.ok(coastalWindDetailScale(.1,1,16)<.1);
  assert.equal(coastalWindDetailScale(0,1,16),0);
});

test('wind detail has continuous bounded wet-contact and shelter attenuation',()=>{
  let previous=0;
  for(let i=0;i<=2000;i++){
    const value=coastalWindDetailScale(i/1000,1,16);
    assert.ok(value>=previous&&value<=1&&value-previous<.01);
    assert.ok(Math.abs(coastalWindDetailScale(i/1000,.2,16)-value*.2)<1e-12);
    previous=value;
  }
  for(const bad of [NaN,Infinity,-1])assert.equal(coastalWindDetailScale(bad,1,16),0);
});
