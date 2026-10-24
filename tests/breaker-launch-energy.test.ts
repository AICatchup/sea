import test from 'node:test';import assert from 'node:assert/strict';
import {breakerSheetSpeed} from '../src/ocean/connected-breakers.ts';
test('jet acceleration cannot spend more gravitational head than its crest owns',()=>{
  for(const c of [.5,1,2,5.5,8,12])for(const h of [.1,.3,1,2.5,4]){
    const v=breakerSheetSpeed(c,h);assert.ok(v>=c);
    assert.ok((v*v-c*c)/2<=9.81*h+1e-9);
  }
  const tall=breakerSheetSpeed(5.5,2.5);
  assert.ok(tall>5.5&&tall<9,'a tall crest accelerates without the previous 16m/s sheet');
  assert.equal(breakerSheetSpeed(5,0),5);assert.equal(breakerSheetSpeed(0,2),0);
  assert.equal(breakerSheetSpeed(NaN,2),0);
});
