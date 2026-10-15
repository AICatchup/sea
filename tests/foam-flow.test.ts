import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructFoamFlow} from '../src/ocean/foam-flow.ts';
test('advected material does not jump at a nearest-filtered solver texel boundary',()=>{
 const a=[1,0,0] as const,b=[1,4,2] as const;
 const left=reconstructFoamFlow(a,b,a,b,.4999,.3),right=reconstructFoamFlow(a,b,a,b,.5001,.3);
 assert.ok(Math.abs(left[0]-right[0])<.001);assert.ok(Math.abs(left[1]-right[1])<.001);
 // Nearest sampling previously jumped four m/s, tearing the four-second UV cycle by sixteen metres.
 assert.equal(b[1]-a[1],4);
});
test('depth and momentum are reconstructed before division; dry flow remains zero',()=>{
 assert.deepEqual(reconstructFoamFlow([1,2,0],[3,6,0],[1,2,0],[3,6,0],.5,.5),[2,0]);
 assert.deepEqual(reconstructFoamFlow([0,0,0],[0,0,0],[0,0,0],[0,0,0],.5,.5),[0,0]);
});
