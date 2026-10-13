import * as THREE from 'three';
import { oceanFragment } from './shaders.ts';
import { shoreWaveSampling } from './surface-detail.ts';
import { shoreSolverSampling } from './shore-solver.ts';
import { type WhitewaterBirth, type WhitewaterSample, type WhitewaterSampler } from './shore-whitewater.ts';
import { whitewaterAerationStrength } from './whitewater-flow.ts';

export const LIP_CAPACITY=96;
/** A detached lip has its own ballistic clock. Impact is a one-shot event;
 * current surface foam cannot create another lip. This is a bounded visual
 * water-sheet approximation, not a volume-conserving fluid solver. */
export class BreakingLipPool {
  readonly roots:Float32Array;
  readonly tips:Float32Array;
  readonly shapes:Float32Array;
  active=0;impacts=0;
  private births:(WhitewaterBirth|null)[];
  private ages:Float64Array;
  private sample:WhitewaterSample={height:0,compression:0,depth:0,shelter:0,ground:0,gradientX:0,gradientZ:0};
  readonly capacity:number;
  constructor(capacity=LIP_CAPACITY){
    this.capacity=capacity;
    if(!Number.isInteger(capacity)||capacity<1||capacity>LIP_CAPACITY)throw Error('Invalid lip capacity');
    this.roots=new Float32Array(capacity*4);this.tips=new Float32Array(capacity*4);this.shapes=new Float32Array(capacity*4);
    this.births=Array(capacity).fill(null);this.ages=new Float64Array(capacity);
  }
  emit(b:WhitewaterBirth):boolean{
    if(!Object.values(b).every(Number.isFinite)||b.energy<=0||b.energy>1||b.seed<0||b.seed>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1)return false;
    const i=this.births.indexOf(null);if(i<0)return false;
    this.births[i]={...b};this.ages[i]=0;this.active++;
    this.roots.set([b.x,b.height,b.z,0],i*4);this.tips.set([b.x,b.height,b.z,0],i*4);
    this.shapes.set([b.nx,b.nz,2.4+2*b.seed,b.seed],i*4);return true;
  }
  advance(dt:number,sample:WhitewaterSampler,impact:(b:WhitewaterBirth)=>void):void{
    if(!Number.isFinite(dt)||dt<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const t=this.ages[i]+=dt,j=i*4,s=this.sample,strength=whitewaterAerationStrength(b.energy);
      const rise=.18+.65*strength,speed=.7+1.8*strength,flight=Math.max(0,t-.12);
      const travel=.2+speed*flight,x=b.x+b.nx*travel,z=b.z+b.nz*travel;
      const y=b.height+rise+.35*flight-4.905*flight*flight;
      if(t>1.2||!sample(x,z,s)||![s.height,s.depth,s.ground].every(Number.isFinite)||s.depth<=.02||s.depth>5||s.ground>=y){this.retire(i);continue;}
      if(t>.12&&y<=s.height+.025){
        this.retire(i);this.impacts++;
        impact({...b,x,z,height:s.height});continue;
      }
      // The shoulder joins the current source surface. Tip motion never snaps
      // to a later crest. Birth ramps the displacement rather than alpha popping.
      const ramp=Math.min(1,t/.12),targetY=y;
      if(!sample(b.x,b.z,s)||s.depth<=.02||!Number.isFinite(s.height)){this.retire(i);continue;}
      this.roots.set([b.x,s.height,b.z,ramp],j);
      this.tips.set([x,s.height+(targetY-s.height)*ramp,z,b.height+rise],j);
    }
  }
  private retire(i:number):void{this.births[i]=null;this.roots[i*4+3]=0;this.active--;}
  clear():void{this.births.fill(null);this.roots.fill(0);this.active=0;}
}

export class ShoreBreakingLips {
  readonly group=new THREE.Group();readonly pool=new BreakingLipPool();
  readonly material:THREE.ShaderMaterial;private geometry=new THREE.InstancedBufferGeometry();
  constructor(){
    const base=new THREE.PlaneGeometry(1,2,24,12);base.rotateX(-Math.PI/2);
    this.geometry.index=base.index!.clone();this.geometry.setAttribute('position',base.getAttribute('position').clone());base.dispose();
    for(const [name,array] of [['aRoot',this.pool.roots],['aTip',this.pool.tips],['aShape',this.pool.shapes]] as const)this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount=LIP_CAPACITY;
    this.material=new THREE.ShaderMaterial({defines:{CURVED_SURFACE:1},side:THREE.DoubleSide,depthTest:true,depthWrite:true,uniforms:{},fragmentShader:oceanFragment,
      vertexShader:`attribute vec4 aRoot,aTip,aShape;
      varying vec3 vWorld;varying vec2 vOcean;varying float vDistance,vEnvelope,vLip,vWaterThickness;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      vec2 lipCoast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 lipDisplacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(lipCoast(p),uSwell,uWind);}
      float lipSurface(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-lipDisplacement(p).xz*uChoppiness;return shoreSolvedSurface(world,lipDisplacement(p).y,0.).x;}
      void main(){
        float u=position.x+.5,z=position.z,edge=1.-smoothstep(.65,1.,abs(z));
        vEnvelope=aRoot.w*edge;vLip=u;vWaterThickness=.045;
        if(aRoot.w<.006){gl_Position=vec4(2,2,2,1);return;}
        vec2 n=aShape.xy,tangent=vec2(-n.y,n.x);
        float distanceTip=length(aTip.xz-aRoot.xz),peak=max(aRoot.y+.04,aTip.w);
        // Cubic shoulder -> projecting tongue -> gravity-driven falling tip.
        vec2 p0=vec2(0,aRoot.y),p1=vec2(distanceTip*.08,peak),p2=vec2(distanceTip*1.25,peak),p3=vec2(distanceTip,aTip.y);
        float v=1.-u;vec2 section=v*v*v*p0+3.*v*v*u*p1+3.*v*u*u*p2+u*u*u*p3;
        vec2 world=aRoot.xz+n*section.x+tangent*z*aShape.z*.5;
        float irregular=.025*sin(z*8.+aShape.w*17.)*sin(u*3.14159265)*aRoot.w;
        float height=mix(aRoot.y,section.y,edge)+irregular;
        height+=(lipSurface(aRoot.xz+tangent*z*aShape.z*.5)-aRoot.y)*(1.-u);
        vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
        vWorld=vec3(world.x,height,world.y);vOcean=world;vDistance=length(cameraPosition-vWorld);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);
  }
  bind(uniforms:Record<string,THREE.IUniform>):void{for(const [key,value] of Object.entries(uniforms))this.material.uniforms[key]=value;}
  update(dt:number,sampler:WhitewaterSampler,impact:(b:WhitewaterBirth)=>void):void{
    this.pool.advance(dt,sampler,impact);
    for(const key of ['aRoot','aTip','aShape'])this.geometry.getAttribute(key).needsUpdate=true;
  }
  dispose():void{this.pool.clear();this.geometry.dispose();this.material.dispose();this.group.clear();}
}
