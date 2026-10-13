import * as THREE from 'three';
import {shoreWaveSampling} from './surface-detail.ts';
import {shoreSolverSampling} from './shore-solver.ts';
import {whitewaterFlowSampling} from './whitewater-flow.ts';

/** World-fixed foam/bubbles and a small, damped wake-wave equation. The
 * breaking sheet deposits at actual contact, never from old foam. */
export const marineSurfaceSampling=/* glsl */`
uniform sampler2D uMarineSurface;
uniform vec4 uMarineBounds;
uniform float uMarineReady,uMarineResolution;
vec4 marineSurface(vec2 world){
  if(uMarineReady<.5)return vec4(0);
  vec2 uv=(world-uMarineBounds.xy)/uMarineBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(0);
  float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
  return texture2D(uMarineSurface,uv)*smoothstep(0.,3./uMarineResolution,edge);
}
`;

export interface MarineDeposit {
  x:number;z:number;nx:number;nz:number;radius:number;halfLength:number;
  foam:number;bubbles:number;pressure:number;
}
export const MARINE_SOURCE_LIMIT=256;
/** Reaction is time-based, bounded and independent of frame rate. */
export function marineDecay(foam:number,bubbles:number,dt:number):[number,number]{
  return [Math.min(1,Math.max(0,foam))*Math.exp(-.28*dt),Math.min(1,Math.max(0,bubbles))*Math.exp(-.85*dt)];
}
export function validMarineDeposit(b:MarineDeposit):boolean{
  return Object.values(b).every(Number.isFinite)&&Math.abs(b.x)<1e6&&Math.abs(b.z)<1e6
    &&Math.abs(Math.hypot(b.nx,b.nz)-1)<.1&&b.radius>0&&b.radius<=6
    &&b.halfLength>=0&&b.halfLength<=20&&b.foam>=0&&b.bubbles>=0
    &&b.foam<=2&&b.bubbles<=2&&Math.abs(b.pressure)<=2;
}

