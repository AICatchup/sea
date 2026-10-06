import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ShoreSolver} from '../src/ocean/shore-solver.ts';

test('RK2 retains its original state without sampling the active draw attachment',()=>{
 const prior=new THREE.WebGLRenderTarget(2,2),calls:{mode:number;stage:number;target:THREE.WebGLRenderTarget;input:THREE.Texture;original:THREE.Texture}[]=[];
 let target=prior;const renderer={xr:{enabled:true},extensions:{has:()=>true},getRenderTarget:()=>target,
  setRenderTarget:(next:THREE.WebGLRenderTarget)=>{target=next;},render:(scene:THREE.Scene)=>{
   const u=((scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
   calls.push({mode:u.uMode.value,stage:u.uStage.value,target,input:u.uInput.value,original:u.uOriginal.value});
  }};
 const solver=new ShoreSolver(renderer as unknown as THREE.WebGLRenderer,{order:2}),texture=new THREE.Texture();
 solver.bindUniforms({uBathymetry:{value:texture},uLongWaves:{value:texture},uShortWaves:{value:texture}});
 solver.update(solver.stableDelta*1.5,0,0);assert.equal(solver.diagnostics.order,2);assert.equal(solver.substeps,2);
 assert.deepEqual(calls.map(c=>[c.mode,c.stage]),[[2,0],[0,0],[0,1],[0,0],[0,1]]);
  for(const c of calls){assert.notEqual(c.target.texture,c.input);assert.notEqual(c.target.texture,c.original);assert.equal(c.target.texture.type,THREE.FloatType,'depth evolution must not be quantized to half precision');}
 for(const i of [1,3])assert.equal(calls[i].input,calls[i+1].original,'corrector must retain the state before the predictor');
 assert.equal(target,prior);assert.equal(renderer.xr.enabled,true);
 const attachments=new Set(calls.map(c=>c.target));assert.equal(attachments.size,3);
 let disposed=0;for(const t of attachments)t.addEventListener('dispose',()=>disposed++);
 solver.dispose();solver.dispose();assert.equal(disposed,3);texture.dispose();prior.dispose();
});

test('higher-order candidate keeps float-target fallback and resets its domain on exit',()=>{
 const renderer={xr:{enabled:true},extensions:{has:()=>false},getRenderTarget:()=>null,setRenderTarget:()=>{},render:()=>{throw Error('unsupported GPU must not render');}};
 const solver=new ShoreSolver(renderer as unknown as THREE.WebGLRenderer,{order:2});
 solver.update(.016,0,0);assert.equal(solver.uniforms.uShoreReady.value,0);assert.equal(solver.simulationElapsed,0);
 solver.reset();assert.equal(solver.uniforms.uShoreReady.value,0);solver.dispose();
});
