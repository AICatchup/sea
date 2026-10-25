import * as THREE from 'three';
import {shoreTransportFragment} from '../src/ocean/shore-solver';
import {dispersivePressureMain,dispersivePhaseSpeed} from '../src/ocean/shore-dispersion';
const button=document.querySelector<HTMLButtonElement>('#run')!,result=document.querySelector<HTMLPreElement>('#result')!;
const save=document.querySelector<HTMLButtonElement>('#save')!;
save.onclick=async()=>{try{const response=await fetch('http://127.0.0.1:5201/recordings',{method:'POST',headers:{'Content-Type':'application/json'},body:result.textContent});if(!response.ok)throw Error(String(response.status));const receipt=await response.json();save.textContent=`保存済み: ${receipt.file}`;}catch(e){save.textContent=`保存失敗: ${e}`;}};
const renderer=new THREE.WebGLRenderer();renderer.setSize(64,64);document.body.append(renderer.domElement);
button.onclick=async()=>{
 button.disabled=true;save.disabled=true;const results=[];
 try{for(const [mx,mz,dispersion,breaking] of [[2,0,1,1],[4,0,1,1],[3,3,1,1],[4,0,0,1],[4,0,1,2],[4,0,1,3]]){
  result.textContent=`計算中: (${mx}, ${mz}), 分散=${dispersion}`;
  const n=64,span=96,dx=span/n,depth=breaking>1?2:4,amp=breaking>1?.85:.015,k=2*Math.PI*Math.hypot(mx,mz)/span;
  const c=dispersion?dispersivePhaseSpeed(depth,k):Math.sqrt(9.81*depth),duration=breaking>1?3:.6*2*Math.PI/(c*k),dt=.006;
  const pixels=new Float32Array(n*n*4),dir=[mx/Math.hypot(mx,mz),mz/Math.hypot(mx,mz)];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const eta=amp*Math.sin(2*Math.PI*(mx*(x+.5)+mz*(z+.5))/n),i=4*(z*n+x);pixels[i]=depth+eta;pixels[i+1]=c*eta*dir[0];pixels[i+2]=c*eta*dir[1];}
  const seed=new THREE.DataTexture(pixels,n,n,THREE.RGBAFormat,THREE.FloatType);seed.needsUpdate=true;
  const ground=new THREE.DataTexture(new Float32Array([-depth,1,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);ground.needsUpdate=true;
  const make=()=>new THREE.WebGLRenderTarget(n,n,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});
  const targets=[make(),make(),make()],pressures=[make(),make()];let index=0,pi=0,warm=false;
  const uniforms:Record<string,THREE.IUniform>={uInput:{value:seed},uOriginal:{value:seed},uSecondOrder:{value:1},uStage:{value:0},uBathymetry:{value:ground},uLongWaves:{value:ground},uShortWaves:{value:ground},uBounds:{value:new THREE.Vector4(0,0,span,span)},uOldBounds:{value:new THREE.Vector4()},uBathyBounds:{value:new THREE.Vector4(0,0,span,span)},uBathyResolution:{value:new THREE.Vector2(1,1)},uBathyTriangulated:{value:0},uSize:{value:n},uDx:{value:dx},uDt:{value:0},uMode:{value:3},uSwell:{value:1},uChoppiness:{value:0},uMaxDepth:{value:12},uMaxSpeed:{value:12},uMaxHeight:{value:4},uDispersion:{value:dispersion},uDispersivePressure:{value:ground}};
  uniforms.uBreakingDissipation={value:breaking===3?0:1};
  const base={vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',defines:{SHORE_PERIODIC_PROBE:1},depthTest:false,depthWrite:false};
  const transport=new THREE.ShaderMaterial({...base,fragmentShader:shoreTransportFragment,uniforms});
  const pressure=new THREE.ShaderMaterial({...base,fragmentShader:shoreTransportFragment.slice(0,shoreTransportFragment.indexOf('void main()'))+dispersivePressureMain,uniforms:{...uniforms,uPressure:{value:ground},uPressureMode:{value:0}}});
  const scene=new THREE.Scene(),camera=new THREE.Camera(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,transport);quad.frustumCulled=false;scene.add(quad);
  const draw=(material:THREE.ShaderMaterial,target:THREE.WebGLRenderTarget)=>{quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);};
  const started=performance.now();draw(transport,targets[index]);
  const initialMass=pixels.filter((_,i)=>i%4===0).reduce((a,b)=>a+b,0);
  let elapsed=0,steps=0;
  while(elapsed<duration){
   uniforms.uDt.value=Math.min(dt,duration-elapsed);const original=targets[index].texture;
   for(let stage=0;stage<2;stage++){
    uniforms.uInput.value=targets[index].texture;uniforms.uOriginal.value=original;uniforms.uStage.value=stage;uniforms.uMode.value=0;
    if(dispersion){for(let j=0;j<=(warm?6:96);j++){
     pressure.uniforms.uPressureMode.value=j===0?(warm?1:0):2;pressure.uniforms.uPressure.value=pressures[pi].texture;pi=1-pi;draw(pressure,pressures[pi]);
    }warm=true;uniforms.uDispersivePressure.value=pressures[pi].texture;}
    index=(index+1)%3;draw(transport,targets[index]);
   }
   elapsed+=uniforms.uDt.value;steps++;
   if(steps%80===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const output=new Float32Array(pixels.length);renderer.readRenderTargetPixels(targets[index],0,0,n,n,output);
  let mass=0,s=0,co=0,nonfinite=0,kinetic=0,potential=0,momentumX=0,momentumZ=0,minDepth=Infinity,maxDepth=0;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
   const i=4*(z*n+x),h=output[i],phase=2*Math.PI*(mx*(x+.5)+mz*(z+.5))/n;
   if(![h,output[i+1],output[i+2]].every(Number.isFinite))nonfinite++;
   mass+=h;s+=(h-depth)*Math.sin(phase);co+=(h-depth)*Math.cos(phase);
   kinetic+=(output[i+1]**2+output[i+2]**2)/(2*h);potential+=.5*9.81*(h-depth)**2;momentumX+=output[i+1];momentumZ+=output[i+2];minDepth=Math.min(minDepth,h);maxDepth=Math.max(maxDepth,h);
  }
  const phase=Math.atan2(-co,s),expected=c*k*elapsed,phaseError=Math.atan2(Math.sin(phase-expected),Math.cos(phase-expected));
  const retained=2*Math.hypot(s,co)/(n*n*amp),massRelative=(mass-initialMass)/initialMass,glError=renderer.getContext().getError();
  results.push({mx,mz,dispersion:!!dispersion,breakingDissipation:breaking!==3,depth,amp,wavelength:2*Math.PI/k,phaseSpeed:c,seconds:elapsed,steps,phaseError,amplitudeRetention:retained,massRelative,kinetic,potential,momentumX,momentumZ,minDepth,maxDepth,nonfinite,glError,wallMilliseconds:performance.now()-started,pass:(breaking>1||Math.abs(phaseError)<.15&&retained>.75&&retained<1.15)&&Math.abs(massRelative)<1e-5&&minDepth>0&&nonfinite===0&&glError===0});
  targets.forEach(t=>t.dispose());pressures.forEach(t=>t.dispose());seed.dispose();ground.dispose();transport.dispose();pressure.dispose();geometry.dispose();renderer.setRenderTarget(null);
 }
 const breakingEnergyRatio=(results[4].kinetic+results[4].potential)/(results[5].kinetic+results[5].potential);
 result.textContent=JSON.stringify({pass:results.every(r=>r.pass)&&breakingEnergyRatio<1,breakingEnergyRatio,scope:'Actual GPU kernels; linear waves 0.6 periods and nonlinear breaker 3s on periodic flat bed. Not a field-calibrated coastal simulation.',results},null,2);
 save.disabled=false;
 }catch(error){result.textContent=String(error);}finally{button.disabled=false;}
};
