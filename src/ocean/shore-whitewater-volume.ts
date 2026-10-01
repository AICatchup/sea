import * as THREE from 'three';
import { shoreWaveSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { type WhitewaterBirth, type WhitewaterSample, type WhitewaterSampler } from './shore-whitewater.ts';

export const VOLUME_CAPACITY=384;
const finite=(s:WhitewaterSample)=>Object.values(s).every(Number.isFinite);
/** A bounded aerated floc approximation. Energy determines collapse height;
 * cached surface slope supplies flow, rather than a free-running animation. */
export class WhitewaterVolumePool {
  readonly capacity:number;
  readonly positions:Float32Array;
  readonly shape:Float32Array;
  readonly motion:Float32Array;
  readonly alpha:Float32Array;
  readonly seeds:Float32Array;
  active=0;
  private births:(WhitewaterBirth|null)[];
  private ages:Float64Array;
  private cursor=0;
  private disposed=false;
  private sample:WhitewaterSample={height:0,compression:0,depth:0,shelter:0,ground:0,gradientX:0,gradientZ:0};
  constructor(capacity=VOLUME_CAPACITY){
    if(!Number.isInteger(capacity)||capacity<1||capacity>VOLUME_CAPACITY)throw new Error('Invalid volume capacity');
    this.capacity=capacity;this.positions=new Float32Array(capacity*3);this.shape=new Float32Array(capacity*4);this.motion=new Float32Array(capacity*2);this.alpha=new Float32Array(capacity);this.seeds=new Float32Array(capacity);this.births=Array(capacity).fill(null);this.ages=new Float64Array(capacity);
  }
  emit(b:WhitewaterBirth):boolean{
    if(this.disposed||!Object.values(b).every(Number.isFinite)||Math.abs(b.x)>1e6||Math.abs(b.z)>1e6||Math.abs(b.height)>1e4||b.energy<=.12||b.energy>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1||b.seed<0||b.seed>1)return false;
    for(let n=0;n<this.capacity;n++){
      const i=(this.cursor+n)%this.capacity;if(this.births[i])continue;
      this.births[i]={...b};this.ages[i]=0;this.seeds[i]=b.seed;
      this.positions[i*3]=b.x;this.positions[i*3+1]=b.height;this.positions[i*3+2]=b.z;
      this.shape[i*4]=2+2.6*b.seed;this.shape[i*4+1]=.12+.75*b.energy;this.shape[i*4+2]=.5+.9*b.energy;this.shape[i*4+3]=Math.atan2(b.nz,b.nx);
      this.alpha[i]=0;this.active++;this.cursor=(i+1)%this.capacity;return true;
    }return false;
  }
  advance(delta:number,sampler:WhitewaterSampler):void{
    if(this.disposed||!Number.isFinite(delta)||delta<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const age=this.ages[i]+=delta,life=2.4+b.energy*2.1+b.seed;
      const s=this.sample,x=this.positions[i*3],z=this.positions[i*3+2];
      if(age>=life||!sampler(x,z,s)||!finite(s)||Math.abs(s.height)>1e4||s.depth<=0||s.depth>4.6||s.shelter<.18||s.ground>=s.height-.015){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      // Finite-difference wave slope perturbs downhill rush. Birth direction
      // remains onshore; the 5 Hz cache cannot estimate a resolved velocity.
      const gx=s.waveGradientX??0,gz=s.waveGradientZ??0;
      const speed=(.55+b.energy*1.3)*Math.exp(-age*.4),dt=Math.min(delta,.1);
      this.positions[i*3]+=dt*(b.nx*speed-THREE.MathUtils.clamp(gx,-.5,.5)*.7);
      this.positions[i*3+2]+=dt*(b.nz*speed-THREE.MathUtils.clamp(gz,-.5,.5)*.7);
      this.positions[i*3+1]=s.height;
      const collapse=Math.exp(-age*1.05),remaining=1-age/life;
      this.shape[i*4]=(2+2.6*b.seed)*(1+age*.17);
      this.shape[i*4+1]=(.12+.75*b.energy)*collapse+.055*remaining;
      this.shape[i*4+2]=(.5+.9*b.energy)*(1+age*.42);
      this.motion[i*2]=(1-collapse)*2.3;this.motion[i*2+1]=age/life;
      this.alpha[i]=Math.min(1,age/.12)*Math.pow(remaining,.7)*Math.min(1,s.depth/.2)*(.78+.2*b.energy);
    }
  }
  dispose():void{this.disposed=true;this.births.fill(null);this.alpha.fill(0);this.active=0;}
}

/** Closed, non-spherical warped flocs: 80 triangles × 384, one draw. The
 * underside is submerged; the front rolls forward while height collapses. */
export function createWhitewaterVolumeGeometry():THREE.InstancedBufferGeometry{
  const source=new THREE.IcosahedronGeometry(1,1);
  const p=source.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const warp=1+.14*Math.sin(x*9+z*5)+.1*Math.cos(y*11-z*8);
    p.setXYZ(i,x*warp,y*warp,z*warp);
  }
  source.computeVertexNormals();
  const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',p.clone());geometry.setAttribute('normal',source.getAttribute('normal').clone());source.dispose();return geometry;
}
export class ShoreWhitewaterVolume {
  readonly group=new THREE.Group();
  readonly pool=new WhitewaterVolumePool();
  readonly geometry=createWhitewaterVolumeGeometry();
  readonly material:THREE.ShaderMaterial;
  private disposed=false;
  constructor(){
    for(const [name,array,size] of [['aCenter',this.pool.positions,3],['aShape',this.pool.shape,4],['aMotion',this.pool.motion,2],['aAlpha',this.pool.alpha,1],['aSeed',this.pool.seeds,1]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=this.pool.capacity;
    this.material=new THREE.ShaderMaterial({depthTest:true,depthWrite:true,transparent:false,side:THREE.FrontSide,
      uniforms:{...createShoreSolverUniforms(),uTint:{value:new THREE.Color(.82,.89,.88)},uSunDirection:{value:new THREE.Vector3(.4,.8,.3).normalize()},uSunColor:{value:new THREE.Vector3(1,1,.95)},uHorizon:{value:new THREE.Vector3(.55,.65,.75)},uOccludingDepth:{value:null},uOccludingDepthReady:{value:0},uViewport:{value:new THREE.Vector2(1,1)},uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}},
      vertexShader:`attribute vec3 aCenter;attribute vec4 aShape;attribute vec2 aMotion;attribute float aAlpha,aSeed;
      varying vec3 vLocal,vNormal;varying float vAlpha,vSeed,vAge,vWet;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      vec2 coastAt(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 displacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(coastAt(p),uSwell,uWind);}
      void main(){vAlpha=aAlpha;vSeed=aSeed;vAge=aMotion.y;vLocal=position;if(aAlpha<.001){gl_Position=vec4(2,2,2,1);return;}
      float roll=aMotion.x;float cr=cos(roll),sr=sin(roll);vec3 q=position;vec3 n=normal;
      q.xy=mat2(cr,sr,-sr,cr)*q.xy;n.xy=mat2(cr,sr,-sr,cr)*n.xy;
      // Local x is the forward collapse direction, z spans the breaker front.
      q*=vec3(aShape.z,aShape.y,aShape.x)*.5;q.y+=aShape.y*.28;
      float c=cos(aShape.w),s=sin(aShape.w);vec2 offset=vec2(q.x*c-q.z*s,q.x*s+q.z*c);vec2 world=aCenter.xz+offset,p=world;
      for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;
      vec2 coast=coastAt(world);float base=shoreSolvedSurface(world,displacement(p).y,0.).x;
      float height=base+q.y;
      vWet=min(base-coast.x,height-coast.x)*step(.18,coast.y)*step(-4.6,coast.x);
      vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
      n=normalize(n/vec3(aShape.z,aShape.y,aShape.x));vNormal=vec3(n.x*c-n.z*s,n.y,n.x*s+n.z*c);
      gl_Position=projectionMatrix*viewMatrix*vec4(world.x,height,world.y,1);}`,
      fragmentShader:`uniform vec3 uTint,uSunDirection,uSunColor,uHorizon;uniform sampler2D uOccludingDepth;uniform float uOccludingDepthReady;uniform vec2 uViewport;
      varying vec3 vLocal,vNormal;varying float vAlpha,vSeed,vAge,vWet;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7))+vSeed*137.)*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){if(vAlpha<.001||vWet<.02)discard;if(uOccludingDepthReady>.5&&texture2D(uOccludingDepth,gl_FragCoord.xy/uViewport).r<gl_FragCoord.z-.0000002)discard;
      float coarse=noise(vLocal*4.3);float fine=noise(vLocal*23.);float coverage=vAlpha*smoothstep(.18+vAge*.32,.65,coarse)*mix(.65,1.,fine);
      // Object-space binary coverage writes real depth: breakup reveals water
      // through holes and avoids a translucent fog shell as flocs age.
      if(hash(floor(vLocal*160.))>coverage)discard;
      vec3 n=normalize(vNormal);float sun=max(0.,dot(n,normalize(uSunDirection)));float cavity=.72+.28*coarse;
      vec3 color=uTint*(uHorizon*.36+uSunColor*(.22+.65*sun))*cavity;
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.group.add(mesh);
  }
  update(delta:number,sampler:WhitewaterSampler,underwater:boolean):void{if(this.disposed)return;this.group.visible=!underwater;this.pool.advance(delta,sampler);for(const name of ['aCenter','aShape','aMotion','aAlpha','aSeed'])this.geometry.getAttribute(name).needsUpdate=true;}
  dispose():void{if(this.disposed)return;this.disposed=true;this.pool.dispose();this.geometry.dispose();this.material.dispose();this.group.clear();}
}
