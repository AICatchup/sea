import test from 'node:test';
import assert from 'node:assert/strict';
import {crestAeration} from '../src/ocean/crest-aeration.ts';
test('spilling crest aeration requires compression, a crest and depth-limited height',()=>{
 assert.ok(crestAeration(1.5,1.2,.6,-1.5,.3)>.8);
 assert.equal(crestAeration(1.5,1.2,.6,-1.5,0),0,'unbroken swell is transparent');
 assert.equal(crestAeration(1.5,1.5,1.5,-1.5,.3),0,'flat flood does not whiten');
 assert.equal(crestAeration(1.5,1.2,.6,-10,.3),0,'deep water is not a shore breaker');
 assert.equal(crestAeration(.6,1.5,0,-1.5,.3),0,'lower straight face stays transparent');
 assert.equal(crestAeration(NaN,1,0,-1,.3),0);
});
