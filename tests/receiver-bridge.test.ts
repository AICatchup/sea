import test from 'node:test';import assert from 'node:assert/strict';
import {concatenateReceiverData,packedReceiverGLSL} from '../src/ocean/receiver-bridge.ts';
test('combined receiver tables preserve texel addresses and input bytes',()=>{
 const a=new Float32Array([1,2,3,4,5,6,7,8]),b=new Float32Array([9,10,11,12]);const p=concatenateReceiverData([a,b]);assert.deepEqual(p.offsets,[0,2]);assert.deepEqual([...p.data.slice(0,12)],[...a,...b]);assert.equal(p.data.length,4096);assert.equal(a[0],1);
});
test('packed shader retains geometry traversal with two data samplers',()=>{
 assert.ok(packedReceiverGLSL.includes('receiverTriangleOffset+address'));assert.ok(packedReceiverGLSL.includes('receiverInstanceOffset+instance'));assert.ok(!packedReceiverGLSL.includes('uniform sampler2D receiverNodes;'));assert.ok(!packedReceiverGLSL.includes('receiverRead(receiverTriangles,'));
});
