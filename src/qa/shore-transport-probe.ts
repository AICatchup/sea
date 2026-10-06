import * as THREE from 'three';
import {shoreTransportFragment} from '../ocean/shore-solver.ts';

/** Actual GPU transport kernel, periodic constant bed with friction/foam/sponge
 * disabled. This isolates precision and numerical damping, not coastal flow. */
export async function inspectShoreTransport(renderer:THREE.WebGLRenderer){
 if(!renderer.extensions.has('EXT_color_buffer_float'))return {available:false,reason:'Float colour target unavailable'};
 const size=128,span=192,depth=4,amplitude=.025,c=Math.sqrt(9.81*depth);
 const before={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),xr:renderer.xr.enabled,auto:renderer.autoClear};
 const ground=new THREE.DataTexture(new Float32Array([-depth,1,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);ground.needsUpdate=true;
 const scene=new THREE.Scene(),camera=new THREE.Camera(),geometry=new THREE.PlaneGeometry(2,2),results=[];
 const cases=[{order:1,precision:'half',m:8,n:0},{order:1,precision:'float',m:8,n:0},{order:2,precision:'half',m:8,n:0},{order:2,precision:'float',m:8,n:0},{order:2,precision:'half',m:6,n:6},{order:2,precision:'float',m:6,n:6}] as const;
 const gl=renderer.getContext(),initialGlError=gl.getError();
 try{for(const spec of cases){
  const started=performance.now(),length=span/Math.hypot(spec.m,spec.n),direction=[spec.m,spec.n].map(v=>v/Math.hypot(spec.m,spec.n));
  const pixels=new Float32Array(size*size*4);
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){const eta=amplitude*Math.sin(Math.PI*2*(spec.m*(x+.5)+spec.n*(z+.5))/size),i=(z*size+x)*4;pixels[i]=depth+eta;pixels[i+1]=eta*c*direction[0];pixels[i+2]=eta*c*direction[1];}
  const seed=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat,THREE.FloatType);seed.needsUpdate=true;
  const targets=Array.from({length:spec.order===2?3:2},()=>new THREE.WebGLRenderTarget(size,size,{type:spec.precision==='half'?THREE.HalfFloatType:THREE.FloatType,depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  const u:Record<string,THREE.IUniform>={uInput:{value:seed},uOriginal:{value:seed},uSecondOrder:{value:spec.order===2?1:0},uStage:{value:0},uBathymetry:{value:ground},uLongWaves:{value:ground},uShortWaves:{value:ground},uBathyBounds:{value:new THREE.Vector4(-span/2,-span/2,span,span)},uBathyResolution:{value:new THREE.Vector2(1,1)},uBathyTriangulated:{value:0},uBounds:{value:new THREE.Vector4(-span/2,-span/2,span,span)},uOldBounds:{value:new THREE.Vector4()},uSize:{value:size},uDx:{value:span/size},uDt:{value:0},uMode:{value:3},uSwell:{value:1},uChoppiness:{value:0},uMaxDepth:{value:12},uMaxSpeed:{value:12},uMaxHeight:{value:4}};
  const material=new THREE.ShaderMaterial({uniforms:u,defines:{SHORE_PERIODIC_PROBE:1},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:shoreTransportFragment,depthTest:false,depthWrite:false});
  const quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
  let index=0,steps=0,time=0;
  const read=()=>{
   const buffer=spec.precision==='half'?new Uint16Array(size*size*4):new Float32Array(size*size*4);
   renderer.readRenderTargetPixels(targets[index],0,0,size,size,buffer);
   let mass=0,hs=0,hc=0,qs=0,qc=0,nonfinite=0;
   for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const i=(z*size+x)*4,v=(offset:number)=>buffer instanceof Uint16Array?THREE.DataUtils.fromHalfFloat(buffer[i+offset]):buffer[i+offset];
    const h=v(0),q=v(1)*direction[0]+v(2)*direction[1],phase=Math.PI*2*(spec.m*(x+.5)+spec.n*(z+.5))/size;
    if(!Number.isFinite(h)||!Number.isFinite(q)){nonfinite++;continue;}mass+=h;hs+=(h-depth)*Math.sin(phase);hc+=(h-depth)*Math.cos(phase);qs+=q/c*Math.sin(phase);qc+=q/c*Math.cos(phase);
   }
   const scale=2/(size*size),heightAmplitude=scale*Math.hypot(hs,hc),fluxAmplitude=scale*Math.hypot(qs,qc);
   return {mass,heightAmplitude,fluxAmplitude,energyAmplitude:Math.hypot(heightAmplitude,fluxAmplitude)/Math.SQRT2,nonfinite,glError:gl.getError()};
  };
  try{
   renderer.xr.enabled=false;renderer.autoClear=false;renderer.setRenderTarget(targets[index]);renderer.render(scene,camera);const initial=read();
   const dt=(spec.order===2?.10:.20)*(span/size)/(12+Math.sqrt(9.81*16)),duration=4*length/c;
   const draw=(stage:number,original:THREE.Texture)=>{u.uInput.value=targets[index].texture;u.uOriginal.value=original;u.uStage.value=stage;u.uMode.value=0;index=(index+1)%targets.length;renderer.setRenderTarget(targets[index]);renderer.render(scene,camera);};
   while(time<duration){u.uDt.value=Math.min(dt,duration-time);const original=targets[index].texture;draw(0,original);if(spec.order===2)draw(1,original);time+=u.uDt.value;steps++;
    if(steps%96===0){renderer.setRenderTarget(before.target);renderer.setViewport(before.viewport);renderer.xr.enabled=before.xr;renderer.autoClear=before.auto;await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));renderer.xr.enabled=false;renderer.autoClear=false;}
   }
   const final=read();results.push({...spec,wavelength:length,seconds:time,steps,wallMilliseconds:performance.now()-started,initial,final,energyRetention:final.energyAmplitude/initial.energyAmplitude,massChange:final.mass-initial.mass});
  }finally{scene.remove(quad);material.dispose();seed.dispose();targets.forEach(t=>t.dispose());}
 }}finally{geometry.dispose();ground.dispose();renderer.setRenderTarget(before.target);renderer.setViewport(before.viewport);renderer.xr.enabled=before.xr;renderer.autoClear=before.auto;}
 return {available:true,size,span,depth,amplitude,periods:4,initialGlError,cellArea:(span/size)**2,massMetric:'Sum of cell depths; multiply by cellArea for volume. Not kilograms.',scope:'Actual transport shader on periodic flat bed; foam, friction and boundary forcing disabled; renderer wall time includes yields and is not normal-scene GPU timing',results};
}
