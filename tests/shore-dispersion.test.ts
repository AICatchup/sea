import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {dispersionCoefficient,dispersivePhaseSpeed,solveDispersivePressure} from '../src/ocean/shore-dispersion.ts';
import {ShoreSolver} from '../src/ocean/shore-solver.ts';

test('unbroken waves have wavelength-dependent speed close to finite-depth Airy theory',()=>{
 for(const depth of [.5,2,4,8,12])for(const kd of [.05,.25,.5,1,1.5,2]){
  const k=kd/depth,exact=Math.sqrt(9.81*Math.tanh(kd)/k),actual=dispersivePhaseSpeed(depth,k);
  assert.ok(Math.abs(actual/exact-1)<.006,`${depth}m kd=${kd}: ${actual/exact}`);
 }
 assert.ok(dispersivePhaseSpeed(4,.5)<dispersivePhaseSpeed(4,.1)*.8);
});

test('pressure solve retains mean water level and resolves axial and diagonal Fourier waves',()=>{
 const n=64,dx=1.5,depth=4,coefficient=new Float64Array(n*n).fill(.4*depth*depth);
 for(const [mx,mz] of [[4,0],[3,3]]){
  const eta=Float64Array.from({length:n*n},(_,i)=>.2+.1*Math.sin(2*Math.PI*(mx*(i%n)+mz*Math.floor(i/n))/n));
  const p=solveDispersivePressure(eta,coefficient,n,dx,160);
  const eigenvalue=4*(Math.sin(Math.PI*mx/n)**2+Math.sin(Math.PI*mz/n)**2)/(dx*dx);
  let error=0,mean=0;
  p.forEach((v,i)=>{error=Math.max(error,Math.abs(v-(.2+(eta[i]-.2)/(1+coefficient[i]*eigenvalue))));mean+=v;});
  assert.ok(error<1e-8);assert.ok(Math.abs(mean/p.length-.2)<1e-12);
 }
});

test('pressure correction vanishes at dry contacts and steep exposed terrain',()=>{
 assert.equal(dispersionCoefficient(4,0,0),0);
 assert.equal(dispersionCoefficient(4,4,2),0);
 assert.equal(dispersionCoefficient(-2,4,0),0);
 const eta=new Float64Array(64).fill(.7),coefficient=Float64Array.from({length:64},(_,i)=>dispersionCoefficient(i/8,2,0));
 const p=solveDispersivePressure(eta,coefficient,8,1,160);
 for(const value of p)assert.ok(Math.abs(value-.7)<1e-12,'variable bed must preserve a lake at rest');
});

test('pressure stages never read the active attachment and dispose both extra targets',()=>{
 const prior=new THREE.WebGLRenderTarget(2,2),attachments=new Set<THREE.WebGLRenderTarget>();let target=prior,pressurePasses=0,hydro=0;
 const renderer={xr:{enabled:true},extensions:{has:()=>true},getRenderTarget:()=>target,setRenderTarget:(t:THREE.WebGLRenderTarget)=>{target=t;},render:(scene:THREE.Scene)=>{
  const m=(scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial,u=m.uniforms;attachments.add(target);
  for(const name of ['uInput','uOriginal',...(u.uPressureMode?['uPressure']:['uDispersivePressure'])])assert.notEqual(u[name]?.value,target.texture,name);
  if(u.uPressureMode)pressurePasses++;else hydro++;
 }};
 const solver=new ShoreSolver(renderer as unknown as THREE.WebGLRenderer,{order:2}),tex=new THREE.Texture();
 solver.bindUniforms({uBathymetry:{value:tex},uLongWaves:{value:tex},uShortWaves:{value:tex}});
 solver.update(solver.stableDelta,0,0);assert.equal(attachments.size,5);assert.equal(hydro,3);assert.equal(pressurePasses,104);
 assert.equal(target,prior);assert.equal(renderer.xr.enabled,true);
 solver.update(solver.stableDelta,0,0);assert.equal(pressurePasses,118,'warm starts have bounded work per stage');
 let disposed=0;for(const t of attachments)t.addEventListener('dispose',()=>disposed++);
 solver.dispose();solver.dispose();assert.equal(disposed,5);tex.dispose();prior.dispose();
});
