import test from 'node:test';
import assert from 'node:assert/strict';
import {trackBreakerRoot} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';

test('live crest projection follows a displaced peak without jumping to another wave',()=>{
 const sample:WhitewaterSampler=(x,_z,s)=>{s.height=1-(x-.75)**2;s.depth=2+s.height;s.ground=-2;return true;};
 const p=trackBreakerRoot(0,0,1,0,sample)!;
 assert.equal(p.x,.75);assert.equal(p.z,0);assert.equal(p.height,1);
 const remote:WhitewaterSampler=(x,_z,s)=>{s.height=x*.2;s.depth=3;s.ground=-2;return true;};
 assert.ok(Math.abs(trackBreakerRoot(0,0,1,0,remote)!.x)<=1);
});
test('crest projection rejects invalid and emergent support',()=>{
 assert.equal(trackBreakerRoot(0,0,1,0,()=>false),null);
 for(const ground of [.2,1])assert.equal(trackBreakerRoot(0,0,1,0,(_x,_z,s)=>{s.height=2;s.depth=1;s.ground=ground;return true;}),null);
});
