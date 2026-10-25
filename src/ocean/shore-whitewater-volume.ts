import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import { shoreWaveSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { type WhitewaterBirth, type WhitewaterSample, type WhitewaterSampler } from './shore-whitewater.ts';
import { relaxWhitewaterVelocity, whitewaterAerationStrength } from './whitewater-flow.ts';
import { whitewaterPoreGLSL } from './whitewater-pores.ts';
import {marineSurfaceSampling} from './marine-surface-field.ts';
import {foamAppearanceGLSL} from './foam-appearance.ts';
import {impactFrothGLSL} from './impact-froth.ts';

export const VOLUME_CAPACITY=384;
const finite=(s:WhitewaterSample)=>Object.values(s).every(Number.isFinite);
/** Bounded aerated flocs: collapse into spreading remnants and advect with
 * cached SWE flow. FFT-only fallback is a labelled slope/drift approximation. */
export class WhitewaterVolumePool {
  readonly capacity:number;
  readonly positions:Float32Array;
  readonly shape:Float32Array;
  readonly motion:Float32Array;
  readonly alpha:Float32Array;
  readonly seeds:Float32Array;
  readonly transferred:Float32Array;
  private mass:Float64Array;
  private quiet:Float64Array;
  transferredVolume=0;
  active=0;
  private births:((WhitewaterBirth&{width?:number;speed?:number;drop?:number;reach?:number})|null)[];
  private readonly impactsOnly:boolean;
  private ages:Float64Array;
  private velocity:Float64Array;
  private cursor=0;
  private disposed=false;
  private sample:WhitewaterSample={height:0,compression:0,depth:0,shelter:0,ground:0,gradientX:0,gradientZ:0};
  constructor(capacity=VOLUME_CAPACITY,impactsOnly=false){
    if(!Number.isInteger(capacity)||capacity<1||capacity>VOLUME_CAPACITY)throw new Error('Invalid volume capacity');
    this.impactsOnly=impactsOnly;this.capacity=capacity;this.positions=new Float32Array(capacity*3);this.shape=new Float32Array(capacity*4);this.motion=new Float32Array(capacity*2);this.alpha=new Float32Array(capacity);this.seeds=new Float32Array(capacity);this.births=Array(capacity).fill(null);this.ages=new Float64Array(capacity);this.velocity=new Float64Array(capacity*2);
    this.transferred=new Float32Array(capacity);this.mass=new Float64Array(capacity);this.quiet=new Float64Array(capacity);
  }
  emit(b:WhitewaterBirth&{width?:number;speed?:number;drop?:number;reach?:number}):boolean{
    if(this.disposed||!Object.values(b).every(Number.isFinite)||Math.abs(b.x)>1e6||Math.abs(b.z)>1e6||Math.abs(b.height)>1e4||b.energy<=0||b.energy>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1||b.seed<0||b.seed>1)return false;
    for(let n=0;n<this.capacity;n++){
      const i=(this.cursor+n)%this.capacity;if(this.births[i])continue;
      this.births[i]={...b};this.ages[i]=0;this.seeds[i]=b.seed;
      this.transferred[i]=0;this.mass[i]=0;this.quiet[i]=0;
      this.velocity[i*2]=this.impactsOnly?b.nx*(b.speed??2)*.55:0;this.velocity[i*2+1]=this.impactsOnly?b.nz*(b.speed??2)*.55:0;
      this.positions[i*3]=b.x;this.positions[i*3+1]=b.height;this.positions[i*3+2]=b.z;
      const strength=whitewaterAerationStrength(b.energy);
      this.shape[i*4]=this.impactsOnly?Math.min(2.8,Math.max(.35,b.width??1.5)):3.2+2.8*b.seed;this.shape[i*4+1]=this.impactsOnly?.08+.65*strength+.22*(b.drop??0):.06+.85*strength;this.shape[i*4+2]=this.impactsOnly?.65+.13*(b.speed??2)+.35*(b.reach??0):1.2+1.1*strength;this.shape[i*4+3]=Math.atan2(b.nz,b.nx);
      this.alpha[i]=0;this.active++;this.cursor=(i+1)%this.capacity;return true;
    }return false;
  }
  /** Continuous landing-water flux feeds existing advected froth, not a new
   * opaque shell for every simulation step. Volume is the sheet's m3 proxy;
   * expansion is an authored aeration closure, not a pressure-resolved fluid. */
  deposit(b:WhitewaterBirth&{width?:number;speed?:number;volume?:number;impactSpeed?:number}):boolean{
    if(this.disposed||!this.impactsOnly||!Number.isFinite(b.volume)||b.volume!<=0||b.volume!>100||!Object.values(b).every(Number.isFinite)||Math.abs(b.x)>1e6||Math.abs(b.z)>1e6||Math.abs(b.height)>1e4||b.energy<=0||b.energy>1||b.seed<0||b.seed>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1)return false;
    const volume=Math.min(3,b.volume!),width=Math.min(2.8,Math.max(.6,b.width??1));
    for(let i=0;i<this.capacity;i++){
      const old=this.births[i];if(!old||!this.transferred[i])continue;
      if(old.nx*b.nx+old.nz*b.nz<.7||Math.hypot(this.positions[i*3]-b.x,this.positions[i*3+2]-b.z)>Math.max(.7,width*.6))continue;
      const weight=volume/(this.mass[i]+volume);
      this.positions[i*3]+=(b.x-this.positions[i*3])*weight;
      this.positions[i*3+2]+=(b.z-this.positions[i*3+2])*weight;
      old.energy+=(b.energy-old.energy)*weight;
      this.mass[i]=Math.min(3,this.mass[i]+volume);this.quiet[i]=0;this.transferredVolume+=volume;
      return true;
    }
    if(!this.emit({...b,width,drop:Math.min(3.5,Math.pow(b.impactSpeed??1,2)/(2*9.81))}))return false;
    const index=(this.cursor+this.capacity-1)%this.capacity;
    this.transferred[index]=1;this.mass[index]=volume;this.quiet[index]=0;this.transferredVolume+=volume;
    return true;
  }
  advance(delta:number,sampler:WhitewaterSampler):void{
    if(this.disposed||!Number.isFinite(delta)||delta<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const plunge=Math.max(0,Math.min(3.5,b.drop??0)-.5);
      const previousAge=this.ages[i],age=this.ages[i]+=delta,strength=whitewaterAerationStrength(b.energy),life=this.transferred[i]?8:this.impactsOnly?1.15+strength*.9+plunge*.45:6+b.energy*4+b.seed*2;
      const s=this.sample,x=this.positions[i*3],z=this.positions[i*3+2];
      if((!this.transferred[i]&&age>=life)||!sampler(x,z,s)||!finite(s)||Math.abs(s.height)>1e4||s.depth<=0||s.depth>(this.impactsOnly?8:4.6)||s.shelter<.18||s.ground>=s.height-.015){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      // Use the solved flow when available: a retreating swash carries the
      // existing foam seaward instead of spawning another stationary white row.
      const gx=s.waveGradientX??0,gz=s.waveGradientZ??0;
      if(s.flowX!==undefined&&s.flowZ!==undefined){
        const flowX=relaxWhitewaterVelocity(this.velocity[i*2],THREE.MathUtils.clamp(s.flowX,-12,12),delta);
        const flowZ=relaxWhitewaterVelocity(this.velocity[i*2+1],THREE.MathUtils.clamp(s.flowZ,-12,12),delta);
        this.positions[i*3]+=flowX.distance;this.positions[i*3+2]+=flowZ.distance;
        this.velocity[i*2]=flowX.velocity;this.velocity[i*2+1]=flowZ.velocity;
      }else{
        // FFT-only fallback remains explicitly heuristic; integrate its decay
        // exactly so frame partitioning does not change the onshore distance.
        const travel=(.55+b.energy*1.3)*(Math.exp(-previousAge*.4)-Math.exp(-age*.4))/.4;
        this.positions[i*3]+=b.nx*travel-THREE.MathUtils.clamp(gx,-.5,.5)*.7*delta;
        this.positions[i*3+2]+=b.nz*travel-THREE.MathUtils.clamp(gz,-.5,.5)*.7*delta;
      }
      if(!sampler(this.positions[i*3],this.positions[i*3+2],s)||!finite(s)||s.depth<=0||s.ground>=s.height-.015){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      this.positions[i*3+1]=s.height;
      const collapse=Math.exp(-age*1.05),remaining=Math.max(0,1-age/life);
      this.shape[i*4]=(this.impactsOnly?Math.min(2.8,Math.max(.35,b.width??1.5)):3.2+2.8*b.seed)*(1+age*.10);
      this.shape[i*4+1]=this.impactsOnly?Math.min(s.depth*.35,(.08+.65*strength+.22*(b.drop??0))*collapse+.025*remaining):(.06+.85*strength)*collapse+.055*remaining;
      // A plunging impact first blooms upward, then loses height. Its impulse
      // scales with local fall distance rather than inflating every small wave.
      if(this.impactsOnly&&plunge>0){
        const bloom=(1-Math.exp(-age*9))*Math.exp(-age*1.35);
        this.shape[i*4+1]=Math.min(s.depth*.65,this.shape[i*4+1]+plunge*1.15*bloom);
      }
      this.shape[i*4+2]=(this.impactsOnly?.65+.13*(b.speed??2)+.35*(b.reach??0):1.2+1.1*strength)*(1+age*.38);
      this.motion[i*2]=(1-collapse)*(this.impactsOnly?1.5:.8);this.motion[i*2+1]=age/life;
      // Spread transports the same finite amount of aeration over more area.
      // Without dilution the collapsed floc becomes a growing opaque plate.
      const areaGrowth=(1+age*.10)*(1+age*.38);
      this.alpha[i]=Math.min(1,age/(this.impactsOnly?.045:.12))*Math.pow(remaining,.7)*Math.min(1,s.depth/.2)*(.78+.2*b.energy)/areaGrowth;
      if(this.transferred[i]){
        this.quiet[i]+=delta;this.mass[i]*=Math.exp(-delta*1.35);
        const quiet=this.quiet[i],span=Math.min(2.8,Math.max(.6,b.width??1));
        const length=(.65+.10*(b.speed??2))*(1+quiet*.55);
        this.shape[i*4]=span*(1+quiet*.18);this.shape[i*4+2]=length;
        const area=this.shape[i*4]*length;
        // Finite entrained volume loses density while spreading. Fresh landed
        // water replenishes it; old residual foam cannot create new thickness.
        // The resolved receiving wave already owns the bulk water elevation.
        // Aeration adds a thin turbulent layer, not another metre-high wave.
        this.shape[i*4+1]=Math.min(s.depth*.55,.45,6*this.mass[i]*(1+2*strength)/(Math.PI*area));
        this.motion[i*2]=(1-Math.exp(-age*1.8))*1.5;
        this.motion[i*2+1]=Math.min(1,quiet/2.8);
        this.alpha[i]=(1-Math.exp(-this.mass[i]*7/area))*Math.min(1,age/.06);
        if(this.mass[i]<.0005||quiet>5){this.births[i]=null;this.alpha[i]=0;this.active--;}
      }
    }
  }
  clear():void{this.births.fill(null);this.alpha.fill(0);this.mass.fill(0);this.quiet.fill(0);this.transferred.fill(0);this.transferredVolume=0;this.active=0;}
  dispose():void{this.disposed=true;this.births.fill(null);this.alpha.fill(0);this.active=0;}
}

/** Closed, non-spherical warped flocs: 80 triangles × 384, one draw. The
 * underside is submerged; the front rolls forward while height collapses. */
export function createWhitewaterVolumeGeometry(detail=1):THREE.InstancedBufferGeometry{
  const source=new THREE.IcosahedronGeometry(1,detail);
  const p=source.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const warp=1+.055*Math.sin(x*5+z*3)+.035*Math.cos(y*6-z*4);
    p.setXYZ(i,x*warp,y*warp,z*warp);
  }
  // IcosahedronGeometry is non-indexed. Computing normals on it directly
  // gives each triangle a separate face normal, making foam look like rocks.
  // Weld positions before computing normals, then retain the fixed draw layout.
  source.deleteAttribute('normal');source.deleteAttribute('uv');
  const welded=mergeVertices(source);welded.computeVertexNormals();
  const smooth=welded.toNonIndexed();
  const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',smooth.getAttribute('position').clone());geometry.setAttribute('normal',smooth.getAttribute('normal').clone());source.dispose();welded.dispose();smooth.dispose();return geometry;
}
/** Disconnected three-dimensional foam flocs, not the skin of one large
 * transparent shell. 32 small polyhedra use 640 triangles per impact packet,
 * below the old 720-triangle shell. Smooth radial normals avoid stone facets. */
export function createImpactFoamGeometry():THREE.InstancedBufferGeometry{
  const source=new THREE.IcosahedronGeometry(1,0),p=source.getAttribute('position');
  const positions=new Float32Array(p.count*32*3),normals=new Float32Array(positions.length);
  const radical=(index:number,base:number)=>{let value=0,f=1/base;for(;index;index=Math.floor(index/base)){value+=(index%base)*f;f/=base;}return value;};
  for(let floc=0;floc<32;floc++){
    const angle=radical(floc+1,2)*Math.PI*2,r=Math.sqrt(radical(floc+1,3))*.76;
    const cx=Math.cos(angle)*r,cz=Math.sin(angle)*r;
    const cy=(-.35+.94*radical(floc+1,5))*(1-r*r),radius=.17+.06*radical(floc+1,7);
    for(let v=0;v<p.count;v++){
      const x=p.getX(v),y=p.getY(v),z=p.getZ(v),k=(floc*p.count+v)*3;
      positions.set([cx+x*radius,cy+y*radius,cz+z*radius],k);
      normals.set([x,y,z],k);
    }
  }
  source.dispose();const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));return geometry;
}
export class ShoreWhitewaterVolume {
  readonly group=new THREE.Group();
  readonly pool:WhitewaterVolumePool;
  readonly geometry:THREE.InstancedBufferGeometry;
  readonly material:THREE.ShaderMaterial;
  private disposed=false;
  constructor(impactsOnly=false){
    const densityTrial=impactsOnly&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('frothvolume')==='1';
    this.pool=new WhitewaterVolumePool(impactsOnly?256:VOLUME_CAPACITY,impactsOnly);this.geometry=impactsOnly?(densityTrial?createWhitewaterVolumeGeometry(5):createImpactFoamGeometry()):createWhitewaterVolumeGeometry(3);
    for(const [name,array,size] of [['aCenter',this.pool.positions,3],['aShape',this.pool.shape,4],['aMotion',this.pool.motion,2],['aAlpha',this.pool.alpha,1],['aSeed',this.pool.seeds,1],['aTransferred',this.pool.transferred,1]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=this.pool.capacity;
    this.material=new THREE.ShaderMaterial({depthTest:true,depthWrite:false,transparent:true,side:THREE.FrontSide,
      uniforms:{...createShoreSolverUniforms(),uImpact:{value:impactsOnly?1:0},uFrothVolume:{value:impactsOnly && typeof location!=='undefined' && new URLSearchParams(location.search).get('frothvolume')==='1'?1:0},uFoamStructure:{value:1},uVolumeTransfer:{value:1},uFoamAtlas:{value:null},uFoamAtlasReady:{value:0},uFoamClock:{value:0},uMarineSurface:{value:null},uMarineBounds:{value:new THREE.Vector4()},uMarineReady:{value:0},uMarineResolution:{value:256},uTint:{value:new THREE.Color(.91,.96,.95)},uSunDirection:{value:new THREE.Vector3(.4,.8,.3).normalize()},uSunColor:{value:new THREE.Vector3(1,1,.95)},uHorizon:{value:new THREE.Vector3(.55,.65,.75)},uOccludingDepth:{value:null},uOccludingDepthReady:{value:0},uViewport:{value:new THREE.Vector2(1,1)},uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}},
      vertexShader:`uniform float uImpact,uFrothVolume,uVolumeTransfer;attribute float aTransferred;varying vec3 vFrothCenter,vFrothRadii;varying vec2 vFrothAxis,vFrothSlope;attribute vec3 aCenter;attribute vec4 aShape;attribute vec2 aMotion;attribute float aAlpha,aSeed;
      varying vec3 vLocal,vNormal,vFoamWorld;varying vec2 vWorld;varying float vAlpha,vSeed,vAge,vWet,vClearance;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${marineSurfaceSampling}
      vec2 coastAt(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 displacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(coastAt(p),uSwell,uWind);}
      float surfaceHeight(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;return shoreSolvedSurface(world,displacement(p).y,0.).x+marineSurface(world).b;}
      void main(){vAlpha=aAlpha*mix(1.,uVolumeTransfer,aTransferred);vSeed=aSeed;vAge=aMotion.y;vLocal=position;if(aAlpha<.001){gl_Position=vec4(2,2,2,1);return;}
      float roll=aMotion.x;float cr=cos(roll),sr=sin(roll);vec3 q=position;vec3 n=normal;
      // Each crest fragment has a different fold and height along its front.
      // The inverse-transpose updates lighting for this actual deformation.
      float phase=aSeed*6.2831853;
      float fold=.18*sin(q.z*5.+phase),foldSlope=.9*cos(q.z*5.+phase);
      q.x+=fold;n.z-=foldSlope*n.x;
      float ridge=.78+.22*sin(q.z*7.+phase),ridgeSlope=1.54*cos(q.z*7.+phase);
      n.z-=n.y*q.y*ridgeSlope/ridge;n.y/=ridge;q.y*=ridge;
      q.xy=mat2(cr,sr,-sr,cr)*q.xy;n.xy=mat2(cr,sr,-sr,cr)*n.xy;
      if(uImpact>.5&&uFrothVolume<.5){
        // Each packet contains actual separate flocs. Its seed rotates the
        // constellation; mass/area controls height as the packet disperses.
        q=position;n=normal;mat2 turn=mat2(cos(phase),sin(phase),-sin(phase),cos(phase));
        q.xz=turn*q.xz;n.xz=turn*n.xz;
      }
      // Impact geometry only bounds density; folds belong inside the volume.
      if(uFrothVolume>.5){q=position;n=normal;}
      // Local x is the forward collapse direction, z spans the breaker front.
      q*=vec3(aShape.z,aShape.y,aShape.x)*.5;q.y+=aShape.y*.28;
      float c=cos(aShape.w),s=sin(aShape.w);vec2 offset=vec2(q.x*c-q.z*s,q.x*s+q.z*c);vec2 world=aCenter.xz+offset,p=world;vWorld=world;
      for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;
      vec2 coast=coastAt(world);float base=shoreSolvedSurface(world,displacement(p).y,0.).x+marineSurface(world).b;
      float centerBase=surfaceHeight(aCenter.xz);
      // Advected surface froth follows the receiving surface pointwise. The
      // former 30cm clamp left flat corners suspended above a steep wave.
      float height=(uFrothVolume>.5?centerBase:base)+q.y;
      vClearance=height-base;
      vWet=min(base-coast.x,height-coast.x)*step(.18,coast.y)*step(-4.6,coast.x);
      vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
      n=normalize(n/vec3(aShape.z,aShape.y,aShape.x));vNormal=vec3(n.x*c-n.z*s,n.y,n.x*s+n.z*c);
      // Inverse transpose of y -> y + surfaceHeight(x,z), including the
      // shared solved surface rather than lighting a flat undeformed floc.
      const float slopeStep=.75;
      vec2 slope=vec2(surfaceHeight(world+vec2(slopeStep,0))-surfaceHeight(world-vec2(slopeStep,0)),surfaceHeight(world+vec2(0,slopeStep))-surfaceHeight(world-vec2(0,slopeStep)))/(2.*slopeStep);
      slope-=horizon/6371000.;vNormal.xz-=slope*vNormal.y;
      vFrothRadii=vec3(aShape.z,aShape.y,aShape.x)*.5;
      vFrothCenter=vec3(aCenter.x,centerBase+aShape.y*.28-dot(horizon,horizon)/(2.*6371000.),aCenter.z);
      vFrothAxis=vec2(c,s);vFrothSlope=slope;
      vFoamWorld=vec3(world.x,height,world.y);
      gl_Position=projectionMatrix*viewMatrix*vec4(world.x,height,world.y,1);}`,
      fragmentShader:`uniform vec3 uTint,uSunDirection,uSunColor,uHorizon;uniform sampler2D uOccludingDepth;uniform float uOccludingDepthReady,uImpact,uFrothVolume,uFoamStructure;uniform vec2 uViewport;
      varying vec3 vLocal,vNormal,vFoamWorld;varying vec2 vWorld;varying float vAlpha,vSeed,vAge,vWet,vClearance;
      ${whitewaterPoreGLSL}
      ${foamAppearanceGLSL}
      ${impactFrothGLSL}
      void main(){if(vAlpha<.001||vWet<.02)discard;if(uOccludingDepthReady>.5&&texture2D(uOccludingDepth,gl_FragCoord.xy/uViewport).r<gl_FragCoord.z-.0000002)discard;
      if(uFrothVolume>.5){
        gl_FragColor=impactFroth();
        if(gl_FragColor.a<.003)discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }
      // Shared world-metric channels keep a hole open through ALL overlapping
      // flocs. Seed affects only macro geometry, never the pore phase.
      // This stationary Eulerian field is an authored coverage closure; the
      // volume centres still advect with SWE. It is not a material foam tracer.
      FoamAppearance froth=FoamAppearance(.5,1.,normalize(vNormal));
      if(uFoamAtlasReady>.5)froth=foamAppearance(vFoamWorld,normalize(vNormal),length(fwidth(vWorld)));
      float pore=uImpact>.5&&uFoamAtlasReady>.5?froth.field:whitewaterPore(vWorld);
      float footprint=length(fwidth(vWorld));
      float poreResolved=1.-smoothstep(.20,.65,footprint);
      float threshold=whitewaterPoreThreshold(vAlpha,vAge);
      threshold-=uImpact*.12*(1.-smoothstep(.12,.42,vAge));
      // Subpixel channels become their aggregate coverage, preventing glitter.
      float effectivePore=mix(.5,pore,poreResolved);
      // Erode the perimeter as well as the internal channels. This avoids a
      // clean ellipsoid rim surviving after the roller has flattened.
      float edge=1.-smoothstep(.45,1.02,length(vLocal.xz));
      float erosion=mix(0.,.16,smoothstep(.18,.85,vAge));
      // Coverage fades as a cloud of bubbles, rather than cutting large
      // hard-edged holes through a flattening opaque shell.
      float coverage=smoothstep(threshold+erosion-.18,threshold+erosion+.20,effectivePore)*vAlpha;
      coverage*=smoothstep(0.,.30,edge);
      // Submerged flocs dissolve into the surface aeration field. Fade before
      // the depth intersection exposes individual water-mesh triangles.
      coverage*=smoothstep(.015,.20,vClearance);
      if(coverage<.005)discard;
      float cavityNoise=whitewaterNoise(vWorld*2.6);
      float resolved=1.-smoothstep(.035,.12,footprint);
      float fine=mix(.5,whitewaterNoise(vWorld*18.),resolved);
      vec2 bump=vec2(whitewaterNoise((vWorld+vec2(.025,0))*18.)-whitewaterNoise((vWorld-vec2(.025,0))*18.),whitewaterNoise((vWorld+vec2(0,.025))*18.)-whitewaterNoise((vWorld-vec2(0,.025))*18.));
      vec3 n=uFoamAtlasReady>.5?froth.normal:normalize(vNormal+vec3(bump.x,0,bump.y)*.32*resolved);
      if(uFoamAtlasReady>.5&&uFoamStructure>.5)n=normalize(n+vec3(bump.x,0,bump.y)*.24*resolved);
      float sun=max(0.,dot(n,normalize(uSunDirection)));
      // Lambert's albedo/pi applies to incident sunlight. The previous .22
      // constant direct term lit cavities even when sun incidence was zero.
      vec3 irradiance=uHorizon*(.18+.32*max(0.,n.y))+uSunColor*(sun/3.14159265);
      float cavity=mix(.38+.62*cavityNoise,.68+.32*cavityNoise,uImpact);
      float bubbles=.65+.35*fine;
      vec3 color=uTint*irradiance*cavity*bubbles;
      if(uFoamAtlasReady>.5)color=uTint*irradiance*froth.tone;
      // Photo coverage and three-dimensional lighting are complementary.
      // Keep wet recesses and fine bubble shading after loading the atlas.
      if(uFoamAtlasReady>.5&&uFoamStructure>.5)color*=cavity*(.88+.12*fine);
      if(uImpact>.5){
        // A small aerated floc scatters light through many bubbles; it is not
        // a Lambert-lit stone with a hard polygon silhouette. The optical
        // path tends to zero at its rim, softening the same bounded geometry.
        vec3 sight=normalize(cameraPosition-vFoamWorld);
        coverage*=smoothstep(.03,.65,max(0.,dot(normalize(vNormal),sight)));
        vec3 scatter=uHorizon*(.30+.22*max(0.,n.y))+uSunColor*(.18+.22*sun);
        color=uTint*scatter*(.9+.1*cavityNoise)*(.92+.08*fine);
        if(uFoamAtlasReady>.5)color*=.9+.1*froth.tone;
      }
      gl_FragColor=vec4(color,coverage*.72);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.group.add(mesh);
  }
  update(delta:number,sampler:WhitewaterSampler,underwater:boolean):void{if(this.disposed)return;this.group.visible=!underwater;this.pool.advance(delta,sampler);for(const name of ['aCenter','aShape','aMotion','aAlpha','aSeed','aTransferred'])this.geometry.getAttribute(name).needsUpdate=true;}
  dispose():void{if(this.disposed)return;this.disposed=true;this.pool.dispose();this.geometry.dispose();this.material.dispose();this.group.clear();}
}
