import test from 'node:test';
import assert from 'node:assert/strict';
import {BreakingLipPool} from '../src/ocean/shore-breaking-lips.ts';
import type {WhitewaterSample} from '../src/ocean/shore-whitewater.ts';
const born={x:0,z:0,height:.4,energy:.6,nx:1,nz:0,seed:.3};
const sample=(_x:number,_z:number,s:WhitewaterSample)=>{Object.assign(s,{height:0,depth:2,ground:-2});return true;};
test('lip projects forward, falls under gravity and emits one impact at its landing site',()=>{
 const p=new BreakingLipPool(1);let impacts:typeof born[]=[];p.emit(born);
 p.advance(.12,sample,b=>impacts.push(b));const initial=p.tips[1];
 p.advance(.2,sample,b=>impacts.push(b));assert.ok(p.tips[0]>.2);assert.ok(p.tips[1]<initial);
 for(let i=0;i<20;i++)p.advance(.05,sample,b=>impacts.push(b));
 assert.equal(impacts.length,1);assert.ok(impacts[0].x>0);assert.equal(impacts[0].height,0);assert.equal(p.active,0);
});
test('dry, stale and invalid births cannot leave hovering sheets or generate impact foam',()=>{
 const p=new BreakingLipPool(2);assert.equal(p.emit({...born,energy:0}),false);assert.equal(p.emit({...born,nx:0}),false);
 p.emit(born);let count=0;p.advance(.1,()=>false,()=>count++);assert.equal(p.active,0);assert.equal(count,0);assert.equal(p.roots[3],0);
});
test('pool is bounded and reuses slots without repeated impact events',()=>{
 const p=new BreakingLipPool(1);assert.ok(p.emit(born));assert.equal(p.emit(born),false);p.clear();assert.ok(p.emit(born));
 let count=0;for(let i=0;i<60;i++)p.advance(1/60,sample,()=>count++);assert.equal(count,1);
 p.advance(1,sample,()=>count++);assert.equal(count,1);
});

test('paused and negative time preserve a lip, finite frame partitions agree before contact',()=>{
 const a=new BreakingLipPool(1),b=new BreakingLipPool(1);a.emit(born);b.emit(born);
 a.advance(.24,sample,()=>assert.fail('too early'));for(let i=0;i<24;i++)b.advance(.01,sample,()=>assert.fail('too early'));
 for(let i=0;i<4;i++)assert.ok(Math.abs(a.tips[i]-b.tips[i])<1e-5);
 const before=a.tips.slice();for(const dt of [0,-1,NaN])a.advance(dt,sample,()=>assert.fail('paused impact'));
 assert.deepEqual(a.tips,before);
});

import * as THREE from 'three';
import { ShoreSpray } from '../src/ocean/shore-spray.ts';
import { ShoreWhitewater } from '../src/ocean/shore-whitewater.ts';
test('live source produces lips first, then landing foam with no extra GPU readback',async()=>{
 let reads=0;const pixels=new Uint8Array(4608);
 for(let i=0;i<2304;i+=4)pixels.set([132,204,220,32],i);
 for(let i=2304;i<4608;i+=4)pixels.set([128,128,255,137],i);
 const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},readRenderTargetPixelsAsync(){reads++;return Promise.resolve(pixels);},getDrawingBufferSize(v:THREE.Vector2){return v.set(800,600);}} as unknown as THREE.WebGLRenderer;
 const spray=new ShoreSpray(renderer,{heightAt:(x:number)=>-1+x*.001},{whitewater:true,lips:true});
 const camera=new THREE.PerspectiveCamera(),u={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()}};
 spray.update(1,.05,camera,u);await new Promise(r=>setImmediate(r));spray.update(1.05,.05,camera,u);
 assert.ok(spray.lips!.pool.active>0);assert.equal(spray.whitewater!.pool.active,0);
 for(let i=2;i<32;i++){spray.update(1+i*.05,.05,camera,u);await new Promise(r=>setImmediate(r));}
 assert.ok(spray.lips!.pool.impacts>0);assert.equal(spray.diagnostics.whitewaterEmitted,spray.lips!.pool.impacts);
 assert.ok(spray.whitewater!.pool.active>0);assert.equal(spray.diagnostics.readbackBytes,4608);assert.ok(reads<12);
 const material=spray.lips!.material;spray.update(3,0,camera,{...u,uUnderwater:{value:1}});
 assert.equal(material.uniforms.uLongWaves,u.uLongWaves);assert.equal(spray.group.visible,false);
 spray.dispose();assert.equal(spray.lips!.pool.active,0);
});
test('foam has interior surface samples rather than a card bridging curved water',()=>{
 const foam=new ShoreWhitewater(),p=foam.geometry.getAttribute('position');
 let interior=0;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.49&&Math.abs(p.getZ(i))<.49)interior++;
 assert.ok(interior>0);assert.ok(foam.geometry.index!.count/3*foam.pool.capacity<50000);foam.dispose();
});
