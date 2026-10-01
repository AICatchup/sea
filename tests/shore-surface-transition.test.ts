import test from 'node:test';
import assert from 'node:assert/strict';
import {shoreSurfaceBlend,shoreContactDepth} from '../src/ocean/shore-surface-transition.ts';
import {readFileSync} from 'node:fs';
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

test('coarse wet vertices cannot paint a locally dry displaced sand contact',()=>{
  // Three wet mesh vertices at eta=.6 span a dry solver cell with bed=.4.
  // The old test (bed at FFT origin=.1 vs raster height=.6) accepts it.
  const meshHeight=.6,originBed=.1,worldBed=.4;
  assert.ok(originBed<meshHeight);
  const dry=referenceWetSurface([{bed:worldBed,h:0,foam:0}],[1],worldBed);
  assert.equal(dry,null);
  // Dry support falls back to the local FFT surface (mean sea level here).
  assert.ok(shoreContactDepth(meshHeight,0,worldBed)<-.03);
  // Wet-only interpolation can extend a wet neighbour's eta across a bank;
  // the local bed must still reject that point even with wet support.
  const bank=referenceWetSurface([{bed:-.1,h:.4,foam:.5},{bed:.4,h:0,foam:0}],[.6,.4],worldBed)!;
  assert.ok(shoreContactDepth(meshHeight,bank.eta,worldBed)<-.03);
});

test('pointwise contact preserves a shallow positive bore and respects mesh depth',()=>{
  const eta=.4;
  for(const bed of [.05,.2,.35]){
    const wet=referenceWetSurface([{bed,h:eta-bed,foam:.6}],[1],bed)!;
    assert.ok(shoreContactDepth(eta,wet.eta,bed)>0);
  }
  assert.ok(shoreContactDepth(.1,.4,.2)<0,'pointwise height must not lift submerged geometry');
  const shader=readFileSync(new URL('../src/ocean/shaders.ts',import.meta.url),'utf8');
  assert.match(shader,/vec3 coast=coastAt\(vWorld\.xz\)/);
  assert.match(shader,/contactHeight=renderedSurface\(vWorld\.xz\)/);
  assert.match(shader,/shoreContactDepth\(vWorld\.y,contactHeight,coast\.x\)/);
});
