import test from 'node:test';import assert from 'node:assert/strict';
import {reconstructShoreSurface} from '../src/ocean/shore-surface-transition.ts';

test('a drained shallow cell cannot resurrect its higher FFT wave as an isolated spike',()=>{
  assert.ok(Math.abs(reconstructShoreSurface(.5,-.8,0,0,-.3)+.815)<1e-12);
  assert.ok(reconstructShoreSurface(.5,-.8,.001,-.72,-.3)<-.8);
  // Dry land stays hidden below land, without raising a water vertex to a cliff.
  assert.equal(reconstructShoreSurface(.5,80,0,0,.4),.4);
});
test('wet runup, offshore waves and the domain edge retain their own free surface',()=>{
  assert.ok(Math.abs(reconstructShoreSurface(.5,.6,1,1.25,-.2)-1.25)<1e-9);
  assert.equal(reconstructShoreSurface(.5,-20,0,0,1.2),1.2);
  assert.equal(reconstructShoreSurface(0,-.8,0,0,.4),.4);
  let previous=-Infinity;
  for(let i=0;i<=100;i++){const height=reconstructShoreSurface(.5,-.8,i/2000,-.4,.3);assert.ok(height>=previous);assert.ok(height<=-.4+1e-9);previous=height;}
});
