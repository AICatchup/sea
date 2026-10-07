import test from 'node:test';
import assert from 'node:assert/strict';
import {coastalWaveScale} from '../src/ocean/surface-detail.ts';

test('incident forcing cannot create water directly above dry sand or cliffs',()=>{
  for(const bed of [0,.1,.8,2,10,100])for(const crest of [.2,1.4,4]){
    assert.equal(Math.max(0,crest*coastalWaveScale(bed,1,1,12)-bed),0);
  }
  assert.equal(Math.max(0,1.4-.8),.5999999999999999,'the former raw FFT forcing directly filled dry land');
});
test('open deep water retains its input while shallow and sheltered boundaries match the wave envelope',()=>{
  assert.equal(coastalWaveScale(-20,1,1,12),1);
  const exposed=coastalWaveScale(-2,1,1,12),sheltered=coastalWaveScale(-2,.1,1,12);
  assert.ok(Math.abs(sheltered/exposed-.1)<1e-12);
  assert.ok(coastalWaveScale(-.1,1,1,12)<exposed);
  assert.ok(coastalWaveScale(-8,1,1,12)>1,'finite-depth shoaling is retained before breaking');
});
test('shore envelope stays finite and continuous to the dry shoreline',()=>{
  let previous=0;
  for(let i=0;i<=1000;i++){
    const next=coastalWaveScale(-i*.0005,1,1,12);
    assert.ok(next>=previous&&next-previous<.002);previous=next;
  }
});
