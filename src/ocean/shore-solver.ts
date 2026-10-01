import * as THREE from 'three';
import { shoreWaveSampling } from './surface-detail.ts';

/** Include after shoreWaveSampling, so terrain interpolation agrees with geometry. */
export const shoreSolverSampling = /* glsl */`
uniform sampler2D uShoreState;
uniform vec4 uShoreBounds;
uniform float uShoreReady,uShoreResolution;
vec3 shoreNode(vec2 uv){
  vec2 p=uShoreBounds.xy+uv*uShoreBounds.zw;
  vec2 buv=clamp((p-uBathyBounds.xy)/uBathyBounds.zw,vec2(0),vec2(1));
  float bed=sampleCoastalGround(uBathymetry,buv,uBathyResolution).r;
  vec4 s=texture2D(uShoreState,uv);float wet=step(.01,s.r);return vec3((bed+s.r)*wet,s.a*wet,wet);
}
vec2 shoreSolvedSurface(vec2 world,float fallbackHeight,float fallbackFoam){
  if(uShoreReady<.5)return vec2(fallbackHeight,fallbackFoam);
  vec2 uv=(world-uShoreBounds.xy)/uShoreBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(fallbackHeight,fallbackFoam);
  vec2 buv=(world-uBathyBounds.xy)/uBathyBounds.zw;
  if(any(lessThan(buv,vec2(0)))||any(greaterThan(buv,vec2(1))))return vec2(fallbackHeight,fallbackFoam);
  vec2 coast=sampleCoastalGround(uBathymetry,buv,uBathyResolution).rg;float bed=coast.r;
  if(coast.g<.18)return vec2(fallbackHeight,fallbackFoam);
  vec2 node=clamp(uv*uShoreResolution-.5,vec2(0),vec2(uShoreResolution-1.));
  vec2 base=min(floor(node),vec2(uShoreResolution-2.)),f=node-base;
  vec2 a=(base+.5)/uShoreResolution,e=vec2(1./uShoreResolution,0);
  vec3 weighted=mix(mix(shoreNode(a),shoreNode(a+e),f.x),mix(shoreNode(a+e.yx),shoreNode(a+e+e.yx),f.x),f.y);
  if(weighted.z<.00001)return vec2(fallbackHeight,fallbackFoam);
  vec2 surface=weighted.xy/weighted.z;
  float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
  float blend=smoothstep(.025,.10,edge)*(1.-smoothstep(8.,11.,-bed))*smoothstep(.015,.12,max(0.,surface.x-bed));
  return mix(vec2(fallbackHeight,fallbackFoam),surface,blend);
}
`;

