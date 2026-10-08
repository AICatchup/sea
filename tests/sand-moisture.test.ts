import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSandMoisture,sandContact} from '../src/ocean/sand-moisture-response.ts';
import {reconstructShoreSurface} from '../src/ocean/shore-surface-transition.ts';
test('dry solver cells do not wet sand even with high offshore fallback',()=>{
  for(const bed of [-.2,0,1,3])for(const fallback of [-.8,0,2]){
    const contact=sandContact(reconstructShoreSurface(.4,bed,0,0,fallback)-bed);
    assert.equal(contact,0);assert.deepEqual(advanceSandMoisture([0,0],contact,1),[0,0]);
  }
  assert.equal(sandContact(.03),1);assert.equal(sandContact(-.015),0);assert.equal(sandContact(NaN),0);
});
test('film drains before damp sand dries, independent of frame partition',()=>{
  const wet=advanceSandMoisture([0,0],1,0);assert.deepEqual(wet,[1,1]);
  const first=advanceSandMoisture(wet,0,.8);
  assert.ok(Math.abs(first[1]-Math.exp(-1))<1e-12);assert.ok(first[0]>.99);
  const later=advanceSandMoisture(wet,0,130);
  assert.ok(Math.abs(later[0]-Math.exp(-1))<1e-12);assert.ok(later[1]<1e-60);
  let partitioned=wet;for(let i=0;i<240;i++)partitioned=advanceSandMoisture(partitioned,0,1/60);
  advanceSandMoisture(wet,0,4).forEach((v,i)=>assert.ok(Math.abs(v-partitioned[i])<1e-12));
  assert.deepEqual(advanceSandMoisture(first,0,0),first);assert.deepEqual(advanceSandMoisture(later,1,.1),[1,1]);
});
test('invalid time rejected; optical state bounded during long intervals',()=>{
  assert.throws(()=>advanceSandMoisture([1,1],0,-1),RangeError);assert.throws(()=>advanceSandMoisture([NaN,0],0,1),RangeError);
  assert.deepEqual(advanceSandMoisture([10,-3],2,1e5),[1,1]);assert.deepEqual(advanceSandMoisture([1,1],0,1e5),[0,0]);
});
