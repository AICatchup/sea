import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShoreSpray, sprayBirthRate, sprayEmissionCount } from '../src/ocean/shore-spray.ts';
import { whitewaterBirthRate, type WhitewaterSample } from '../src/ocean/shore-whitewater.ts';
import { whitewaterAerationStrength } from '../src/ocean/whitewater-flow.ts';

const wet:WhitewaterSample={height:.4,compression:10/255,depth:1.4,shelter:1,ground:-1,gradientX:.01,gradientZ:0};
test('36 spray events per second retain that expectation at 20 and 60 fps',()=>{
  for(const fps of [20,60]){
    let births=0;const seconds=100;
    for(let i=0;i<fps*seconds;i++)births+=sprayEmissionCount(36,1/fps,((i%100)+.5)/100);
    assert.equal(births/seconds,36);
  }
  assert.equal(sprayEmissionCount(0,.05,.1),0);
  assert.equal(sprayEmissionCount(NaN,.05,.1),0);
  assert.equal(sprayEmissionCount(36,0,.1),0);
});
test('observed .0392 instantaneous source survives rate integration without residual foam',()=>{
  assert.ok(whitewaterBirthRate(wet)>.3);
  assert.ok(whitewaterAerationStrength(wet.compression)>.25);
  assert.ok(whitewaterAerationStrength(wet.compression)<.3);
  assert.equal(whitewaterBirthRate({...wet,compression:0}),0);
  assert.equal(sprayBirthRate(1,0,1,0),0);
  for(const change of [{depth:0},{depth:5},{ground:.4},{shelter:.1},{compression:NaN}])assert.equal(whitewaterBirthRate({...wet,...change}),0);
});
test('short low-source pulses create bounded volumes and spray; zero source cannot rebirth',async()=>{
  const pixels=new Uint8Array(4608);
  // Only twelve cells break; the rest remain calm despite valid solved flow.
  for(let i=0;i<2304;i+=4)pixels.set([132,204,i<48?10:0,44],i);
  for(let i=2304;i<4608;i+=4)pixels.set([123,128,255,137],i);
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},readRenderTargetPixelsAsync(){return Promise.resolve(pixels.slice());},getDrawingBufferSize(v:THREE.Vector2){return v.set(800,600);}} as unknown as THREE.WebGLRenderer;
  const s=new ShoreSpray(renderer,{heightAt:x=>-1+x*.001},{volume:true});
  const camera=new THREE.PerspectiveCamera();camera.position.set(-30,2,-60);
  const uniforms={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()},uWind:{value:8.5}};
  for(let i=0;i<240;i++){
    // Each .2s event supplies < one old emission credit, followed by .8s calm.
    // The former reset-on-calm accumulator would suppress every event.
    for(let j=2;j<48;j+=4)pixels[j]=i%20<4?10:0;
    s.update(1+i*.05,.05,camera,uniforms);await new Promise(r=>setImmediate(r));
  }
  assert.ok(s.diagnostics.whitewaterEmitted>0);
  assert.ok(s.diagnostics.whitewaterActive>0);
  assert.ok(s.diagnostics.emitted>0);
  assert.ok(s.diagnostics.whitewaterActive<=384);
  assert.equal(s.diagnostics.readbackBytes,4608);
  for(let i=2;i<2304;i+=4)pixels[i]=0;
  // Allow the previous asynchronous sample to age out first.
  s.update(14,.05,camera,uniforms);await new Promise(r=>setImmediate(r));
  const before=s.diagnostics.whitewaterEmitted;
  for(let i=0;i<240;i++){s.update(14.05+i*.05,.05,camera,uniforms);await new Promise(r=>setImmediate(r));}
  assert.equal(s.diagnostics.whitewaterEmitted,before);
  assert.equal(s.diagnostics.whitewaterActive,0);
  s.dispose();Object.values(uniforms).forEach(u=>{if(u.value instanceof THREE.Texture)u.value.dispose();});
});
