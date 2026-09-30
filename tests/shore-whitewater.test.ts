import test from 'node:test';
import assert from 'node:assert/strict';
import { WhitewaterPool, ShoreWhitewater, whitewaterBirthRate, type WhitewaterSample, type WhitewaterBirth } from '../src/ocean/shore-whitewater.ts';
const water:WhitewaterSample={height:.3,compression:.8,depth:1,shelter:1,ground:-1,gradientX:1,gradientZ:0};
const birth:WhitewaterBirth={x:0,z:0,height:.3,energy:.8,nx:1,nz:0,seed:.4};
const sampler=(_x:number,_z:number,out:WhitewaterSample)=>{Object.assign(out,water);return true;};
test('birth gates require current compression, wet shallow water, exposed gradient and finite samples',()=>{
  assert.ok(whitewaterBirthRate(water)>0);
  for(const change of [{compression:0},{compression:.12},{depth:0},{depth:4},{shelter:.1},{ground:.3},{gradientX:0},{height:NaN}])assert.equal(whitewaterBirthRate({...water,...change}),0);
});
test('fixed pool preserves births, rejects invalid values and expires for full elapsed dt',()=>{
  const pool=new WhitewaterPool(2);assert.ok(pool.emit(birth));assert.ok(pool.emit(birth));assert.equal(pool.emit(birth),false);
  pool.advance(.5,sampler);assert.ok(pool.positions[0]>0);assert.ok(pool.shape[1]>.22);assert.ok(pool.alpha[0]>0);
  const before=pool.positions.slice();for(const dt of [0,-1,NaN,Infinity])pool.advance(dt,sampler);assert.deepEqual(pool.positions,before);
  pool.advance(20,sampler);assert.equal(pool.active,0);assert.ok(pool.alpha.every(x=>x===0));assert.ok(pool.emit(birth));
  assert.equal(pool.emit({...birth,energy:NaN}),false);assert.equal(pool.emit({...birth,nx:0}),false);assert.throws(()=>new WhitewaterPool(1025));
});
test('analytic advection and spreading are independent of timestep and input mutation',()=>{
  const a=new WhitewaterPool(1),b=new WhitewaterPool(1),input={...birth};a.emit(input);b.emit(input);input.x=99;
  a.advance(.5,sampler);for(let i=0;i<5;i++)b.advance(.1,sampler);
  assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.shape,b.shape);assert.deepEqual(a.alpha,b.alpha);
});
test('fragments follow cached surface, thin at wet strand, and cull land/deep/missing/invalid samples',()=>{
  const pool=new WhitewaterPool(1);pool.emit(birth);
  pool.advance(.5,(_x,_z,out)=>{Object.assign(out,{...water,height:.9,depth:.1});return true;});
  assert.ok(Math.abs(pool.positions[1]-.925)<1e-6);assert.ok(pool.alpha[0]>0);
  for(const change of [{ground:1},{depth:0},{depth:6},{height:NaN}]){
    const p=new WhitewaterPool(1);p.emit(birth);p.advance(.1,(_x,_z,out)=>{Object.assign(out,{...water,...change});return true;});assert.equal(p.active,0);
  }
  const missing=new WhitewaterPool(1);missing.emit(birth);missing.advance(.1,()=>false);assert.equal(missing.active,0);
});
test('underwater visibility and idempotent disposal retain fixed budget and forbid rebirth',()=>{
  const foam=new ShoreWhitewater();assert.equal(foam.pool.capacity,1024);foam.pool.emit(birth);foam.update(.1,sampler,true);assert.equal(foam.group.visible,false);
  foam.update(.1,sampler,false);assert.equal(foam.group.visible,true);let disposed=0;foam.material.addEventListener('dispose',()=>disposed++);
  foam.dispose();foam.dispose();assert.equal(disposed,1);assert.equal(foam.pool.active,0);assert.equal(foam.pool.emit(birth),false);assert.equal(foam.group.children.length,0);
});

// Integration keeps the existing single 576-cell readback and explicit default-off gate.
import * as THREE from 'three';
import { ShoreSpray } from '../src/ocean/shore-spray.ts';
test('optional integration shares one FFT sample request and produces persistent foam',async()=>{
  let reads=0;const pixels=new Uint8Array(2304);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=132;pixels[i+1]=204;pixels[i+2]=220;pixels[i+3]=32;}
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},readRenderTargetPixelsAsync(){reads++;return Promise.resolve(pixels);},getDrawingBufferSize(v:THREE.Vector2){return v.set(800,600);}} as unknown as THREE.WebGLRenderer;
  const ground={heightAt:(x:number)=>-1+x*.001};
  const off=new ShoreSpray(renderer,ground);assert.equal(off.whitewater,null);off.dispose();
  const spray=new ShoreSpray(renderer,ground,{whitewater:true}),camera=new THREE.PerspectiveCamera();
  const u={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()}};
  for(let i=0;i<30;i++){spray.update(1+i*.05,.05,camera,u);await new Promise(r=>setImmediate(r));}
  assert.ok(reads>0&&reads<12);assert.equal(spray.diagnostics.readbackBytes,2304);assert.equal(spray.diagnostics.drawCalls,2);assert.ok(spray.diagnostics.whitewaterActive>0);
  assert.ok(spray.diagnostics.whitewaterEmitted>=spray.diagnostics.whitewaterActive);
  assert.equal(spray.diagnostics.maxSampleEnergy,220/255);
  assert.equal(spray.diagnostics.maxSampleCrest,(132*256+204)/65535*16-8);
  assert.equal(spray.diagnostics.sampleEnergyPositiveCount,576);assert.equal(spray.diagnostics.sampleWetEligibleCount,576);
  assert.equal(spray.diagnostics.maxEstimatedHeightDepthRatio,spray.diagnostics.maxSampleCrest/(32/255*8));
  spray.dispose();assert.equal(spray.whitewater!.pool.active,0);
});
