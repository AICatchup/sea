import test from 'node:test';
import assert from 'node:assert/strict';
import {leafColourMips} from '../src/world/foliage-texture.ts';
test('invisible black padding cannot darken the sampled leaf colour',()=>{
  const rgb=new Uint8Array([80,160,40,255,0,0,0,255,0,0,0,255,0,0,0,255]),alpha=new Uint8Array([255,255,255,255,0,0,0,255,0,0,0,255,0,0,0,255]);
  const old=rgb.slice(),mask=alpha.slice(),mips=leafColourMips(rgb,alpha,2,2);
  assert.deepEqual([...mips[1].data],[80,160,40,255]);assert.deepEqual([...mips[0].data.slice(0,4)],[80,160,40,255]);
  assert.deepEqual(rgb,old);assert.deepEqual(alpha,mask);
});
test('mixed opaque photo colours average in linear light, with complete mip dimensions',()=>{
  const rgb=new Uint8Array([255,0,0,255,0,0,255,255]),alpha=new Uint8Array(8).fill(255),mips=leafColourMips(rgb,alpha,2,1);
  assert.deepEqual(mips.map(m=>[m.width,m.height]),[[2,1],[1,1]]);assert.ok(Math.abs(mips[1].data[0]-188)<=1);assert.ok(Math.abs(mips[1].data[2]-188)<=1);
  assert.throws(()=>leafColourMips(rgb,alpha,NaN,1));
});
test('a transparent branch atlas keeps linear opacity as well as undarkened colour in every mip',()=>{
 const rgb=new Uint8Array([80,160,40,255,0,0,0,0,0,0,0,0,0,0,0,0]),alpha=new Uint8Array([0,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
 const mips=leafColourMips(rgb,alpha,2,2,true);
 assert.deepEqual([...mips[1].data],[80,160,40,64]);assert.equal(mips[0].data[7],0);
 assert.deepEqual([...leafColourMips(new Uint8Array(16),new Uint8Array(16),2,2,true)[1].data],[0,0,0,0]);
});
