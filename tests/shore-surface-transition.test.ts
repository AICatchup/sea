import test from 'node:test';
import assert from 'node:assert/strict';
import {shoreSurfaceBlend} from '../src/ocean/shore-surface-transition.ts';
import {referenceWetSurface} from '../src/ocean/shore-solver-reference.ts';

test('a shallow advancing bore keeps its elevation until the actual sand contact',()=>{
  const eta=.4;
  for(let bed=-.5;bed<eta;bed+=.005){
    const blend=shoreSurfaceBlend(.5,bed,1),rendered=eta*blend;
    assert.ok(rendered>bed,'rendered water must not disappear while solver says wet');
    assert.equal(rendered,eta);
  }
});
test('runup and retreat traverse the contact without forcing every front back to mean sea level',()=>{
  for(const eta of [.05,.2,.4,.8])for(const offset of [-.08,-.02,0,.02,.08]){
    const bed=eta+offset;
    const sampled=referenceWetSurface([{bed:eta-.3,h:.3,foam:.6},{bed:eta+.2,h:0,foam:0}],[.6,.4],bed)!;
    const height=sampled.eta*shoreSurfaceBlend(.5,bed,.6);
    assert.ok(Math.abs(height-eta)<1e-12);
    assert.equal(height>bed,offset<0);
  }
});
test('missing wet support, solver edges and deep-water handoff stay bounded and continuous',()=>{
  assert.equal(shoreSurfaceBlend(.5,0,0),0);assert.equal(shoreSurfaceBlend(0,0,1),0);assert.equal(shoreSurfaceBlend(.5,-11,1),0);
  let previous=0;
  for(let i=0;i<=1000;i++){
    const blend=shoreSurfaceBlend(.5,0,i/1000*.05);
    assert.ok(blend>=previous&&blend<=1);assert.ok(blend-previous<.002);previous=blend;
  }
  assert.equal(previous,1);assert.equal(shoreSurfaceBlend(NaN,0,1),0);
});
