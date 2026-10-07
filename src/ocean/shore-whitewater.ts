import * as THREE from 'three';
import { shoreWaveSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { whitewaterAerationStrength } from './whitewater-flow.ts';
import { relaxWhitewaterVelocity } from './whitewater-flow.ts';

const LIMIT=1024;
export interface WhitewaterSample {height:number;compression:number;depth:number;shelter:number;ground:number;gradientX:number;gradientZ:number;waveGradientX?:number;waveGradientZ?:number;flowX?:number;flowZ?:number}
export type WhitewaterSampler=(x:number,z:number,out:WhitewaterSample)=>boolean;
export interface WhitewaterBirth {x:number;z:number;height:number;energy:number;nx:number;nz:number;seed:number}
/** Current birth proxy, never accumulated foam alpha. The SWE value is
 * compression times a 0.7s onset window, so .12 is not a universal strength
 * threshold. A 36m² cache cell supplies ~9 four-square-metre flocs per unit
 * birth proxy per second; persistence builds coverage downstream. */
export function whitewaterBirthRate(s:WhitewaterSample):number {
  if(!Object.values(s).every(Number.isFinite)||s.depth<.2||s.depth>3.8||s.shelter<.18||s.compression<=0||s.ground>=s.height-.08||Math.hypot(s.gradientX,s.gradientZ)<1e-6)return 0;
  return 9*Math.min(1,s.compression)*Math.min(1,s.shelter)*Math.min(1,(s.depth-.2)/.4)*Math.min(1,(3.8-s.depth)/1.2);
}

/** Transport follows solved signed swash flow, including offshore backwash.
 * FFT-only fallback retains the analytic shoreward drift. Surface height comes
 * from the shared coarse cache; this does not resolve overturning. */
export class WhitewaterPool {
  readonly positions:Float32Array;
  readonly shape:Float32Array;
  readonly alpha:Float32Array;
  readonly seeds:Float32Array;
  readonly capacity:number;
  active=0;
  private readonly births:(WhitewaterBirth|null)[];
  private readonly ages:Float64Array;
  private readonly transport:Float64Array;
  private readonly sample:WhitewaterSample={height:0,compression:0,depth:0,shelter:0,ground:0,gradientX:0,gradientZ:0};
  private cursor=0;
  private disposed=false;
  constructor(capacity=LIMIT){
    if(!Number.isInteger(capacity)||capacity<1||capacity>LIMIT)throw new Error('Invalid whitewater capacity');
    this.capacity=capacity;this.positions=new Float32Array(capacity*3);this.shape=new Float32Array(capacity*3);this.alpha=new Float32Array(capacity);this.seeds=new Float32Array(capacity);this.ages=new Float64Array(capacity);this.transport=new Float64Array(capacity*4);this.births=Array(capacity).fill(null);
  }
  emit(b:WhitewaterBirth):boolean {
    if(this.disposed||!Object.values(b).every(Number.isFinite)||Math.abs(b.x)>1e6||Math.abs(b.z)>1e6||Math.abs(b.height)>1e4||b.energy<=0||b.energy>1||Math.hypot(b.nx,b.nz)<.9||Math.hypot(b.nx,b.nz)>1.1||b.seed<0||b.seed>1)return false;
    for(let n=0;n<this.capacity;n++){
      const i=(n+this.cursor)%this.capacity;if(this.births[i])continue;
      this.births[i]={...b};this.ages[i]=0;this.seeds[i]=b.seed;this.positions.set([b.x,b.height+.025,b.z],i*3);
      this.transport.set([b.x,b.z,0,0],i*4);
      this.shape.set([1.2+b.seed*2.5,.22+whitewaterAerationStrength(b.energy)*.6,Math.atan2(b.nz,b.nx)+Math.PI/2],i*3);this.alpha[i]=0;this.active++;this.cursor=(i+1)%this.capacity;return true;
    }return false;
  }
  advance(delta:number,sampler:WhitewaterSampler):void {
    if(this.disposed||!Number.isFinite(delta)||delta<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const previousAge=this.ages[i],age=this.ages[i]+=delta,life=2.2+b.energy*3+b.seed*1.8;
      const s=this.sample,j=i*4;delete s.flowX;delete s.flowZ;
      if(age>=life||!sampler(this.transport[j],this.transport[j+1],s)||!Object.values(s).every(Number.isFinite)||s.depth<=0||s.depth>5||s.ground>=s.height-.015){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      if(s.flowX!==undefined&&s.flowZ!==undefined){
        const x=relaxWhitewaterVelocity(this.transport[j+2],THREE.MathUtils.clamp(s.flowX,-12,12),delta),z=relaxWhitewaterVelocity(this.transport[j+3],THREE.MathUtils.clamp(s.flowZ,-12,12),delta);
        this.transport[j]+=x.distance;this.transport[j+1]+=z.distance;this.transport[j+2]=x.velocity;this.transport[j+3]=z.velocity;
      }else{
        // Integrate from the current position. Losing a boundary sample must
        // not snap a returning strand back to its original onshore-only path.
        const speed=.45+b.energy*1.05,travel=speed*(Math.exp(-previousAge*.24)-Math.exp(-age*.24))/.24,along=(b.seed-.5)*.5*delta;
        this.transport[j]+=b.nx*travel-b.nz*along;this.transport[j+1]+=b.nz*travel+b.nx*along;
        this.transport[j+2]=b.nx*speed*Math.exp(-age*.24)-b.nz*(b.seed-.5)*.5;
        this.transport[j+3]=b.nz*speed*Math.exp(-age*.24)+b.nx*(b.seed-.5)*.5;
      }
      const x=this.transport[j],z=this.transport[j+1];delete s.flowX;delete s.flowZ;
      // Cache loss/out-of-range, grounded fragments and nonfinite terrain are
      // culled rather than left hovering. Shallow wet strands survive briefly.
      if(age>=life||!sampler(x,z,s)||!Object.values(s).every(Number.isFinite)||Math.abs(s.height)>1e4||s.depth<=0||s.depth>5||s.ground>=s.height-.015){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      this.positions.set([x,s.height+.025,z],i*3);
      this.shape[i*3]=(1.2+b.seed*2.5)*(1+age*.12);
      this.shape[i*3+1]=(.22+whitewaterAerationStrength(b.energy)*.6)*(1+age*.32);
      const wet=s.depth<.2?Math.min(1,s.depth/.2):1;
      // Dense aerated whitewater scatters strongly at birth; its holes and age
      // control coverage. A mist-like base opacity erased the surface ribbons.
      this.alpha[i]=(.72+b.energy*.25)*Math.min(1,age/.18)*Math.pow(1-age/life,.65)*wet;
    }
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.births.fill(null);this.alpha.fill(0);this.active=0;}
}

/** Fixed geometry, one draw and 2048 triangles; irregular perforated water-plane
 * fragments, not camera-facing mist cards. No per-frame geometry/texture creation. */
export class ShoreWhitewater {
  readonly group=new THREE.Group();
  readonly pool=new WhitewaterPool();
  readonly material:THREE.ShaderMaterial;
  private readonly geometry=new THREE.InstancedBufferGeometry();
  private disposed=false;
  constructor(){
    this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-.5,0,-.5,.5,0,-.5,.5,0,.5,-.5,0,.5]),3));
    this.geometry.setIndex([0,2,1,0,3,2]);
    for(const [name,array,size] of [['aCenter',this.pool.positions,3],['aShape',this.pool.shape,3],['aAlpha',this.pool.alpha,1],['aSeed',this.pool.seeds,1]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=this.pool.capacity;
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,
      uniforms:{...createShoreSolverUniforms(),uTint:{value:new THREE.Color(.78,.86,.86)},uOccludingDepth:{value:null},uOccludingDepthReady:{value:0},uViewport:{value:new THREE.Vector2(1,1)},
        uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}},
      vertexShader:`attribute vec3 aCenter,aShape;attribute float aAlpha,aSeed;varying vec2 vUv;varying float vAlpha,vSeed;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      vec2 foamCoast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 foamDisplacement(vec2 p){return (texture2D(uLongWaves,p/384.0).xyz+texture2D(uShortWaves,p/24.0).xyz)*uSwell*shoreWaveScale(foamCoast(p),uSwell,uWind);}
      void main(){vUv=position.xz+.5;vAlpha=aAlpha;vSeed=aSeed;if(aAlpha<.001){gl_Position=vec4(2,2,2,1);return;}
      vec2 q=position.xz*aShape.xy;float c=cos(aShape.z),s=sin(aShape.z);vec2 offset=vec2(q.x*c-q.y*s,q.x*s+q.y*c),world=aCenter.xz+offset,p=world;
      for(int i=0;i<3;i++)p=world-foamDisplacement(p).xz*uChoppiness;
      float height=shoreSolvedSurface(world,foamDisplacement(p).y,0.).x+.035;vec2 delta=world-cameraPosition.xz;height-=dot(delta,delta)/(2.0*6371000.0);
      gl_Position=projectionMatrix*viewMatrix*vec4(world.x,height,world.y,1);}`,
      fragmentShader:`uniform vec3 uTint;uniform sampler2D uOccludingDepth;uniform float uOccludingDepthReady;uniform vec2 uViewport;varying vec2 vUv;varying float vAlpha,vSeed;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+vSeed*137.)*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){if(vAlpha<.001)discard;if(uOccludingDepthReady>.5&&texture2D(uOccludingDepth,gl_FragCoord.xy/uViewport).r<gl_FragCoord.z-.0000002)discard;vec2 q=vUv*2.-1.;float edge=1.-smoothstep(.48,1.,length(q*vec2(.82,1.)));float coverageNoise=noise(vUv*vec2(13.,5.));float holes=smoothstep(.22,.62,coverageNoise);float a=vAlpha*edge*holes;if(a<.008)discard;gl_FragColor=vec4(uTint,a);}`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.group.add(mesh);
  }
  update(delta:number,sampler:WhitewaterSampler,underwater:boolean):void {
    if(this.disposed)return;this.group.visible=!underwater;this.pool.advance(delta,sampler);
    for(const name of ['aCenter','aShape','aAlpha','aSeed'])this.geometry.getAttribute(name).needsUpdate=true;
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.pool.dispose();this.geometry.dispose();this.material.dispose();this.group.clear();}
}

