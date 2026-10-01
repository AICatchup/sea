import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LocalWaterHeights,cameraSubmersion} from '../src/ocean/local-water-heights.ts';

test('camera medium follows local crests and troughs rather than mean sea level',()=>{
  assert.equal(cameraSubmersion(.7,1),1,'eyes below a crest are underwater even above y=0');
  assert.equal(cameraSubmersion(-.7,-1),0,'eyes above a trough are in air even below y=0');
  for(const surface of [-1,0,1]){
    assert.ok(Math.abs(cameraSubmersion(surface-.09,surface)-.5)<1e-12);
    assert.equal(cameraSubmersion(surface+.2,surface),0);
  }
});

function fixture(failure?:'render'|'read'){
  const previous=new THREE.WebGLRenderTarget(2,2);let current=previous,disposals=0;
  let sampledMaterial:THREE.ShaderMaterial|undefined;
  let resolve!:(value:Uint8Array)=>void;
  const renderer={
    getRenderTarget:()=>current,
    setRenderTarget:(target:THREE.WebGLRenderTarget)=>{current=target;if(target!==previous)target.addEventListener('dispose',()=>disposals++);},
    render:(scene:THREE.Scene)=>{sampledMaterial=(scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;if(failure==='render')throw new Error('sample render failed');},
    readRenderTargetPixelsAsync:()=>{if(failure==='read')throw new Error('readback creation failed');return new Promise<Uint8Array>(r=>{resolve=r;});}
  } as unknown as THREE.WebGLRenderer;
  const cache=new LocalWaterHeights(renderer);
  const update=(clock=1)=>cache.update(clock,[new THREE.Texture(),new THREE.Texture()],{texture:new THREE.DataTexture(new Uint8Array(4),1,1),origin:new THREE.Vector2(),size:new THREE.Vector2(1,1)},new THREE.Vector3(),new THREE.Vector3(20,0,0),1,1.55,8.5);
  return {cache,update,previous,material:()=>sampledMaterial!,current:()=>current,disposals:()=>disposals,resolve:(p:Uint8Array)=>resolve(p)};
}
test('current solver uniforms retain identity and solved triangular surface sampling through extraction',async()=>{
  const f=fixture(),state={value:new THREE.Texture()},ready={value:1};
  f.cache.bindShore({uShoreState:state,uShoreReady:ready});f.update();
  assert.equal(f.material().uniforms.uShoreState,state);
  assert.equal(f.material().uniforms.uShoreReady,ready);
  assert.match(f.material().fragmentShader,/shoreSolvedSurface\(world,displacement\(parameter\).y,0\.\)/);
  assert.match(f.material().fragmentShader,/sampleCoastalGround\(uBathymetry,uv,uBathyResolution\)/);
  f.cache.dispose();f.resolve(new Uint8Array(1024));await new Promise(r=>setImmediate(r));f.previous.dispose();state.value.dispose();
});

function encodedHeight(height:number):Uint8Array{
  const pixels=new Uint8Array(1024),code=Math.round((height/16+.5)*65535);
  for(let i=0;i<pixels.length;i+=4)pixels.set([code>>8,code&255,137,255],i);
  return pixels;
}

test('remote floating points use bounded exact requests and expire with the local cache',async()=>{
  const f=fixture();
  try{
    f.update(1);f.resolve(encodedHeight(1));await new Promise(r=>setImmediate(r));
    assert.equal(f.cache.sample(200,17),0,'unsampled remote points have no invented height');
    f.update(1.25);
    const points=(f.material().uniforms.uRequestedPoints.value as THREE.DataTexture).image.data as Float32Array;
    assert.deepEqual(Array.from(points.slice(0,2)),[200,17]);
    const pixels=encodedHeight(1),code=Math.round((2/16+.5)*65535);pixels[512]=code>>8;pixels[513]=code&255;
    f.resolve(pixels);await new Promise(r=>setImmediate(r));
    assert.ok(Math.abs(f.cache.sample(200,17)-2)<.00013);assert.ok(Math.abs(f.cache.sample(0,0)-1)<.00013);
    for(let i=0;i<200;i++)f.cache.sample(1000+i,17);
    f.update(1.5);f.resolve(encodedHeight(.5));await new Promise(r=>setImmediate(r));
    assert.equal(f.cache.diagnostics.requestedPoints,128);assert.equal(f.cache.diagnostics.readbackBytes,1024);
    f.update(2.1);assert.equal(f.cache.sample(200,17),0,'stale remote heights cannot freeze buoys');
    f.resolve(encodedHeight(3));await new Promise(r=>setImmediate(r));assert.equal(f.cache.sample(200,17),0);
  }finally{f.cache.dispose();f.previous.dispose();}
});
test('invalid coordinates cannot leak NaN into swimming or camera medium selection',async()=>{
  const f=fixture();f.update();f.resolve(encodedHeight(1));await new Promise(r=>setImmediate(r));
  for(const [x,z] of [[NaN,0],[0,NaN],[Infinity,0],[0,-Infinity]])assert.equal(f.cache.sample(x,z),0);
  f.cache.dispose();f.previous.dispose();
});
test('stalled readback expires old elevations and late completion cannot revive stale waves',async()=>{
  const f=fixture();f.update(1);f.resolve(encodedHeight(1));await new Promise(r=>setImmediate(r));
  f.update(1.25);assert.ok(f.cache.sample(0,0)>.99);
  f.update(1.8);assert.equal(f.cache.sample(0,0),0);assert.equal(f.cache.diagnostics.ready,false);
  f.resolve(encodedHeight(2));await new Promise(r=>setImmediate(r));
  assert.equal(f.cache.sample(0,0),0);assert.equal(f.cache.diagnostics.failed,false);
  f.update(1.85);f.resolve(encodedHeight(.5));await new Promise(r=>setImmediate(r));
  assert.ok(Math.abs(f.cache.sample(0,0)-.5)<.00013);
  f.cache.dispose();f.previous.dispose();
});
for(const failure of ['render','read'] as const)test(`FFT cache ${failure} failure is contained and restores the active scene target`,()=>{
  const f=fixture(failure);
  try{
    assert.doesNotThrow(f.update);
    assert.equal(f.current(),f.previous);
    assert.equal(f.cache.diagnostics.failed,true);
    assert.equal(f.cache.sample(0,0),0);
  }finally{f.cache.dispose();f.previous.dispose();}
});
test('FFT cache disposal waits for outstanding GPU readback and is idempotent',async()=>{
  const f=fixture();f.update();
  f.cache.dispose();f.cache.dispose();assert.equal(f.disposals(),0);
  f.resolve(new Uint8Array(1024));await new Promise(r=>setImmediate(r));
  assert.equal(f.disposals(),1);assert.equal(f.cache.diagnostics.ready,false);
  f.previous.dispose();
});
test('valid decoded wave samples remain available inside their own patch only',async()=>{
  const f=fixture();f.update();const pixels=new Uint8Array(1024);
  // 1m water elevation, rounded to the production 16-bit encoding.
  const code=Math.round((1/16+.5)*65535);
  for(let i=0;i<pixels.length;i+=4)pixels.set([code>>8,code&255,137,255],i);
  f.resolve(pixels);await new Promise(r=>setImmediate(r));
  assert.ok(Math.abs(f.cache.sample(0,0)-1)<.00013);
  assert.ok(Math.abs(f.cache.sample(20,0)-1)<.00013);
  assert.equal(f.cache.sample(200,0),0);
  f.cache.dispose();f.previous.dispose();
});