const fragment = /* glsl */`
precision highp float;
uniform sampler2D uInput,uBathymetry,uLongWaves,uShortWaves;
uniform vec4 uBathyBounds,uBounds,uOldBounds;
uniform vec2 uBathyResolution;
uniform float uSize,uDx,uDt,uMode,uSwell,uChoppiness,uMaxDepth,uMaxSpeed,uMaxHeight;
${shoreWaveSampling}
vec2 world(vec2 uv){return uBounds.xy+uv*uBounds.zw;}
float bed(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return -uMaxDepth;
  return max(-uMaxDepth,sampleCoastalGround(uBathymetry,uv,uBathyResolution).r);
}
float fft(vec2 p){vec2 q=p;for(int i=0;i<3;i++){
  vec3 d=(texture2D(uLongWaves,q/384.).xyz+texture2D(uShortWaves,q/24.).xyz)*uSwell;
  q=p-d.xz*uChoppiness;
}return clamp((texture2D(uLongWaves,q/384.).y+texture2D(uShortWaves,q/24.).y)*uSwell,-uMaxHeight,uMaxHeight);}
vec4 incident(vec2 p){float b=bed(p),h=max(0.,fft(p)-b);
  // Authored shoreward characteristic proxy: actual FFT height, bathymetry uphill direction.
  // FFT does not provide incident propagation direction here.
  vec2 grad=vec2(bed(p+vec2(uDx,0))-bed(p-vec2(uDx,0)),bed(p+vec2(0,uDx))-bed(p-vec2(0,uDx)));
  vec2 n=grad/max(length(grad),.00001);
  float velocity=clamp(fft(p)*sqrt(9.81/max(.2,-b)),-uMaxSpeed,uMaxSpeed);
  return vec4(h,h*n*velocity,0.);
}
vec4 state(vec2 uv){if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return incident(world(uv));return texture2D(uInput,uv);}
vec3 physical(vec3 s,vec2 n){vec2 v=s.yz/max(s.x,.00001);float un=dot(v,n);return vec3(s.x*un,s.yz*un+.5*9.81*s.x*s.x*n);}
vec3 face(vec4 a,vec4 b,float za,float zb,vec2 n){
  float z=max(za,zb),ha=max(0.,a.x+za-z),hb=max(0.,b.x+zb-z);
  vec3 l=vec3(ha,a.yz*(ha/max(a.x,.00001))),r=vec3(hb,b.yz*(hb/max(b.x,.00001)));
  float speed=max(abs(dot(l.yz/max(ha,.00001),n))+sqrt(9.81*ha),abs(dot(r.yz/max(hb,.00001),n))+sqrt(9.81*hb));
  vec3 flux=.5*(physical(l,n)+physical(r,n)-speed*(r-l));
  // Hydrostatic reconstruction correction seen from the current cell.
  flux.yz+=.5*9.81*(a.x*a.x-ha*ha)*n;
  return flux;
}
void main(){vec2 uv=gl_FragCoord.xy/uSize,p=world(uv);
  if(uMode>.5){vec2 oldUV=(p-uOldBounds.xy)/uOldBounds.zw;
    gl_FragColor=uMode>1.5||any(lessThan(oldUV,vec2(0)))||any(greaterThan(oldUV,vec2(1)))?incident(p):texture2D(uInput,oldUV);return;}
  vec2 e=vec2(1./uSize,0);vec4 a=state(uv),r=state(uv+e),l=state(uv-e),t=state(uv+e.yx),b=state(uv-e.yx);float z=bed(p);
  vec3 sum=face(a,r,z,bed(p+vec2(uDx,0)),vec2(1,0))+face(a,l,z,bed(p-vec2(uDx,0)),vec2(-1,0))+face(a,t,z,bed(p+vec2(0,uDx)),vec2(0,1))+face(a,b,z,bed(p-vec2(0,uDx)),vec2(0,-1));
  vec3 next=a.xyz-uDt/uDx*sum;
  next.x=clamp(next.x,0.,uMaxDepth+uMaxHeight);
  if(next.x<.01)next.yz=vec2(0);else{
    vec2 v=next.yz/next.x;float speed=length(v);v*=min(1.,uMaxSpeed/max(speed,.00001));
    v/=1.+uDt*.025*speed/max(next.x,.05);next.yz=v*next.x;
  }
  // Advected concentration with dissipative birth at compressive shallow bores.
  vec2 v=next.yz/max(next.x,.01);float foam=texture2D(uInput,clamp(uv-v*uDt/uBounds.zw,vec2(.5/uSize),vec2(1.-.5/uSize))).a*exp(-uDt*.35);
  float compression=max(0.,-((r.y/max(r.x,.01)-l.y/max(l.x,.01))+(t.z/max(t.x,.01)-b.z/max(b.x,.01)))/(2.*uDx));
  float born=clamp(compression*.7,0.,1.)*(1.-smoothstep(3.,7.,next.x))*smoothstep(.05,.3,next.x);
  foam=max(foam,born*(1.-exp(-uDt*4.)));
  // Four-cell sponge keeps open boundary forcing out of the interior update.
  float edge=min(min(gl_FragCoord.x,gl_FragCoord.y),min(uSize-gl_FragCoord.x,uSize-gl_FragCoord.y));
  float relaxation=(1.-smoothstep(1.,6.,edge))*(1.-exp(-uDt*3.));
  gl_FragColor=mix(vec4(next,clamp(foam,0.,1.)),incident(p),relaxation);
}
`;

export function createShoreSolverUniforms():Record<string,THREE.IUniform> {
  return {uShoreState:{value:null},uShoreBounds:{value:new THREE.Vector4()},uShoreReady:{value:0},uShoreResolution:{value:128}};
}

const finiteOption=(value:number|undefined,fallback:number,min:number,max:number):number=>Number.isFinite(value)?Math.max(min,Math.min(max,value!)):fallback;