export class MarineSurfaceField {
  readonly uniforms:Record<string,THREE.IUniform>;
  private readonly targets:THREE.WebGLRenderTarget[];
  private readonly transport:THREE.ShaderMaterial;
  private readonly stamp:THREE.ShaderMaterial;
  private readonly scene=new THREE.Scene();
  private readonly stamps=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));
  private readonly geometry=new THREE.InstancedBufferGeometry();
  private readonly sources=new Float32Array(MARINE_SOURCE_LIMIT*4);
  private readonly shapes=new Float32Array(MARINE_SOURCE_LIMIT*4);
  private readonly amounts=new Float32Array(MARINE_SOURCE_LIMIT*4);
  private queued=0;private index=0;private accumulator=0;private initialized=false;
  private disposed=false;private bathymetry:THREE.Texture|null=null;private bathymetryVersion=-1;
  private readonly bathymetryBounds=new THREE.Vector4();
  private readonly oldBounds=new THREE.Vector4();
  private passes=0;private accepted=0;private elapsed=0;private dropped=0;
  private readonly renderer:THREE.WebGLRenderer;
  readonly resolution:number;readonly span:number;
  constructor(renderer:THREE.WebGLRenderer,resolution=256,span=192){
    this.renderer=renderer;this.resolution=resolution;this.span=span;
    if(!Number.isInteger(resolution)||resolution<32||resolution>512||span<=0)throw Error('Bounded marine field required');
    this.uniforms={uMarineSurface:{value:null},uMarineBounds:{value:new THREE.Vector4()},uMarineReady:{value:0},uMarineResolution:{value:resolution}};
    this.targets=Array.from({length:2},()=>new THREE.WebGLRenderTarget(resolution,resolution,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false}));
    const shared={uWindow:this.uniforms.uMarineBounds,uOldWindow:{value:this.oldBounds},uPrevious:{value:null},uInitialized:{value:0},uSeconds:{value:0},uSize:{value:resolution}};
    const surface=/* glsl */`
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
      uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;
      uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${whitewaterFlowSampling}
      vec2 coastAt(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 displacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(coastAt(p),uSwell,uWind);}
      float waterAt(vec2 p){vec2 q=p;for(int i=0;i<3;i++)q=p-displacement(q).xz*uChoppiness;return shoreSolvedSurface(p,displacement(q).y,0.).x;}
    `;
    this.transport=new THREE.ShaderMaterial({uniforms:shared,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:/* glsl */`
      precision highp float;${surface}
      uniform sampler2D uPrevious;uniform vec4 uWindow,uOldWindow;
      uniform float uInitialized,uSeconds,uSize;
      vec4 history(vec2 uv){if(uInitialized<.5||any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(0);return texture2D(uPrevious,uv);}
      void main(){
        vec2 p=uWindow.xy+gl_FragCoord.xy/uSize*uWindow.zw;
        float depth=waterAt(p)-coastAt(p).x;
        if(depth<.015){gl_FragColor=vec4(0);return;}
        vec2 uv=(p-uOldWindow.xy)/uOldWindow.zw;
        vec4 flow=whitewaterSolvedFlow(p);
        // Outside the solved coast, weak orbital/Stokes drift is an explicit
        // visual closure; a solved negative swash velocity stays negative.
        vec2 velocity=mix(vec2(.18,0.),flow.xy,flow.w);
        vec4 previous=history(uv),advected=history(uv-velocity*uSeconds/uWindow.zw);
        vec2 e=vec2(1./uSize,0.);
        float lap=(history(uv+e).b+history(uv-e).b+history(uv+e.yx).b+history(uv-e.yx).b-4.*previous.b)/pow(uWindow.z/uSize,2.);
        float vertical=(previous.a+uSeconds*12.25*lap)*exp(-1.2*uSeconds);
        float height=clamp(previous.b+uSeconds*vertical,-.12,.12);
        float edge=min(min(gl_FragCoord.x,gl_FragCoord.y),min(uSize-gl_FragCoord.x,uSize-gl_FragCoord.y));
        float sponge=smoothstep(0.,8.,edge);
        gl_FragColor=vec4(clamp(advected.rg,0.,1.)*exp(-vec2(.28,.85)*uSeconds)*smoothstep(.015,.12,depth),height*sponge,clamp(vertical,-2.,2.)*sponge);
      }`});
    this.quad.material=this.transport;this.quad.frustumCulled=false;this.scene.add(this.quad);
    const plane=new THREE.PlaneGeometry(2,2);this.geometry.setAttribute('position',plane.getAttribute('position').clone());this.geometry.setIndex(plane.index!.clone());plane.dispose();
    for(const [name,array] of [['aSource',this.sources],['aShape',this.shapes],['aAmount',this.amounts]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=0;
    this.stamp=new THREE.ShaderMaterial({uniforms:{uWindow:this.uniforms.uMarineBounds},depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,toneMapped:false,
      vertexShader:/* glsl */`attribute vec4 aSource,aShape,aAmount;uniform vec4 uWindow;varying vec2 vLocal,vWorld;varying vec4 vShape,vAmount;
      void main(){vec2 tangent=vec2(aShape.y,-aShape.x),q=position.xy*vec2(aShape.z+aSource.z*2.,aSource.z*2.);
        vWorld=aSource.xy+tangent*q.x+aShape.xy*q.y;vLocal=q;vShape=vec4(aSource.z,aShape.z,0,0);vAmount=aAmount;
        gl_Position=vec4((vWorld-uWindow.xy)/uWindow.zw*2.-1.,0,1);}`,
      fragmentShader:/* glsl */`precision highp float;${surface}
      varying vec2 vLocal,vWorld;varying vec4 vShape,vAmount;
      void main(){float depth=waterAt(vWorld)-coastAt(vWorld).x;if(depth<.02)discard;
        vec2 q=vec2(max(0.,abs(vLocal.x)-vShape.y),vLocal.y);float r=length(q)/vShape.x;
        float weight=exp(-r*r*2.5)*(1.-smoothstep(1.1,2.,r));
        gl_FragColor=vec4(vAmount.rg*weight,0.,vAmount.b*weight);}`});
    const mesh=new THREE.Mesh(this.geometry,this.stamp);mesh.frustumCulled=false;this.stamps.add(mesh);
  }
  bindUniforms(shared:Record<string,THREE.IUniform>):void{
    for(const name of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uSwell','uWind','uChoppiness','uShoreState','uShoreBounds','uShoreReady','uShoreResolution'])
      if(shared[name]){this.transport.uniforms[name]=shared[name];this.stamp.uniforms[name]=shared[name];}
  }
  deposit(b:MarineDeposit):boolean{
    if(this.disposed||!validMarineDeposit(b)||this.queued>=MARINE_SOURCE_LIMIT)return false;
    const i=this.queued++*4;this.sources.set([b.x,b.z,b.radius,0],i);this.shapes.set([b.nx,b.nz,b.halfLength,0],i);this.amounts.set([b.foam,b.bubbles,b.pressure,0],i);this.accepted++;return true;
  }
  wake(x:number,z:number,yaw:number,vx:number,vz:number,throttle:number,dt:number):void{
    if(![x,z,yaw,vx,vz,throttle,dt].every(Number.isFinite)||dt<=0)return;
    const speed=Math.hypot(vx,vz);if(speed<.2&&Math.abs(throttle)<.1)return;
    const nx=Math.sin(yaw),nz=-Math.cos(yaw),amount=Math.min(1,speed/10),sternX=x-nx*2.5,sternZ=z-nz*2.5;
    // Moving pressure makes its own wake. No authored V is painted.
    this.deposit({x,z,nx:-nz,nz:nx,radius:.72,halfLength:2.1,foam:0,bubbles:0,pressure:-Math.min(.15,speed*.015)*dt});
    this.deposit({x:sternX-vx*dt*.5,z:sternZ-vz*dt*.5,nx:-nz,nz:nx,radius:.6+amount*.35,halfLength:Math.min(12,speed*dt*.5),foam:dt*(.8*amount+.4*Math.abs(throttle)),bubbles:dt*(1.5*amount+Math.abs(throttle)),pressure:.2*amount*dt});
  }
  update(seconds:number,x:number,z:number):void{
    if(this.disposed||![seconds,x,z].every(Number.isFinite)||seconds<0)return;
    const u=this.transport.uniforms;if(!u.uBathymetry?.value||!u.uLongWaves?.value||!u.uShortWaves?.value){this.reset();return;}
    const bathy=u.uBathymetry.value as THREE.Texture,bounds=u.uBathyBounds.value as THREE.Vector4;
    if(this.bathymetry!==bathy||this.bathymetryVersion!==bathy.version||!this.bathymetryBounds.equals(bounds)){
      this.initialized=false;this.uniforms.uMarineReady.value=0;this.bathymetry=bathy;this.bathymetryVersion=bathy.version;this.bathymetryBounds.copy(bounds);
    }
    this.accumulator+=seconds;
    const window=this.uniforms.uMarineBounds.value as THREE.Vector4,step=1/30,snap=6;
    const bx=Math.floor((x-this.span/2)/snap)*snap,bz=Math.floor((z-this.span/2)/snap)*snap;
    const steps=Math.min(3,Math.floor((this.accumulator+1e-9)/step));
    if(this.initialized&&steps===0&&window.x===bx&&window.y===bz)return;
    const dt=steps>0?step:0;this.accumulator=Math.max(0,this.accumulator-steps*step);
    if(this.accumulator>.1){this.dropped+=this.accumulator-.1;this.accumulator=.1;}
    const previousTarget=this.renderer.getRenderTarget(),xr=this.renderer.xr.enabled;
    try{
      this.renderer.xr.enabled=false;
      // Fixed 30 Hz transport, up to three steps when a displayed frame is
      // slower. Sources are deposited once, not multiplied by substeps.
      for(let substep=0;substep<Math.max(1,steps);substep++){
      this.oldBounds.copy(window);window.set(bx,bz,this.span,this.span);
      u.uInitialized.value=this.initialized?1:0;u.uSeconds.value=dt;u.uPrevious.value=this.targets[this.index].texture;
      this.index=1-this.index;this.renderer.setRenderTarget(this.targets[this.index]);this.renderer.render(this.scene,this.camera);
      if(this.queued){
        this.geometry.instanceCount=this.queued;for(const a of Object.values(this.geometry.attributes))if(a instanceof THREE.InstancedBufferAttribute)a.needsUpdate=true;
        const auto=this.renderer.autoClear;this.renderer.autoClear=false;
        try{this.renderer.render(this.stamps,this.camera);}finally{this.renderer.autoClear=auto;}
        this.queued=0;
      }
      this.initialized=true;this.uniforms.uMarineSurface.value=this.targets[this.index].texture;this.uniforms.uMarineReady.value=1;
      this.elapsed+=dt;this.passes++;
      }
    }finally{this.renderer.setRenderTarget(previousTarget);this.renderer.xr.enabled=xr;}
  }
  probe(){
    // RGBA16F readPixels is not portable. QA copies to an RGBA32F target
    // first, and reads floats; simulation itself keeps its 1 MiB budget.
    const data=new Float32Array(this.resolution*this.resolution*4),previous=this.renderer.getRenderTarget();
    const target=new THREE.WebGLRenderTarget(this.resolution,this.resolution,{type:THREE.FloatType,depthBuffer:false});
    const material=new THREE.ShaderMaterial({uniforms:{uInput:{value:this.targets[this.index].texture}},depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}',fragmentShader:'uniform sampler2D uInput;varying vec2 vUv;void main(){gl_FragColor=texture2D(uInput,vUv);}'});
    const original=this.quad.material;
    try{if(this.initialized){this.quad.material=material;this.renderer.setRenderTarget(target);this.renderer.render(this.scene,this.camera);this.renderer.readRenderTargetPixels(target,0,0,this.resolution,this.resolution,data);}}
    finally{this.quad.material=original;this.renderer.setRenderTarget(previous);target.dispose();material.dispose();}
    let foam=0,bubbles=0,height=0,finite=true;
    for(let i=0;i<data.length;i+=4){const a=data[i],b=data[i+1],h=data[i+2];finite&&=Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(h);foam=Math.max(foam,a);bubbles=Math.max(bubbles,b);height=Math.max(height,Math.abs(h));}
    return {...this.diagnostics,foam,bubbles,height,finite,glError:this.renderer.getContext().getError(),bounds:(this.uniforms.uMarineBounds.value as THREE.Vector4).toArray()};
  }
  get diagnostics(){return {ready:this.initialized,resolution:this.resolution,span:this.span,bytes:2*this.resolution*this.resolution*8,passes:this.passes,elapsed:this.elapsed,deposits:this.accepted,queued:this.queued,droppedSeconds:this.dropped,scope:'World-fixed half-float foam/bubble history plus bounded linear wake ripples; authored closures, not 3D CFD'};}
  reset():void{this.initialized=false;this.uniforms.uMarineReady.value=0;this.queued=0;this.accumulator=0;}
  dispose():void{if(this.disposed)return;this.disposed=true;this.reset();this.targets.forEach(t=>t.dispose());this.transport.dispose();this.stamp.dispose();this.quad.geometry.dispose();this.geometry.dispose();this.scene.clear();this.stamps.clear();}
}
