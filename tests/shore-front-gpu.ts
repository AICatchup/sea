import * as THREE from 'three';
import {ShoreFront} from '../src/ocean/shore-front.ts';
import {ShoreBreaker} from '../src/ocean/shore-breaker.ts';

const output:Record<string,unknown>={status:'running',scope:'Actual GPU evolution shader with analytic independent surface; not photoreal acceptance'};
Object.assign(window,{__frontResult:output});
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,antialias:false});renderer.setSize(32,32);
const errors:string[]=[];renderer.debug.onShaderError=(gl,program,vertex,fragment)=>errors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].join('\n'));
const texture=new THREE.DataTexture(new Float32Array([0,1,0,1]),1,1,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;
const uniforms={uBathymetry:{value:texture},uLongWaves:{value:texture},uShortWaves:{value:texture},uBathyBounds:{value:new THREE.Vector4(-100,-100,200,200)},uBathyResolution:{value:new THREE.Vector2(1,1)},uBathyTriangulated:{value:0},uShoreReady:{value:0},uShoreBounds:{value:new THREE.Vector4(-100,-100,200,200)},uSwell:{value:1},uWind:{value:12},uFixtureTime:{value:0},uFixtureKind:{value:0},uFixtureAngle:{value:0}};
const sampling=/*glsl*/`
uniform vec4 uBathyBounds,uShoreBounds;uniform float uShoreReady,uSwell,uWind,uFixtureTime,uFixtureKind,uFixtureAngle;
vec2 coast(vec2 p){
 float bed=-2.+.015*p.x;
 if(uFixtureKind==2.)bed=1.;if(uFixtureKind==3.)bed=-8.;if(uFixtureKind==5.)bed=-2.;
 return vec2(bed,uFixtureKind==4.?.1:1.);
}
float incidentHeight(vec2 p){
 float x=dot(p,vec2(cos(uFixtureAngle),sin(uFixtureAngle)))-2.*uFixtureTime;
 float rival=uFixtureTime>1.?1.8:.08;
 return .65*exp(-x*x/9.)+rival*exp(-(x+9.)*(x+9.)/4.);
}
float baseHeight(vec2 p){return uFixtureKind==6.?-3.:incidentHeight(p);}
vec4 whitewaterSolvedFlow(vec2 p){return vec4(0,0,1,1);}
float shoreBreakerDissipation(float height,vec2 c,float swell,float wind){return uFixtureKind==1.?0.:1.;}
float frontEnergy(vec2 p){return uFixtureKind==1.?0.:1.;}
`;
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const fronts:ShoreFront[]=[];
try{
  assert(renderer.extensions.has('EXT_color_buffer_float'),'Float target unavailable');
  const summaries=[];
  for(const cached of [false,true])for(const hz of [30,60,120]){
    const front=new ShoreFront(renderer,sampling,uniforms,17,16,cached);fronts.push(front);
    uniforms.uFixtureTime.value=0;front.update(0,0,0,0);
    let probe=front.probe(),previous=probe.fronts[8].position[0];
    const initial=previous,id=probe.fronts[8].position[3];let maxStep=0,maxPhaseError=0;
    assert(id>0&&probe.fronts[8].shape[1]>0,'Known breaking shoulder failed to create a front');
    const samples=[];
    for(let i=1;i<=3*hz;i++){
      const t=i/hz;uniforms.uFixtureTime.value=t;front.update(1/hz,t,0,0);probe=front.probe();
      const centre=probe.fronts[8],x=centre.position[0],step=x-previous;
      assert(centre.position[3]===id,'Tracked front changed identity when distant rival became taller');
      assert(Number.isFinite(x)&&step>=-.03&&step<.45,'Front position jumped');
      const expected=Math.sqrt(9/2)+2*t; // analytic steepest shoulder of the translated Gaussian
      maxStep=Math.max(maxStep,Math.abs(step));maxPhaseError=Math.max(maxPhaseError,Math.abs(x-expected));previous=x;
      if(i%hz===0)samples.push({time:t,x,expected,id,active:centre.shape[3]});
    }
    assert(maxPhaseError<(cached?.55:.25),`Analytic phase drift ${maxPhaseError}`);
    const before=JSON.stringify(probe.fronts),passes=front.diagnostics.passes;
    front.update(0,3,9,3);
    assert(JSON.stringify(front.probe().fronts)===before&&front.diagnostics.passes===passes,'Paused camera movement changed world-fixed front');
    const resets=front.diagnostics.resets;uniforms.uWind.value=13;front.update(0,3,9,3);
    assert(front.diagnostics.resets>resets,'Changed spectrum retained front history');uniforms.uWind.value=12;
    front.update(0,0,9,3);
    assert(front.diagnostics.resets>=2,'Clock rewind did not reset history');
    summaries.push({hz,cached,initial,maxStep,maxPhaseError,samples,pausedWorldFixed:true,spectrumReset:true,rewindReset:true});
    front.dispose();
  }
  output.phase=summaries;
  uniforms.uFixtureAngle.value=.4;uniforms.uFixtureTime.value=0;
  const oblique=new ShoreFront(renderer,sampling,uniforms,17,16,true);fronts.push(oblique);oblique.update(0,0,0,0);
  const obliqueId=oblique.probe().fronts[8].position[3];let minimumActive=17,minimumAlignment=1;
  for(let i=1;i<=120;i++){
    const t=i/60;uniforms.uFixtureTime.value=t;oblique.update(1/60,t,0,0);
    const p=oblique.probe(),centre=p.fronts[8],alignment=centre.motion[0]*Math.cos(.4)+centre.motion[1]*Math.sin(.4);
    assert(centre.position[3]===obliqueId&&obliqueId>0,'Oblique front lost identity');
    minimumActive=Math.min(minimumActive,p.fronts.filter(f=>f.shape[3]>0).length);minimumAlignment=Math.min(minimumAlignment,alignment);
  }
  assert(minimumActive>=13&&minimumAlignment>.99,'Front followed the shoreline rather than oblique wave phase');
  output.oblique={angleRadians:.4,minimumActive,minimumAlignment};oblique.dispose();uniforms.uFixtureAngle.value=0;
  const negative=new ShoreFront(renderer,sampling,uniforms,17,16,true);fronts.push(negative);
  const negatives=[];
  for(const [kind,name] of [[1,'no-current-birth'],[2,'dry-bed'],[3,'deep-water'],[4,'sheltered'],[5,'no-shore-direction'],[6,'water-below-bed']] as const){
    uniforms.uFixtureKind.value=kind;uniforms.uFixtureTime.value=0;negative.reset();negative.update(0,0,0,0);
    assert(negative.probe().fronts.every(p=>p.shape[3]===0),name+' emitted');negatives.push(name);
  }
  uniforms.uFixtureKind.value=0;uniforms.uBathyBounds.value.set(200,200,200,200);negative.update(0,0,0,0);
  assert(negative.probe().fronts.every(p=>p.shape[3]===0),'Outside bathymetry emitted');negatives.push('outside-bathymetry');
  negative.update(.3,.3,0,0);assert(!negative.diagnostics.ready,'Large timestep kept stale front');
  output.negatives=negatives;output.invalidDtCleared=true;
  uniforms.uBathyBounds.value.set(-100,-100,200,200);
  const actualSheet=new ShoreBreaker(renderer,true);
  try{
    actualSheet.bindUniforms(uniforms);actualSheet.update(0,0,false,0,0);
    const actual=actualSheet.probeDriver(renderer);
    assert(actual.available,'Production sampler tracker unavailable');
    assert(!renderer.getContext().isContextLost(),'Production sampler lost context');
    output.productionSampling={compiled:errors.length===0,readback:actual.available};
  }finally{actualSheet.dispose();}
  assert(errors.length===0,'GPU shader compile failed: '+errors.join('\n'));
  output.status='PASS';
}catch(error){output.status='FAIL';output.error=String(error);output.shaderErrors=errors;}
finally{fronts.forEach(f=>f.dispose());texture.dispose();renderer.dispose();document.querySelector('#result')!.textContent=JSON.stringify(output,null,2);}
