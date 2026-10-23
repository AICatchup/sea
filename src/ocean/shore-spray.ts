import { ShoreBreakingLips } from './shore-breaking-lips.ts';
import {ConnectedShoreBreakers,traceBreakingFront,type BreakerImpact} from './connected-breakers.ts';
import {marineSurfaceSampling} from './marine-surface-field.ts';
import * as THREE from 'three';
import {OCEAN_PROPAGATION_DIRECTION} from './wave-direction.ts';
/** Integer births plus a fractional Bernoulli retain the expected rate even
 * when a frame contains more than one event. The caller keeps its pool cap. */
export function sprayEmissionCount(rate:number,dt:number,random:number):number{
  if(![rate,dt,random].every(Number.isFinite)||rate<=0||dt<=0)return 0;
  const expected=Math.min(100,rate*dt),whole=Math.floor(expected);
  return whole+(random<expected-whole?1:0);
}
import { shoreWaveSampling,shoreBreakerDissipationSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { ShoreWhitewaterVolume } from './shore-whitewater-volume.ts';
import { whitewaterFlowSampling, decodeWhitewaterVelocity, whitewaterAerationStrength } from './whitewater-flow.ts';
import { ShoreWhitewater, whitewaterBirthRate, type WhitewaterSample } from './shore-whitewater.ts';

const SPAN=144, INTERVAL=.2, LIMIT=1500;
type Uniforms=Record<string,THREE.IUniform>;
export interface SprayBirth {x:number;y:number;z:number;vx:number;vy:number;vz:number;windX:number;windZ:number;drag:number;life:number;size:number;opacity:number}

/** Fixed birth state; positions use analytic gravity and horizontal wind drag.
 * No origin reattachment to the camera or a later wave sample. */
export class SprayPool {
  readonly positions:Float32Array;
  readonly sizes:Float32Array;
  readonly alpha:Float32Array;
  private readonly births:(SprayBirth|null)[];
  private readonly ages:Float64Array;
  private cursor=0;
  private readonly hitSample:WhitewaterSample={height:0,compression:0,depth:0,shelter:1,ground:0,gradientX:0,gradientZ:0};
  active=0;
  readonly capacity:number;
  constructor(capacity=LIMIT){
    if(!Number.isInteger(capacity)||capacity<1||capacity>LIMIT)throw new Error('Invalid spray capacity');
    this.capacity=capacity;this.positions=new Float32Array(capacity*3);this.sizes=new Float32Array(capacity);this.alpha=new Float32Array(capacity);
    this.births=Array(capacity).fill(null);this.ages=new Float64Array(capacity);
  }
  emit(b:SprayBirth):boolean{
    if(!Object.values(b).every(Number.isFinite)||b.life<=0||b.drag<=0||b.size<=0||b.opacity<=0)return false;
    for(let n=0;n<this.capacity;n++){
      const i=(this.cursor+n)%this.capacity;if(this.births[i])continue;
      this.births[i]={...b};this.ages[i]=0;this.sizes[i]=b.size;this.alpha[i]=0;
      this.positions.set([b.x,b.y,b.z],i*3);this.active++;this.cursor=(i+1)%this.capacity;return true;
    }return false;
  }
  advance(delta:number,sampler?:import('./shore-whitewater.ts').WhitewaterSampler,hit?:(x:number,y:number,z:number)=>void):void{
    if(!Number.isFinite(delta)||delta<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const t=this.ages[i]+=delta;
      if(t>=b.life){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      const travel=(1-Math.exp(-b.drag*t))/b.drag;
      this.positions[i*3]=b.x+b.windX*t+(b.vx-b.windX)*travel;
      this.positions[i*3+1]=b.y+b.vy*t-4.905*t*t;
      this.positions[i*3+2]=b.z+b.windZ*t+(b.vz-b.windZ)*travel;
      if(sampler&&t>.06){
        const s=this.hitSample;
        if(sampler(this.positions[i*3],this.positions[i*3+2],s)&&this.positions[i*3+1]<=s.height&&s.depth>.02){
          hit?.(this.positions[i*3],s.height,this.positions[i*3+2]);this.births[i]=null;this.alpha[i]=0;this.active--;continue;
        }
      }
      const fade=Math.min(1,t/.06)*Math.pow(1-t/b.life,1.4);
      this.alpha[i]=b.opacity*fade;
    }
  }
  clear():void{this.births.fill(null);this.alpha.fill(0);this.active=0;}
}

/** 36m² sampled cell: one sparse mist packet per m² per unit instantaneous
 * birth proxy per second. Zero source has zero rate; historical foam supplies
 * no packets. Packets use finite ballistic lives, never background fog. */
export function sprayBirthRate(depth:number,energy:number,shelter:number,distance:number):number{
  if(![depth,energy,shelter,distance].every(Number.isFinite)||depth<.2||depth>4||energy<=0||shelter<.18||distance>90)return 0;
  const shore=Math.min(1,(depth-.2)/.4)*Math.min(1,(4-depth)/1.2);
  return 36*shore*Math.max(0,Math.min(1,energy))*Math.max(0,Math.min(1,shelter))*Math.max(0,1-distance/100);
}

/** 576 surface samples, RG16 height/B breaker energy/A depth, 2304 bytes.
 * Whitewater adds 576 RG8 signed flow/B validity/A sentinel pixels in the
 * same draw/read request (4608 bytes total at 5Hz, not another readback).
 * The shader recomputes compression: FFT alpha contains historical foam, not
 * the instantaneous Jacobian. Bathymetry uses the renderer's half-texel map.
 * Birth sites are a 6m grid and at most 0.2s old: this is a bounded approximation
 * to crest spray, not a resolved fluid simulation. Optional ballistic lips
 * delay foam and an impact fan until sampled surface contact. */
export class ShoreSpray {
  readonly group=new THREE.Group();
  private readonly pool=new SprayPool();
  private readonly scene=new THREE.Scene();
  private readonly sampleCamera=new THREE.Camera();
  private readonly target:THREE.WebGLRenderTarget;
  private readonly flowReadback:boolean;
  private readonly quadGeometry=new THREE.PlaneGeometry(2,2);
  private readonly sampleMaterial:THREE.ShaderMaterial;
  private readonly geometry=new THREE.BufferGeometry();
  private readonly material:THREE.ShaderMaterial;
  private readonly renderer:THREE.WebGLRenderer;
  private readonly ground:{heightAt(x:number,z:number):number};
  private pixels:Uint8Array|null=null;
  private sampleOrigin=new THREE.Vector2();
  private sampleTime=-Infinity;
  private previousPixels:Uint8Array|null=null;private previousTime=-Infinity;private previousOrigin=new THREE.Vector2();private simulationTime=0;
  private lastRequest=-Infinity;
  private pending=false;
  private disposed=false;
  private failed=false;
  private randomState=0x137a942;
  private generation=0;
  private readonly energizedCells:Uint16Array;
  private energizedCount=0;
  private emitted=0;
  private whitewaterEmitted=0;
  private foamScanCursor=0;
  private maxSampleEnergy=0;
  private maxSampleCrest=0;
  private maxEstimatedHeightDepthRatio=0;
  private sampleEnergyPositiveCount=0;
  private sampleWetEligibleCount=0;
  private updateMs=0;
  readonly whitewater:ShoreWhitewater|ShoreWhitewaterVolume|null;
  readonly lips:ShoreBreakingLips|ConnectedShoreBreakers|null;
  readonly rollers:ShoreWhitewaterVolume|null;
  private readonly grid:number;private readonly span:number;
  private lastFrontSample=-Infinity;
  private fronts:{x:number;z:number;nx:number;nz:number;halfWidth:number;time:number}[]=[];
  private impactSink:((b:import('./shore-whitewater.ts').WhitewaterBirth&Partial<BreakerImpact>)=>boolean)|null=null;
  private readonly foamSample:WhitewaterSample={height:0,compression:0,depth:0,shelter:1,ground:0,gradientX:0,gradientZ:0};
  private foamCacheValid=false;
  private readonly sampleFoam=(x:number,z:number,out:WhitewaterSample):boolean=>{
    if(!this.foamCacheValid||!this.pixels)return false;
    const GRID=this.grid,step=this.span/GRID;
    const cx=(x-this.sampleOrigin.x)/step+GRID/2-.5,cz=(z-this.sampleOrigin.y)/step+GRID/2-.5;
    if(cx<0||cz<0||cx>GRID-1||cz>GRID-1)return false;
    const ix=Math.floor(cx),iz=Math.floor(cz),fx=cx-ix,fz=cz-iz;
    const h=(a:number,b:number)=>{const i=(b*GRID+a)*4;return (this.pixels![i]*256+this.pixels![i+1])/65535*16-8;};
    out.height=THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(ix,iz),h(Math.min(ix+1,GRID-1),iz),fx),THREE.MathUtils.lerp(h(ix,Math.min(iz+1,GRID-1)),h(Math.min(ix+1,GRID-1),Math.min(iz+1,GRID-1)),fx),fz);
    const i=(Math.round(cz)*GRID+Math.round(cx))*4;
    out.waveGradientX=(h(Math.min(ix+1,GRID-1),iz)-h(Math.max(ix-1,0),iz))/(ix>0&&ix<GRID-1?2*step:step);
    out.waveGradientZ=(h(ix,Math.min(iz+1,GRID-1))-h(ix,Math.max(iz-1,0)))/(iz>0&&iz<GRID-1?2*step:step);
    out.compression=this.pixels[i+2]/255;out.shelter=1;
    if(GRID>24){
      const g=(a:number,b:number)=>h(a,b)-this.pixels![(b*GRID+a)*4+3]/255*8;
      out.ground=THREE.MathUtils.lerp(THREE.MathUtils.lerp(g(ix,iz),g(Math.min(ix+1,GRID-1),iz),fx),THREE.MathUtils.lerp(g(ix,Math.min(iz+1,GRID-1)),g(Math.min(ix+1,GRID-1),Math.min(iz+1,GRID-1)),fx),fz);
      out.gradientX=g(Math.min(ix+1,GRID-1),iz)-g(Math.max(ix-1,0),iz);out.gradientZ=g(ix,Math.min(iz+1,GRID-1))-g(ix,Math.max(iz-1,0));
    }else{out.ground=this.ground.heightAt(x,z);out.gradientX=this.ground.heightAt(x+2,z)-this.ground.heightAt(x-2,z);out.gradientZ=this.ground.heightAt(x,z+2)-this.ground.heightAt(x,z-2);}
        // Collision follows the moving heightfield between asynchronous samples.
    // Keep ground fixed: only water elevation may be extrapolated.
    delete out.heightRate;
    if(this.lips instanceof ConnectedShoreBreakers&&this.previousPixels){
      const interval=this.sampleTime-this.previousTime,age=this.simulationTime-this.sampleTime;
      const px=(x-this.previousOrigin.x)/step+GRID/2-.5,pz=(z-this.previousOrigin.y)/step+GRID/2-.5;
      if(interval>.001&&interval<=.5&&age>=0&&age<=.5&&px>=0&&pz>=0&&px<=GRID-1&&pz<=GRID-1){
        const ax=Math.floor(px),az=Math.floor(pz),tx=px-ax,tz=pz-az;
        const old=(a:number,b:number)=>{const k=(b*GRID+a)*4;return (this.previousPixels![k]*256+this.previousPixels![k+1])/65535*16-8;};
        const before=THREE.MathUtils.lerp(THREE.MathUtils.lerp(old(ax,az),old(Math.min(ax+1,GRID-1),az),tx),THREE.MathUtils.lerp(old(ax,Math.min(az+1,GRID-1)),old(Math.min(ax+1,GRID-1),Math.min(az+1,GRID-1)),tx),tz);
        out.heightRate=THREE.MathUtils.clamp((out.height-before)/interval,-8,8);
        out.height+=out.heightRate*Math.min(age,.2);
      }
    }
    out.depth=Math.max(0,out.height-out.ground);
    delete out.flowX;delete out.flowZ;
    if(this.flowReadback){
      // Bilinear transport, with validity weighted separately at solver edges.
      let vx=0,vz=0,weight=0;
      for(const [xx,zz,w] of [[ix,iz,(1-fx)*(1-fz)],[Math.min(ix+1,GRID-1),iz,fx*(1-fz)],[ix,Math.min(iz+1,GRID-1),(1-fx)*fz],[Math.min(ix+1,GRID-1),Math.min(iz+1,GRID-1),fx*fz]]){
        const j=(GRID*GRID+zz*GRID+xx)*4,valid=this.pixels[j+2]/255;
        vx+=decodeWhitewaterVelocity(this.pixels[j])*w*valid;vz+=decodeWhitewaterVelocity(this.pixels[j+1])*w*valid;weight+=w*valid;
      }
      if(weight>.5){out.flowX=vx/weight;out.flowZ=vz/weight;}
    }
    return true;
  };
  constructor(renderer:THREE.WebGLRenderer,ground:{heightAt(x:number,z:number):number},options:{whitewater?:boolean;patches?:boolean;volume?:boolean;lips?:boolean;connected?:boolean;resolution?:number;span?:number}={}){
    this.renderer=renderer;this.ground=ground;
    this.grid=options.resolution??24;this.span=options.span??SPAN;
    if(!Number.isInteger(this.grid)||this.grid<24||this.grid>64||this.span<=0)throw Error('Bounded spray cache required');
    const GRID=this.grid;
    this.energizedCells=new Uint16Array(GRID*GRID);
    this.lips=options.lips?(options.connected?new ConnectedShoreBreakers():new ShoreBreakingLips()):null;if(this.lips)this.group.add(this.lips.group);
    if(this.lips instanceof ConnectedShoreBreakers)this.lips.pool.releaseWater=p=>{
      if(this.pool.emit({...p,windX:0,windZ:0,drag:.15,life:2.5,size:.10,opacity:.32}))this.emitted++;
    };
    this.rollers=this.lips instanceof ConnectedShoreBreakers?new ShoreWhitewaterVolume(true):null;if(this.rollers)this.group.add(this.rollers.group);
    this.flowReadback=!!options.volume||!!options.whitewater;
    this.target=new THREE.WebGLRenderTarget(GRID,GRID*(this.flowReadback?2:1),{type:THREE.UnsignedByteType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    this.whitewater=options.patches===false?null:options.volume?new ShoreWhitewaterVolume():options.whitewater?new ShoreWhitewater():null;
    if(this.whitewater)this.group.add(this.whitewater.group);
    this.sampleMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...createShoreSolverUniforms(),uMarineSurface:{value:null},uMarineBounds:{value:new THREE.Vector4()},uMarineReady:{value:0},uMarineResolution:{value:256},uSampleSize:{value:GRID},uSampleStep:{value:this.span/GRID},uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uCenter:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55},uDepthCapLoss:{value:(options.whitewater||options.volume)?1:0}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:/* glsl */`
      precision highp float;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
      uniform vec4 uBathyBounds;uniform vec2 uBathyResolution,uCenter;
      uniform float uSwell,uWind,uChoppiness,uDepthCapLoss,uSampleSize,uSampleStep;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${shoreBreakerDissipationSampling}
      ${whitewaterFlowSampling}
      ${marineSurfaceSampling}
      vec2 coastAt(vec2 p){
        vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
        if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);
        return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;
      }
      vec3 longAt(vec2 p){return texture2D(uLongWaves,p/384.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 shortAt(vec2 p){return texture2D(uShortWaves,p/24.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 displacement(vec2 p){return (longAt(p)+shortAt(p))*uSwell;}
      void main(){
        vec2 world=uCenter+(vec2(gl_FragCoord.x,mod(gl_FragCoord.y,uSampleSize))-vec2(uSampleSize*.5))*uSampleStep;
        vec4 flow=whitewaterSolvedFlow(world);
        if(gl_FragCoord.y>=uSampleSize){
          gl_FragColor=vec4(floor(clamp(flow.xy/12.,vec2(-1),vec2(1))*127.+128.+.5)/255.,flow.w,137./255.);return;
        }
        vec2 p=world;
        for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;
        vec2 coast=coastAt(p);float depth=max(0.0,-coast.x);
        vec3 dx=(longAt(p+vec2(1.5,0))-longAt(p-vec2(1.5,0)))/3.0;
        vec3 dz=(longAt(p+vec2(0,1.5))-longAt(p-vec2(0,1.5)))/3.0;
        dx+=(shortAt(p+vec2(.1875,0))-shortAt(p-vec2(.1875,0)))/.375;
        dz+=(shortAt(p+vec2(0,.1875))-shortAt(p-vec2(0,.1875)))/.375;
        float chop=uChoppiness*uSwell;
        float jac=(1.0+dx.x*chop)*(1.0+dz.z*chop)-dx.z*dz.x*chop*chop;
        float h=displacement(p).y;
        float energy=(1.0-smoothstep(.05,.46,jac))*smoothstep(.025,.22,h)*clamp(coast.y,0.0,1.0);
        energy*=smoothstep(.2,.6,depth)*(1.0-smoothstep(2.8,4.0,depth))*smoothstep(4.0,12.0,uWind);
        if(uDepthCapLoss>.5){
          float rawFftHeight=texture2D(uLongWaves,p/384.0).y+texture2D(uShortWaves,p/24.0).y;
          float depthLoss=shoreBreakerDissipation(rawFftHeight,coast,uSwell,uWind);
          energy=max(energy,depthLoss*smoothstep(.2,.6,depth)*(1.0-smoothstep(2.8,4.0,depth)));
        }
        h=shoreSolvedSurface(world,h,0.).x+marineSurface(world).b;
        // The solver's alpha is advected old foam, not instantaneous breaking.
        energy=mix(energy,flow.z,flow.w);
        depth=max(0.,h-coastAt(world).x);
        float code=floor(clamp(h/16.0+.5,0.0,1.0)*65535.0+.5);
        gl_FragColor=vec4(floor(code/256.0),mod(code,256.0),floor(energy*255.0+.5),floor(clamp(depth/8.0,0.0,1.0)*255.0+.5))/255.0;
      }`});
    const quad=new THREE.Mesh(this.quadGeometry,this.sampleMaterial);quad.frustumCulled=false;this.scene.add(quad);
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.pool.positions,3));
    this.geometry.setAttribute('aSize',new THREE.BufferAttribute(this.pool.sizes,1));
    this.geometry.setAttribute('aAlpha',new THREE.BufferAttribute(this.pool.alpha,1));
    for(const attribute of Object.values(this.geometry.attributes))(attribute as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false,
      uniforms:{uPixelScale:{value:500},uTint:{value:new THREE.Color(.68,.78,.81)},uOccludingDepth:{value:null},uOccludingDepthReady:{value:0},uViewport:{value:new THREE.Vector2(1,1)}},
      vertexShader:/* glsl */`attribute float aSize,aAlpha;uniform float uPixelScale;varying float vAlpha;
        void main(){vec4 p=modelViewMatrix*vec4(position,1);vAlpha=aAlpha;
        gl_PointSize=clamp(aSize*uPixelScale/max(.2,-p.z),1.0,9.0);gl_Position=projectionMatrix*p;}`,
      fragmentShader:/* glsl */`uniform vec3 uTint;uniform sampler2D uOccludingDepth;uniform float uOccludingDepthReady;uniform vec2 uViewport;varying float vAlpha;
        void main(){vec2 q=gl_PointCoord*2.0-1.0;float r=dot(q,q);if(r>1.0||vAlpha<.001)discard;if(uOccludingDepthReady>.5&&texture2D(uOccludingDepth,gl_FragCoord.xy/uViewport).r<gl_FragCoord.z-.0000002)discard;
        gl_FragColor=vec4(uTint,vAlpha*exp(-r*3.5)*(1.0-smoothstep(.55,1.0,r)));}`});
    const points=new THREE.Points(this.geometry,this.material);points.frustumCulled=false;this.group.add(points);
  }
  private random():number{let x=this.randomState;x^=x<<13;x^=x>>>17;x^=x<<5;this.randomState=x;return (x>>>0)/4294967296;}
  setImpactSink(sink:typeof this.impactSink):void{
    this.impactSink=sink;
    if(this.lips instanceof ConnectedShoreBreakers)this.lips.pool.depositWater=sink?b=>{if(sink(b))this.whitewaterEmitted++;}:undefined;
  }
  resetHistory():void{this.generation++;this.previousPixels=null;this.previousTime=-Infinity;this.pixels=null;this.sampleTime=-Infinity;this.lastRequest=-Infinity;this.lastFrontSample=-Infinity;this.foamCacheValid=false;this.fronts=[];this.energizedCount=0;this.lips?.pool.clear();this.rollers?.pool.clear();this.pool.clear();}
  private emitConnectedFronts(time:number):void{
    if(!(this.lips instanceof ConnectedShoreBreakers)||!this.pixels||this.lastFrontSample===this.sampleTime)return;
    this.lastFrontSample=this.sampleTime;this.fronts=this.fronts.filter(f=>time-f.time<1.1);
    const grid=this.grid,step=this.span/grid,candidates:number[]=[];
    for(let cell=0;cell<grid*grid;cell++){
      const i=cell*4,depth=this.pixels[i+3]/255*8,height=(this.pixels[i]*256+this.pixels[i+1])/65535*16-8;
      // A compressed thin swash film over emergent sand is a bore, not a
      // detached curling sheet. Native SWE foam still covers that water.
      if(this.pixels[i+2]>20&&depth>.45&&depth<8&&height-depth> -4.2&&height-depth<=.15)candidates.push(cell);
    }
    candidates.sort((a,b)=>this.pixels![b*4+2]-this.pixels![a*4+2]);
    let emitted=0;
    for(const cell of candidates.slice(0,128)){
      const x=this.sampleOrigin.x+(cell%grid+.5-grid/2)*step,z=this.sampleOrigin.y+(Math.floor(cell/grid)+.5-grid/2)*step;
      if(this.fronts.some(f=>Math.abs((x-f.x)*f.nx+(z-f.z)*f.nz)<4+(time-f.time)*5&&Math.abs(-(x-f.x)*f.nz+(z-f.z)*f.nx)<f.halfWidth+3))continue;
      const nodes=traceBreakingFront(x,z,this.sampleFoam,this.random());if(nodes.length<3)continue;
      if(!this.lips.pool.emitFront(nodes,this.sampleFoam))break;
      const first=nodes[0],last=nodes[nodes.length-1];
      this.fronts.push({x:(first.x+last.x)*.5,z:(first.z+last.z)*.5,nx:first.nx,nz:first.nz,halfWidth:Math.hypot(last.x-first.x,last.z-first.z)*.5,time});
      if(++emitted>=2)break;
    }
  }
  update(time:number,delta:number,camera:THREE.Camera,uniforms:Uniforms):void{
    if(this.disposed)return;
    const GRID=this.grid,SPAN=this.span,step=SPAN/GRID,connected=this.lips instanceof ConnectedShoreBreakers;
    const underwater=Number(uniforms.uUnderwater?.value??0)>.5;
    this.group.visible=!underwater||connected;
    const points=this.group.children.find(object=>object instanceof THREE.Points);if(points)points.visible=!underwater;
    const viewport=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for(const material of [this.material,this.whitewater?.material,this.rollers?.material])if(material){
      material.uniforms.uOccludingDepth.value=uniforms.uSceneDepth?.value??null;
      material.uniforms.uOccludingDepthReady.value=uniforms.uSceneDepth?.value?1:0;
      material.uniforms.uViewport.value.copy(viewport);
    }
    if(this.whitewater)for(const key of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uSwell','uWind','uChoppiness','uShoreState','uShoreBounds','uShoreReady','uShoreResolution','uSunDirection','uSunColor','uHorizon'])
      if(uniforms[key]&&this.whitewater.material.uniforms[key])this.whitewater.material.uniforms[key]=uniforms[key];
    this.lips?.bind(uniforms);
    if(this.rollers)for(const [key,value] of Object.entries(uniforms))if(this.rollers.material.uniforms[key])this.rollers.material.uniforms[key]=value;
    if(!Number.isFinite(time)||!Number.isFinite(delta)||delta<=0)return;
    const start=performance.now(),dt=Math.min(delta,.05);
    this.simulationTime=time;this.foamCacheValid=!!this.pixels&&time-this.sampleTime<=.5&&time>=this.sampleTime;
    this.pool.advance(dt,this.impactSink?this.sampleFoam:undefined,this.impactSink?(x,height,z)=>{this.impactSink?.({x,z,height,energy:.035,nx:1,nz:0,seed:0,width:.12,speed:.2});}:undefined);
    this.whitewater?.update(delta,this.sampleFoam,underwater);
    this.rollers?.update(delta,this.sampleFoam,underwater);
    if(this.impactSink&&this.whitewater)this.whitewater.group.visible=false;
    if(this.lips){this.lips.update(delta,this.sampleFoam,b=>{
      if(this.impactSink?this.impactSink(b):this.whitewater?.pool.emit(b))this.whitewaterEmitted++;
      this.rollers?.pool.emit(b);
      // Landing, rather than old residual foam, launches a short impact fan.
      const strength=whitewaterAerationStrength(b.energy);
      const width='width' in b?Number(b.width):2.6,packets=8;
      const downward='impactSpeed' in b?Number(b.impactSpeed):1.5*strength;
      const contact=this.foamSample,hasFlow=this.sampleFoam(b.x,b.z,contact);
      const flowX=hasFlow?contact.flowX??b.nx*(.5+strength):b.nx*(.5+strength),flowZ=hasFlow?contact.flowZ??b.nz*(.5+strength):b.nz*(.5+strength);
      for(let j=0;j<packets;j++){
        const along=(j/Math.max(1,packets-1)-.5)*width,fan=(this.random()-.5)*downward*.36;
        if(this.pool.emit({x:b.x-b.nz*along,y:b.height+.04,z:b.z+b.nx*along,
          vx:flowX+b.nx*downward*.10-b.nz*fan,vy:.15+downward*(.18+this.random()*.12),vz:flowZ+b.nz*downward*.10+b.nx*fan,
          windX:OCEAN_PROPAGATION_DIRECTION.x*Number(uniforms.uWind?.value??0)*.10,windZ:OCEAN_PROPAGATION_DIRECTION.z*Number(uniforms.uWind?.value??0)*.10,drag:1.8,life:.35+this.random()*.4,size:.025+this.random()*.085,opacity:.42}))this.emitted++;
      }
    });}
    if(!underwater||connected){
      this.requestSample(time,camera,uniforms);
      const wind=Math.max(0,Math.min(35,Number(uniforms.uWind?.value??0)));
      if(!underwater&&this.pixels&&time-this.sampleTime<=.5&&time>=this.sampleTime){
        // Maximum 100 births per update; this bounds both CPU work and draw size.
        let births=0;
        for(let slot=0;slot<this.energizedCount&&births<100&&this.pool.active<this.pool.capacity;slot++){
          const cell=this.energizedCells[slot];
          const index=cell*4,x=this.sampleOrigin.x+(cell%GRID+.5-GRID/2)*SPAN/GRID;
          const z=this.sampleOrigin.y+(Math.floor(cell/GRID)+.5-GRID/2)*SPAN/GRID;
          const depth=this.pixels[index+3]/255*8,energy=this.pixels[index+2]/255;
          const distance=Math.hypot(camera.position.x-x,camera.position.z-z);
          const rate=sprayBirthRate(depth,energy,1,distance);
          if(rate<=0)continue;
          // A short crest event must have a chance to emit immediately. Requiring
          // a whole credit before a source switches off erased weak pulses.
          // Bernoulli sampling preserves expected rate and decorrelates cells.
          const cellBirths=sprayEmissionCount(rate,dt,this.random());
          for(let event=0;event<cellBirths&&births<100&&this.pool.active<this.pool.capacity;event++){
          // Local bathymetric uphill points onshore. Light droplets drag offshore.
          const gx=this.ground.heightAt(x+2,z)-this.ground.heightAt(x-2,z);
          const gz=this.ground.heightAt(x,z+2)-this.ground.heightAt(x,z-2);
          const norm=Math.hypot(gx,gz)||1,nx=gx/norm,nz=gz/norm;
          const strength=whitewaterAerationStrength(energy);
          const mist=this.random()<.78,speed=.6+this.random()*1.9;
          const along=(this.random()-.5)*3.6,across=(this.random()-.5)*.7;
          const bx=x-nz*along+nx*across,bz=z+nx*along+nz*across;
          // Recheck the jittered site's water contact; spray never starts over
          // dry ground merely because the centre of a six-metre cell was wet.
          const site=this.foamSample;
          if(!this.sampleFoam(bx,bz,site)||site.depth<.2||site.depth>4||site.ground>=site.height-.08||site.compression<=0)continue;
          const born=this.pool.emit({x:bx,y:site.height+(this.whitewater instanceof ShoreWhitewaterVolume ? .12+strength*.3 : .04),z:bz,vx:nx*speed+(this.random()-.5),vy:.8+this.random()*2.6*strength,vz:nz*speed+(this.random()-.5),
            windX:OCEAN_PROPAGATION_DIRECTION.x*wind*.12,windZ:OCEAN_PROPAGATION_DIRECTION.z*wind*.12,drag:mist?2.4:.6,life:mist?.35+this.random()*.45:.2+this.random()*.35,
            size:mist?.10+this.random()*.18:.012+this.random()*.028,opacity:mist?.12:.24});
          if(born){births++;this.emitted++;}
          }
        }
      }
      if(connected&&this.foamCacheValid)this.emitConnectedFronts(time);
      if(!connected&&(this.whitewater||this.lips)&&this.foamCacheValid){
        const birthPool=this.lips?.pool??this.whitewater!.pool;
        let count=0;
        for(let offset=0;offset<GRID*GRID&&count<24&&birthPool.active<birthPool.capacity;offset++){
          const cell=(offset+this.foamScanCursor)%(GRID*GRID);
          const x=this.sampleOrigin.x+(cell%GRID+.5-GRID/2)*step,z=this.sampleOrigin.y+(Math.floor(cell/GRID)+.5-GRID/2)*step;
          const s=this.foamSample;if(!this.sampleFoam(x,z,s))continue;
          const rate=whitewaterBirthRate(s);if(rate<=0)continue;
          if(this.random()>=Math.min(1,rate*dt))continue;
          const norm=Math.hypot(s.gradientX,s.gradientZ),seed=this.random(),along=(seed-.5)*4;
          const nx=s.gradientX/norm,nz=s.gradientZ/norm;
          // The coarse cache is Eulerian. Sample the actual wet field at a
          // subcell position rather than stamping parallel 6m birth rows.
          const across=this.whitewater instanceof ShoreWhitewaterVolume?(this.random()-.5)*5.4:0;
          const bx=x-nz*along+nx*across,bz=z+nx*along+nz*across;
          if(!this.sampleFoam(bx,bz,s)||whitewaterBirthRate(s)<=0)continue;
          const birth={x:bx,z:bz,height:s.height,energy:s.compression,nx,nz,seed};
          if(this.lips){if(this.lips.pool.emit(birth))count++;}
          else if(this.whitewater?.pool.emit(birth)){count++;this.whitewaterEmitted++;}
        }
        if(this.lips||this.whitewater instanceof ShoreWhitewaterVolume)this.foamScanCursor=(this.foamScanCursor+137)%(GRID*GRID);
      }
    }
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const perspective=camera as THREE.PerspectiveCamera;
    this.material.uniforms.uPixelScale.value=size.y/(2*Math.tan(THREE.MathUtils.degToRad(perspective.fov??62)/2));
    if(uniforms.uHorizon?.value){const tint=uniforms.uHorizon.value as THREE.Vector3;this.material.uniforms.uTint.value.setRGB(tint.x*.5+.3,tint.y*.5+.3,tint.z*.5+.3);}
    for(const attribute of Object.values(this.geometry.attributes))attribute.needsUpdate=true;
    this.updateMs=performance.now()-start;
  }
  private readbackDone:Promise<void>=Promise.resolve();
  async settleReadback():Promise<void>{await this.readbackDone;if(this.failed)throw new Error('Wave sample readback failed');}
  private requestSample(time:number,camera:THREE.Camera,uniforms:Uniforms):void{
    const GRID=this.grid,step=this.span/GRID;
    if(this.pending||this.failed||time-this.lastRequest<INTERVAL||!uniforms.uLongWaves?.value||!uniforms.uShortWaves?.value||!uniforms.uBathymetry?.value)return;
    this.lastRequest=time;this.pending=true;
    const generation=this.generation;
    const origin=new THREE.Vector2(Math.round(camera.position.x/step)*step,Math.round(camera.position.z/step)*step);
    for(const name of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uSwell','uWind','uChoppiness','uShoreState','uShoreBounds','uShoreReady','uShoreResolution','uMarineSurface','uMarineBounds','uMarineReady','uMarineResolution']){
      if(uniforms[name])this.sampleMaterial.uniforms[name].value=uniforms[name].value;
    }
    this.sampleMaterial.uniforms.uCenter.value.copy(origin);
    const previous=this.renderer.getRenderTarget();
    try{this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.sampleCamera);}
    catch{this.pending=false;this.failReadback();return;}
    finally{this.renderer.setRenderTarget(previous);}
    let readback:Promise<Uint8Array>;
    try{readback=this.renderer.readRenderTargetPixelsAsync(this.target,0,0,GRID,GRID*(this.flowReadback?2:1),new Uint8Array(GRID*GRID*4*(this.flowReadback?2:1))) as Promise<Uint8Array>;}
    catch{this.pending=false;this.failReadback();return;}
    this.readbackDone=readback.then(pixels=>{
      if(this.disposed||generation!==this.generation)return;
      if(!(pixels instanceof Uint8Array)||pixels.length!==GRID*GRID*4*(this.flowReadback?2:1))throw new Error('Invalid spray readback');
      if(this.flowReadback)for(let i=GRID*GRID*4+3;i<pixels.length;i+=4)if(pixels[i]!==137)throw new Error('Uninitialized flow framebuffer');
      // Black framebuffer is not a valid height field (zero height encodes 128,0).
      if(!pixels.some((value,i)=>i<GRID*GRID*4&&i%4<2&&value!==0))throw new Error('Uninitialized spray framebuffer');
      this.maxSampleEnergy=0;this.maxSampleCrest=0;this.maxEstimatedHeightDepthRatio=0;this.sampleEnergyPositiveCount=0;this.sampleWetEligibleCount=0;this.energizedCount=0;
      for(let i=0;i<GRID*GRID*4;i+=4){
        const height=(pixels[i]*256+pixels[i+1])/65535*16-8,depth=pixels[i+3]/255*8,energy=pixels[i+2]/255;
        this.maxSampleEnergy=Math.max(this.maxSampleEnergy,energy);this.maxSampleCrest=Math.max(this.maxSampleCrest,height);
        if(energy>0){this.sampleEnergyPositiveCount++;this.energizedCells[this.energizedCount++]=i/4;}
        if(depth>=.2&&depth<=3.8){this.sampleWetEligibleCount++;this.maxEstimatedHeightDepthRatio=Math.max(this.maxEstimatedHeightDepthRatio,Math.max(0,height)/depth);}
      }
      if(origin.distanceTo(this.sampleOrigin)>this.span){this.lips?.pool.clear();this.rollers?.pool.clear();this.fronts=[];}
      this.previousPixels=this.pixels;this.previousOrigin.copy(this.sampleOrigin);this.previousTime=this.sampleTime;
      this.pixels=pixels;this.sampleOrigin.copy(origin);this.sampleTime=time;
    }).catch(()=>{if(!this.disposed)this.failReadback();}).finally(()=>{this.pending=false;if(this.disposed)this.target.dispose();});
  }
  private failReadback():void{
    this.failed=true;this.previousPixels=null;this.pixels=null;this.foamCacheValid=false;
    this.energizedCount=0;
  }
  /** Developer observation of existing cached values, without a GPU request. */
  probeWhitewaterSites(){
    const pool=this.whitewater?.pool;if(!pool)return [];
    const sites=[];
    for(let i=0;i<pool.capacity&&sites.length<32;i++)if(pool.alpha[i]>.01){
      const x=pool.positions[i*3],y=pool.positions[i*3+1],z=pool.positions[i*3+2];
      const sample:WhitewaterSample={height:0,compression:0,depth:0,shelter:0,ground:0,gradientX:0,gradientZ:0};
      const valid=this.sampleFoam(x,z,sample),slope=Math.hypot(sample.gradientX,sample.gradientZ);
      sites.push({slot:i,seed:pool.seeds[i],x,y,z,alpha:pool.alpha[i],flowX:valid?sample.flowX??null:null,flowZ:valid?sample.flowZ??null:null,shorewardFlow:valid&&slope>1e-6&&sample.flowX!==undefined&&sample.flowZ!==undefined?(sample.flowX*sample.gradientX+sample.flowZ*sample.gradientZ)/slope:null});
    }return sites;
  }
  get diagnostics(){const GRID=this.grid;return {geometryAudit:this.lips instanceof ConnectedShoreBreakers?this.lips.pool.geometryAudit:null,frontAudit:this.lips instanceof ConnectedShoreBreakers?this.lips.pool.frontAudit.map(a=>({...a,nodes:a.nodes.map(n=>({...n}))})):[],sourceAudit:this.lips instanceof ConnectedShoreBreakers?this.lips.pool.sourceAudit.map(a=>({...a})):[],flightAudit:this.lips instanceof ConnectedShoreBreakers?this.lips.pool.flightAudit.map(a=>({...a})):[],connectedFronts:this.lips instanceof ConnectedShoreBreakers,frontEvents:this.lips instanceof ConnectedShoreBreakers?this.lips.pool.fronts:0,lipActive:this.lips?.pool.active??0,lipImpacts:this.lips?.pool.impacts??0,rollerActive:this.rollers?.pool.active??0,rollerCapacity:this.rollers?.pool.capacity??0,rollerTriangles:this.rollers?this.rollers.geometry.getAttribute('position').count/3*this.rollers.pool.capacity:0,active:this.pool.active,capacity:LIMIT,drawCalls:1+(this.whitewater&&!this.impactSink?1:0)+(this.lips?1:0)+(this.rollers?1:0),whitewaterActive:this.whitewater?.pool.active??0,whitewaterCapacity:this.whitewater?.pool.capacity??0,whitewaterTriangles:this.impactSink?0:this.whitewater instanceof ShoreWhitewaterVolume?this.whitewater.geometry.getAttribute('position').count/3*this.whitewater.pool.capacity:this.whitewater?49152:0,whitewaterMode:this.impactSink?'world-field':this.whitewater instanceof ShoreWhitewaterVolume?'volume':this.whitewater?'legacy':'off',whitewaterEmitted:this.whitewaterEmitted,maxSampleEnergy:this.maxSampleEnergy,maxSampleCrest:this.maxSampleCrest,maxEstimatedHeightDepthRatio:this.maxEstimatedHeightDepthRatio,sampleEnergyPositiveCount:this.sampleEnergyPositiveCount,sampleWetEligibleCount:this.sampleWetEligibleCount,samples:GRID*GRID,readbackBytes:GRID*GRID*4*(this.flowReadback?2:1),flowSamples:this.flowReadback?GRID*GRID:0,interval:INTERVAL,pending:this.pending,ready:!!this.pixels,failed:this.failed,emitted:this.emitted,updateMs:this.updateMs,birthProxyUnits:'Current SWE compression / FFT instantaneous dissipation; residual foam never starts a front',approximation:`${this.span/GRID}m / <=0.5s cache; connected wave-line sheets, not volume-conserving CFD; ground validity rechecked in marine field shader`};}
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    this.whitewater?.dispose();this.lips?.dispose();this.rollers?.dispose();
    this.geometry.dispose();this.material.dispose();this.quadGeometry.dispose();this.sampleMaterial.dispose();
    if(!this.pending)this.target.dispose();this.group.clear();this.scene.clear();this.previousPixels=null;this.pixels=null;
  }
}
