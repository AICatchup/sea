import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ShoreBreaker} from '../src/ocean/shore-breaker.ts';

function harness(fail=false){
  const original=new THREE.WebGLRenderTarget(4,4),viewport=new THREE.Vector4(2,3,4,5),scissor=new THREE.Vector4(5,6,7,8),clear=new THREE.Color(.1,.2,.3);
  let target:THREE.WebGLRenderTarget|null=original,test=true,alpha=.4,draws=0,ownedDisposals=0;
  const shaders:string[]=[],dimensions:number[][]=[];
  const renderer={extensions:{has:()=>true},autoClear:false,
    getRenderTarget:()=>target,getViewport:(v:THREE.Vector4)=>v.copy(viewport),getScissor:(v:THREE.Vector4)=>v.copy(scissor),getScissorTest:()=>test,getClearColor:(v:THREE.Color)=>v.copy(clear),getClearAlpha:()=>alpha,
    setRenderTarget:(v:THREE.WebGLRenderTarget|null)=>{target=v;},setViewport:(...v:any[])=>{if(v[0] instanceof THREE.Vector4)viewport.copy(v[0]);else viewport.set(...v as [number,number,number,number]);},setScissor:(v:THREE.Vector4)=>scissor.copy(v),setScissorTest:(v:boolean)=>{test=v;},setClearColor:(v:THREE.Color|number,a:number)=>{clear.set(v);alpha=a;},
    render:(scene:THREE.Scene)=>{draws++;const mesh=scene.children[0] as THREE.Mesh;const material=mesh.material as THREE.ShaderMaterial;shaders.push(material.fragmentShader);material.addEventListener('dispose',()=>ownedDisposals++);if(fail&&draws===2)throw Error('readback failure');},
    readRenderTargetPixels:(_target:THREE.WebGLRenderTarget,_x:number,_y:number,w:number,h:number,pixels:Float32Array)=>{dimensions.push([w,h]);for(let i=0;i<pixels.length;i++)pixels[i]=i;if(w===520)for(let row=0;row<3;row++)for(let index=0;index<65;index++){const start=(row*w+index)*4;pixels[start+2]=(index-32)*1.5;pixels[start+3]=(row-1)*8;}},
  } as unknown as THREE.WebGLRenderer;
  return {renderer,shaders,dimensions,check:(expectedDisposals=2)=>{assert.equal(target,original);assert.deepEqual(viewport.toArray(),[2,3,4,5]);assert.deepEqual(scissor.toArray(),[5,6,7,8]);assert.equal(test,true);assert.equal(renderer.autoClear,false);assert.deepEqual(clear.toArray(),[.1,.2,.3]);assert.equal(alpha,.4);assert.equal(ownedDisposals,expectedDisposals);original.dispose();}};
}

test('expanded probe preserves legacy output and named metric profile lane decoding',()=>{
  const breaker=new ShoreBreaker(),h=harness();
  const vertex=breaker.material.vertexShader,fragment=breaker.material.fragmentShader,borrowed={value:new THREE.Texture()};let borrowedDisposed=false;
  borrowed.value.addEventListener('dispose',()=>{borrowedDisposed=true;});breaker.bindUniforms({uShoreState:borrowed});
  const result=breaker.probeDriver(h.renderer,true);
  assert.equal(result.available,true);assert.equal(result.rows?.length,3);assert.equal(result.rows?.[0].values.length,30);
  assert.deepEqual(h.dimensions,[[30,3],[520,3]]);
  assert.equal(result.profile?.channels.length,32);assert.equal(result.profile?.rows[0].samples.length,65);
  assert.equal(result.profile?.rows[0].samples[1][4],264,'RGBA lanes decode from horizontal lane-major GPU layout');
  assert.match(h.shaders[1],/float compression=max\(0\.,-\(r.y\/max\(r.r,\.01\)/);
  assert.match(h.shaders[1],/diagnosticSurfaceHeight=surface.x;diagnosticConfidence=weighted.z;diagnosticBlend=blend/);
  assert.match(h.shaders[1],/bool stencilValid=domainValid/);
  assert.equal(breaker.material.vertexShader,vertex);assert.equal(breaker.material.fragmentShader,fragment);assert.equal(breaker.material.uniforms.uShoreState,borrowed);assert.equal(borrowedDisposed,false);
  h.check();breaker.dispose();borrowed.value.dispose();
});

test('expanded draw failure restores all renderer state and disposes owned materials',()=>{
  const breaker=new ShoreBreaker(),h=harness(true);assert.throws(()=>breaker.probeDriver(h.renderer,true),/readback failure/);h.check();breaker.dispose();
});


test('default probe performs only its original 30 by 3 readback',()=>{
  const breaker=new ShoreBreaker(),h=harness(),result=breaker.probeDriver(h.renderer);
  assert.deepEqual(h.dimensions,[[30,3]]);assert.equal(result.profile,undefined);h.check(1);breaker.dispose();
});

test('float capability absence skips all GPU work',()=>{
  const breaker=new ShoreBreaker();assert.deepEqual(breaker.probeDriver({extensions:{has:()=>false}} as unknown as THREE.WebGLRenderer,true),{available:false});breaker.dispose();
});

test('zero readback from failed shader is rejected and renderer state is restored',()=>{
  const breaker=new ShoreBreaker(),h=harness();
  const original=h.renderer.readRenderTargetPixels.bind(h.renderer);
  h.renderer.readRenderTargetPixels=((...args:Parameters<typeof original>)=>{original(...args);if(args[3]===520)(args[5] as Float32Array).fill(0);}) as typeof original;
  assert.throws(()=>breaker.probeDriver(h.renderer,true),/invalid coordinate channels/);
  h.check();breaker.dispose();
});
