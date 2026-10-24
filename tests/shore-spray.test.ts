import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShoreSpray, SprayPool, sprayBirthRate, type SprayBirth } from '../src/ocean/shore-spray.ts';

const birth:SprayBirth={x:3,y:2,z:4,vx:2,vy:3,vz:0,windX:-1,windZ:0,drag:2,life:1,size:.04,opacity:.2};
test('ballistic birth stays fixed and follows gravity plus wind drag independently of timestep',()=>{
  const a=new SprayPool(1),b=new SprayPool(1),input={...birth};
  a.emit(input);b.emit(input);input.x=999;input.vy=99;
  a.advance(.4);for(let i=0;i<4;i++)b.advance(.1);
  assert.deepEqual(a.positions,b.positions);
  assert.ok(Math.abs(a.positions[1]-(2+3*.4-4.905*.16))<1e-6);
  assert.ok(Math.abs(a.positions[0]-(3-.4+3*(1-Math.exp(-.8))/2))<1e-6);
});
test('strict pool budget, expiry and reuse do not overwrite active births',()=>{
  const pool=new SprayPool(2);assert.ok(pool.emit(birth));assert.ok(pool.emit(birth));
  const before=pool.positions.slice();assert.equal(pool.emit({...birth,x:99}),false);assert.deepEqual(pool.positions,before);
  pool.advance(1);assert.equal(pool.active,0);assert.ok(pool.alpha.every(v=>v===0));
  assert.ok(pool.emit({...birth,x:7}));assert.equal(pool.active,1);
  assert.throws(()=>new SprayPool(1501));
});
test('zero, negative and nonfinite dt preserve pool exactly; invalid births are rejected',()=>{
  const pool=new SprayPool(2);pool.emit(birth);pool.advance(.1);
  const before=[pool.positions.slice(),pool.alpha.slice()];
  for(const dt of [0,-1,NaN,Infinity])pool.advance(dt);
  assert.deepEqual([pool.positions,pool.alpha],before);
  assert.equal(pool.emit({...birth,life:0}),false);assert.equal(pool.emit({...birth,x:NaN}),false);
});
test('land, deep water, sheltered bays, low energy and distant cells have no birth rate',()=>{
  assert.ok(sprayBirthRate(1,.8,.9,20)>0);
  for(const values of [[0,.8,1,1],[5,.8,1,1],[1,0,1,1],[1,.8,.1,1],[1,.8,1,100],[NaN,.8,1,1]]){
    assert.equal(sprayBirthRate(...values as [number,number,number,number]),0);
  }
});
test('paused updates do not sample; underwater hides the group even while paused',()=>{
  let calls=0;
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){calls++;},getDrawingBufferSize(v:THREE.Vector2){return v.set(1000,600);}} as unknown as THREE.WebGLRenderer;
  const spray=new ShoreSpray(renderer,{heightAt:()=>-1}),camera=new THREE.PerspectiveCamera();
  const u={uUnderwater:{value:0},uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()}};
  spray.update(1,0,camera,u);assert.equal(calls,0);assert.equal(spray.diagnostics.emitted,0);
  u.uUnderwater.value=1;spray.update(1,0,camera,u);assert.equal(spray.group.visible,false);
  spray.update(2,.05,camera,u);assert.equal(calls,0);spray.dispose();spray.dispose();
});
test('dispose defers render target destruction until async readback settles',async()=>{
  let resolve!:(pixels:Uint8Array)=>void,target:THREE.WebGLRenderTarget|null=null,disposals=0;
  const renderer={getRenderTarget(){return null;},setRenderTarget(t:THREE.WebGLRenderTarget|null){if(t){target=t;t.addEventListener('dispose',()=>disposals++);}},render(){},
    readRenderTargetPixelsAsync(){return new Promise<Uint8Array>(r=>{resolve=r;});},getDrawingBufferSize(v:THREE.Vector2){return v.set(1000,600);}} as unknown as THREE.WebGLRenderer;
  const spray=new ShoreSpray(renderer,{heightAt:()=>-1}),camera=new THREE.PerspectiveCamera();
  const u={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()}};
  spray.update(1,.05,camera,u);assert.ok(target);assert.equal(spray.diagnostics.pending,true);
  spray.dispose();assert.equal(disposals,0);resolve(new Uint8Array(2304));
  await new Promise(r=>setImmediate(r));assert.equal(disposals,1);assert.equal(spray.diagnostics.ready,false);
});

test('SWE-aligned cache preserves a narrow nodal crest when the camera moves',async()=>{
  // Independent triangular surface: 3m-high peaks at alternate SWE nodes.
  // Resampling it on the previous 2m grid loses crest height before launch.
  const height=(x:number)=>{const phase=((x-.75)%3+3)%3;return 3-2*Math.min(phase,3-phase);};
  let material:THREE.ShaderMaterial;
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},
    render(scene:THREE.Scene){material=(scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;},
    async readRenderTargetPixelsAsync(_target:unknown,_x:number,_y:number,width:number,rows:number,pixels:Uint8Array){
      const u=material.uniforms,centre=u.uCenter.value as THREE.Vector2,step=u.uSampleStep.value;
      for(let z=0;z<rows;z++)for(let x=0;x<width;x++){
        const h=height(centre.x+(x+.5-width/2)*step),code=Math.round((h/16+.5)*65535),i=(z*width+x)*4;
        pixels[i]=Math.floor(code/256);pixels[i+1]=code%256;pixels[i+3]=Math.round((h+2)/8*255);
      }return pixels;
    },getDrawingBufferSize(v:THREE.Vector2){return v.set(1000,600);}} as unknown as THREE.WebGLRenderer;
  const camera=new THREE.PerspectiveCamera(),u={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()}};
  const aligned=new ShoreSpray(renderer,{heightAt:()=>-2},{resolution:96,span:144});
  let time=0;
  for(const x of [-7.9,-.01,.01,1.49,1.51,8.2]){
    camera.position.set(x,2,-4.2);aligned.update(++time,.016,camera,u);await aligned.settleReadback();
    assert.ok(Math.abs(aligned.diagnostics.maxSampleCrest-3)<.00025,'camera motion must not attenuate a shared crest');
  }
  assert.equal(aligned.diagnostics.readbackBytes,96*96*4);assert.equal(aligned.diagnostics.interval,.2);aligned.dispose();
  const resampled=new ShoreSpray(renderer,{heightAt:()=>-2},{resolution:64,span:128});
  resampled.update(++time,.016,camera,u);await resampled.settleReadback();
  assert.ok(resampled.diagnostics.maxSampleCrest<2.51,'the old grid reproduces the half-metre crest loss');resampled.dispose();
});