export interface ShoreSolverOptions { resolution?: number; span?: number; maxDepth?: number; maxSpeed?: number; maxHeight?: number; maxSubsteps?: number }
/** First-order depth-integrated SWE candidate. Opt-in; WebGL2 RGBA16F required. */
export class ShoreSolver {
  readonly uniforms = createShoreSolverUniforms();
  readonly resolution:number;
  readonly span:number;
  readonly stableDelta:number;
  droppedSeconds=0;
  simulationElapsed=0;
  substeps=0;
  private readonly targets:THREE.WebGLRenderTarget[];
  private readonly material:THREE.ShaderMaterial;
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));
  private index=0;
  private ready=false;
  private disposed=false;
  private readonly maxSubsteps:number;
  constructor(private readonly renderer:THREE.WebGLRenderer,options:ShoreSolverOptions={}){
    this.resolution=Math.round(finiteOption(options.resolution,128,16,256));
    this.uniforms.uShoreResolution={value:this.resolution};
    this.span=finiteOption(options.span,192,24,768);this.maxSubsteps=Math.round(finiteOption(options.maxSubsteps,8,1,16));
    const maxDepth=finiteOption(options.maxDepth,12,11,24),maxSpeed=finiteOption(options.maxSpeed,12,1,30),maxHeight=finiteOption(options.maxHeight,4,.1,8);
    this.stableDelta=.20*(this.span/this.resolution)/(maxSpeed+Math.sqrt(9.81*(maxDepth+maxHeight)));
    this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(this.resolution,this.resolution,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false}));
    this.material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment,uniforms:{uInput:{value:null},uBathymetry:{value:null},uLongWaves:{value:null},uShortWaves:{value:null},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uBathyTriangulated:{value:0},uBounds:this.uniforms.uShoreBounds,uOldBounds:{value:new THREE.Vector4()},uSize:{value:this.resolution},uDx:{value:this.span/this.resolution},uDt:{value:0},uMode:{value:2},uSwell:{value:1},uChoppiness:{value:1},uMaxDepth:{value:maxDepth},uMaxSpeed:{value:maxSpeed},uMaxHeight:{value:maxHeight}}});
    this.quad.material=this.material;this.quad.frustumCulled=false;this.scene.add(this.quad);
  }
  get diagnostics():{substeps:number;simulationElapsed:number;droppedSeconds:number;stableDelta:number;bounds:THREE.Vector4} {
    return {substeps:this.substeps,simulationElapsed:this.simulationElapsed,droppedSeconds:this.droppedSeconds,stableDelta:this.stableDelta,bounds:(this.uniforms.uShoreBounds.value as THREE.Vector4).clone()};
  }
  bindUniforms(shared:Record<string,THREE.IUniform>):void {for(const name of ['uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uLongWaves','uShortWaves','uSwell','uChoppiness'])if(shared[name])this.material.uniforms[name]=shared[name];}
  private pass(mode:number,dt:number):void {const u=this.material.uniforms;u.uInput.value=this.targets[this.index].texture;u.uMode.value=mode;u.uDt.value=dt;this.index=1-this.index;this.renderer.setRenderTarget(this.targets[this.index]);this.renderer.render(this.scene,this.camera);this.uniforms.uShoreState.value=this.targets[this.index].texture;}
  update(deltaSeconds:number,x:number,z:number):void {
    if(this.disposed||![deltaSeconds,x,z].every(Number.isFinite)||deltaSeconds<0)return;
    const u=this.material.uniforms;
    if(!this.renderer.extensions.has('EXT_color_buffer_float')||!u.uBathymetry.value||!u.uLongWaves.value||!u.uShortWaves.value){this.uniforms.uShoreReady.value=0;return;}
    const previous=this.renderer.getRenderTarget(),xr=this.renderer.xr.enabled;this.renderer.xr.enabled=false;
    try{
      const bounds=this.uniforms.uShoreBounds.value as THREE.Vector4,dx=this.span/this.resolution;
      const bx=Math.floor((x-this.span/2)/dx)*dx,bz=Math.floor((z-this.span/2)/dx)*dx;
      if(!this.ready||bounds.x!==bx||bounds.y!==bz){(u.uOldBounds.value as THREE.Vector4).copy(bounds);bounds.set(bx,bz,this.span,this.span);this.pass(this.ready?1:2,0);this.ready=true;}
      const elapsed=Math.min(deltaSeconds,this.stableDelta*this.maxSubsteps);this.droppedSeconds+=deltaSeconds-elapsed;
      const count=Math.ceil(elapsed/this.stableDelta);this.substeps=count;for(let i=0;i<count;i++)this.pass(0,elapsed/count);this.simulationElapsed+=elapsed;
      this.uniforms.uShoreReady.value=1;
    }finally{this.renderer.setRenderTarget(previous);this.renderer.xr.enabled=xr;}
  }
  reset():void {this.ready=false;this.uniforms.uShoreReady.value=0;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.uniforms.uShoreReady.value=0;this.targets.forEach(t=>t.dispose());this.material.dispose();this.quad.geometry.dispose();this.scene.clear();}
}
