import * as THREE from 'three';
import {SandMoisture} from '../ocean/sand-moisture.ts';
import {wetSandSampling,wetSandUniforms} from '../world/coastal-wet-sand.ts';

/** Isolated GPU fixtures; never mutate the live ocean's wave/terrain resources. */
export function inspectSandMoisture(renderer:THREE.WebGLRenderer){
  const textures:THREE.DataTexture[]=[];
  const texture=(size:number,fill:(x:number,z:number)=>number[])=>{
    const data=new Float32Array(size*size*4);for(let z=0;z<size;z++)for(let x=0;x<size;x++)data.set(fill(x,z),(z*size+x)*4);
    const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;textures.push(t);return t;
  };
  const bed=texture(8,()=>[0,1,0,1]),waves=texture(4,()=>[0,0,0,0]),shore=texture(64,()=>[0,0,0,0]);
  const uniforms=wetSandUniforms();
  uniforms.uBathymetry.value=bed;uniforms.uBathyBounds.value.set(-64,-64,128,128);uniforms.uBathyResolution.value.set(8,8);
  uniforms.uLongWaves.value=uniforms.uShortWaves.value=waves;uniforms.uShoreState.value=shore;uniforms.uShoreReady.value=1;uniforms.uShoreBounds.value.set(-32,-32,64,64);uniforms.uShoreResolution.value=64;
  const history=new SandMoisture(renderer,16,16);history.bindUniforms(uniforms);
  const previous=renderer.getRenderTarget(),xr=renderer.xr.enabled;
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false,stencilBuffer:false});
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`${wetSandSampling}\nvoid main(){gl_FragColor=vec4(sandWaterFilm(vec3(.5,0.,.5)),0.,0.,1.);}`});
  const scene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
  const results:Record<string,unknown>={};
  const read=(x:number,z:number)=>{
    const p=history.probe(),ix=Math.floor((x-p.bounds[0])/p.span*p.resolution),iz=Math.floor((z-p.bounds[1])/p.span*p.resolution);
    if(ix<0||iz<0||ix>=p.resolution||iz>=p.resolution)throw new Error('Probe outside window');
    if(!p.data.every(Number.isFinite))throw new Error('Nonfinite GPU moisture state');
    return Array.from(p.data.slice((iz*p.resolution+ix)*4,(iz*p.resolution+ix)*4+4));
  };
  try{
    renderer.xr.enabled=false;
    for(const mode of [0,1]){uniforms.uSandMemoryEnabled.value=mode;renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());const pixel=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);results[mode?'correctedDryContact':'legacyDryContact']=pixel[0];}
    history.update(0,0,0);results.initialDry=read(-3.5,.5);
    const flow=shore.image.data as Float32Array;for(let z=0;z<64;z++)for(let x=0;x<32;x++)flow[(z*64+x)*4]=.04;shore.needsUpdate=true;
    history.update(.1,0,0);results.wetLeft=read(-3.5,.5);results.dryRight=read(4.5,.5);
    flow.fill(0);shore.needsUpdate=true;history.update(.8,0,0);results.drained=read(-3.5,.5);
    const passes=history.diagnostics.passes;history.update(0,0,0);results.pause={state:read(-3.5,.5),passesUnchanged:history.diagnostics.passes===passes};
    history.update(0,4,0);results.shifted=read(-3.5,.5);results.newDryRegion=read(10.5,.5);
    history.update(129.2,4,0);results.after130Seconds=read(-3.5,.5);
    bed.needsUpdate=true;history.update(0,4,0);results.changedBedContract=read(-3.5,.5);
    history.update(1,1000,1000);results.outsideBathymetry=read(1000.5,1000.5);results.diagnostics=history.diagnostics;
    const pair=(v:unknown)=>v as number[],failures:string[]=[];
    if(Math.abs(Number(results.legacyDryContact)-.9752807617)>1e-5||Number(results.correctedDryContact)!==0)failures.push('dry-contact regression');
    for(const key of ['initialDry','dryRight','newDryRegion','changedBedContract','outsideBathymetry'])if(pair(results[key]).slice(0,2).some(v=>v!==0))failures.push(key);
    if(pair(results.wetLeft)[0]<.999||pair(results.wetLeft)[1]<.999)failures.push('true wet contact');
    if(Math.abs(pair(results.drained)[0]-Math.exp(-.8/130))>1e-5||Math.abs(pair(results.drained)[1]-Math.exp(-1))>1e-5)failures.push('separate decay');
    if(JSON.stringify(results.shifted)!==JSON.stringify(results.drained))failures.push('world reprojection');
    if(Math.abs(pair(results.after130Seconds)[0]-Math.exp(-1))>1e-5)failures.push('long damp decay');
    if(!(results.pause as {passesUnchanged:boolean}).passesUnchanged)failures.push('paused redraw');
    return {pass:failures.length===0,failures,results,scope:'Real GPU: synthetic dry/wet/recede/pause/window shift/new region/bed-version reset. Optical response only.'};
  }finally{history.dispose();textures.forEach(t=>t.dispose());target.dispose();material.dispose();quad.geometry.dispose();renderer.setRenderTarget(previous);renderer.xr.enabled=xr;}
}
