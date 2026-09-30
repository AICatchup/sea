import test from 'node:test';
import assert from 'node:assert/strict';
import {shoreBreakerDissipation as loss} from '../src/ocean/shore-breaker-dissipation.ts';

test('actual low/negative crest and protected/land/deep controls never infer loss',()=>{
  for(const raw of [-10,0,.01,.1])assert.equal(loss(raw,-1,1,1.3,14),0);
  for(const ground of [0,1,-.1,-4,-110])assert.equal(loss(10,ground,1,1.3,14),0);
  assert.equal(loss(10,-1,.13,1.3,14),0);
  assert.equal(loss(10,-1,0,1.3,14),0);
  // High actual crest cannot create loss when the existing nominal cap is inactive.
  assert.equal(loss(10,-3,1,.3,2),0);
});

test('energy is bounded by both actually discarded energy and physical envelope excess',()=>{
  // Independent specific-energy comparison E proportional crest squared.
  const transport=8**.125,amplitude=1.3*(.1+.013*14*14);
  const uncapped=2*1.3*transport,capped=uncapped*.38/amplitude;
  const discarded=(uncapped*uncapped-capped*capped)/(uncapped*uncapped);
  const beyond=(uncapped*uncapped-(.73/2)**2)/(uncapped*uncapped);
  assert.ok(Math.abs(loss(2,-1,1,1.3,14)-Math.min(discarded,beyond))<1e-12);
  for(const raw of [.3,.5,1,2,20]){
    const value=loss(raw,-1,1,1.3,14);
    assert.ok(value>=0&&value<=discarded+1e-12);
  }
});

test('depth-envelope onset is continuous and increasing crest cannot decrease loss',()=>{
  const onset=.73/(2*1.3*8**.125);
  assert.equal(loss(onset*.999999,-1,1,1.3,14),0);
  assert.ok(loss(onset*1.000001,-1,1,1.3,14)<.000003);
  let previous=0;
  for(let raw=0;raw<5;raw+=.01){
    const current=loss(raw,-1,1,1.3,14);
    assert.ok(current>=previous-1e-12);previous=current;
  }
});

test('uncapped crest includes swell exactly once and exposure before the physical criterion',()=>{
  const onset=.73/(2*1.3*8**.125);
  assert.equal(loss(onset*1.1,-1,.5,1.3,14),0);
  assert.ok(loss(onset*1.1,-1,1,1.3,14)>0);
  assert.equal(loss(onset*.8,-1,1,1.3,14),0);
  assert.ok(loss(onset*.8,-1,1,2,14)>0);
  for(const bad of [NaN,Infinity,-Infinity]){
    assert.equal(loss(bad,-1,1,1.3,14),0);
    assert.equal(loss(1,bad,1,1.3,14),0);
    assert.equal(loss(1,-1,bad,1.3,14),0);
    assert.equal(loss(1,-1,1,bad,14),0);
    assert.equal(loss(1,-1,1,1.3,bad),0);
  }
});
