import test from 'node:test';import assert from 'node:assert/strict';
import {breakerSheetSpeed} from '../src/ocean/connected-breakers.ts';
test('empirical launch excess is bounded in the moving-front frame by crest-to-face head',()=>{
  for(const c of [.5,1,2,5.5,8,12])for(const h of [.1,.3,1,2.5,4]){
    const v=breakerSheetSpeed(c,h);assert.ok(v>=c);
    assert.ok((v-c)**2/2<=9.81*h+1e-9);
  }
  const tall=breakerSheetSpeed(5.5,2.5);
  assert.ok(tall>11&&tall<13,'a tall crest overtakes the moving face without the original 16m/s launch');
  assert.equal(breakerSheetSpeed(5.5,50),breakerSheetSpeed(5.5,3.5),'head input is bounded even for a corrupt sample');
  assert.equal(breakerSheetSpeed(5,0),5);assert.equal(breakerSheetSpeed(0,2),0);
  assert.equal(breakerSheetSpeed(NaN,2),0);
});
