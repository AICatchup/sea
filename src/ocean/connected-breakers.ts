import * as THREE from 'three';
import {oceanFragment} from './shaders.ts';
import {shoreWaveSampling} from './surface-detail.ts';
import {shoreSolverSampling} from './shore-solver.ts';
import {marineSurfaceSampling} from './marine-surface-field.ts';
import {whitewaterAerationStrength} from './whitewater-flow.ts';
import type {WhitewaterBirth,WhitewaterSample,WhitewaterSampler} from './shore-whitewater.ts';

export const BREAKER_FRONT_CAPACITY=24,BREAKER_FRONT_NODES=17;
export interface BreakerImpact extends WhitewaterBirth {width:number;speed:number;eventId:number;impactSpeed:number;drop?:number;reach?:number}
type FrontNode=WhitewaterBirth&{speed?:number;depth?:number;drop?:number;reach?:number};
const sampleState=():WhitewaterSample=>({height:0,compression:0,depth:0,shelter:1,ground:0,gradientX:0,gradientZ:0});
export function breakerRootSupport(surface:number,birthCrest:number):number{return birthCrest>.5?THREE.MathUtils.smoothstep(surface,birthCrest-.55,birthCrest-.12):1;}
function wet(s:WhitewaterSample):boolean{return [s.height,s.depth,s.ground,s.compression].every(Number.isFinite)&&s.depth>.45&&s.depth<8&&s.ground> -4.2&&s.ground<=.15&&s.ground<s.height-.08&&s.compression>.08;}

/** Build one ordered, curved crest line. The high surface must face the flow;
 * residual foam is not a source. Up to two metres of gaps may be bridged, as
 * in wave-line detection, but dry gaps or a rising back face terminate it. */
export function traceBreakingFront(x:number,z:number,sampler:WhitewaterSampler,seed:number):FrontNode[]{
  const s=sampleState();if(!sampler(x,z,s)||!wet(s))return [];
  let nx=s.gradientX,nz=s.gradientZ,norm=Math.hypot(nx,nz);
  if(norm<1e-6){nx=s.flowX??1;nz=s.flowZ??0;norm=Math.hypot(nx,nz);}
  if(norm<1e-6)return [];nx/=norm;nz/=norm;
  if(s.flowX!==undefined&&s.flowZ!==undefined&&Math.hypot(s.flowX,s.flowZ)>.25){
    const f=Math.hypot(s.flowX,s.flowZ),fx=s.flowX/f,fz=s.flowZ/f;
    if(fx*nx+fz*nz>.25){nx=fx;nz=fz;}
  }
  const frontSlope=(s.waveGradientX??0)*nx+(s.waveGradientZ??0)*nz;
  if(frontSlope>.03)return [];
  const tangentX=-nz,tangentZ=nx;
  const nodes:FrontNode[]=[];
  let previousAcross=0;
  for(let column=-8;column<=8;column++){
    let best:FrontNode|null=null,bestScore=-Infinity,bestAcross=previousAcross;
    // A short cross-front search follows the actual wave crest rather than
    // extruding one straight beach-parallel strip through different waves.
    for(let offset=-2;offset<=2;offset++){
      const across=previousAcross+offset,px=x+tangentX*column*2+nx*across,pz=z+tangentZ*column*2+nz*across;
      if(!sampler(px,pz,s)||!wet(s))continue;
      const slope=(s.waveGradientX??0)*nx+(s.waveGradientZ??0)*nz;
      if(slope>.045)continue;
      const score=s.height+.3*s.compression-.04*Math.abs(offset);
      if(score>bestScore){bestScore=score;bestAcross=across;best={x:px,z:pz,height:s.height,energy:s.compression,nx,nz,seed,depth:s.depth,speed:Math.min(5.5,Math.max(1.2,Math.sqrt(9.81*s.depth)))};}
    }
    if(best){
      // The crest's temporary water column can be twice its mean depth. Find
      // the lower face ahead, rather than making every big wave a tiny lip.
      let foot=best.height;
      for(let ahead=2;ahead<=8;ahead+=2)if(sampler(best.x+nx*ahead,best.z+nz*ahead,s)&&Number.isFinite(s.height)&&s.depth>.1&&s.ground<s.height-.08)foot=Math.min(foot,s.height);
      best.drop=Math.min(2.8,Math.max(.2,best.height-foot));best.reach=.6+best.drop*1.8;
      nodes.push(best);previousAcross=THREE.MathUtils.clamp(bestAcross,-4,4);
    }
    else if(nodes.length>=3)break;
  }
  return nodes.length>=3?nodes:[];
}

/** A front owns an ID and a common clock. Every node lands once, with local
 * peel delays. Completed nodes collapse onto water; they are never sent out
 * of clip space while neighbouring triangles still use them. */
export class ConnectedBreakerPool {
  readonly roots=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*4);
  readonly tips=new Float32Array(this.roots.length);
  readonly shapes=new Float32Array(this.roots.length);
  readonly visible=new Float32Array(BREAKER_FRONT_CAPACITY);
  active=0;impacts=0;fronts=0;
  readonly capacity=BREAKER_FRONT_CAPACITY;
  private births:(FrontNode[]|null)[]=Array(BREAKER_FRONT_CAPACITY).fill(null);
  private ages=new Float64Array(BREAKER_FRONT_CAPACITY);
  private landed=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES).fill(-1);
  private eventIds=new Uint32Array(BREAKER_FRONT_CAPACITY);
  private readonly sample=sampleState();
  emit(b:WhitewaterBirth):boolean{
    return this.emitFront(Array.from({length:3},(_,i)=>({...b,x:b.x-b.nz*(i-1)*1.5,z:b.z+b.nx*(i-1)*1.5})));
  }
  emitFront(input:readonly FrontNode[]):boolean{
    if(input.length<3||input.length>BREAKER_FRONT_NODES||input.some(b=>!Object.values(b).every(Number.isFinite)||b.energy<=0||b.energy>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1))return false;
    const slot=this.births.indexOf(null);if(slot<0)return false;
    const nodes:FrontNode[]=[];
    for(let j=0;j<BREAKER_FRONT_NODES;j++){
      const f=j/(BREAKER_FRONT_NODES-1)*(input.length-1),k=Math.min(input.length-2,Math.floor(f)),t=f-k,a=input[k],b=input[k+1];
      const nx=THREE.MathUtils.lerp(a.nx,b.nx,t),nz=THREE.MathUtils.lerp(a.nz,b.nz,t),n=Math.hypot(nx,nz);
      nodes.push({x:THREE.MathUtils.lerp(a.x,b.x,t),z:THREE.MathUtils.lerp(a.z,b.z,t),height:THREE.MathUtils.lerp(a.height,b.height,t),
        energy:THREE.MathUtils.lerp(a.energy,b.energy,t),nx:nx/n,nz:nz/n,seed:a.seed,depth:THREE.MathUtils.lerp(a.depth??1,b.depth??1,t),speed:THREE.MathUtils.lerp(a.speed??2,b.speed??2,t),drop:THREE.MathUtils.lerp(a.drop??.2,b.drop??.2,t),reach:THREE.MathUtils.lerp(a.reach??.6,b.reach??.6,t)});
    }
    this.births[slot]=nodes;this.ages[slot]=0;this.visible[slot]=1;this.active++;this.eventIds[slot]=++this.fronts;
    for(let j=0;j<BREAKER_FRONT_NODES;j++){this.landed[slot*BREAKER_FRONT_NODES+j]=-1;const b=nodes[j],i=(slot*BREAKER_FRONT_NODES+j)*4;this.roots.set([b.x,b.height,b.z,0],i);this.tips.set([b.x,b.height,b.z,b.height],i);this.shapes.set([b.nx,b.nz,.06+.10*whitewaterAerationStrength(b.energy),b.drop??.2],i);}
    return true;
  }
  advance(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    if(!Number.isFinite(dt)||dt<=0)return;
    for(let slot=0;slot<this.capacity;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      const age=this.ages[slot]+=dt;let alive=0;
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const b=nodes[j],index=slot*BREAKER_FRONT_NODES+j,i=index*4;
        const delay=.035*j+.04*(1+Math.sin(j*.48+b.seed*6.2))+.045*(b.depth??1)/4;
        const t=Math.max(0,age-delay),flight=Math.max(0,t-.12),strength=whitewaterAerationStrength(b.energy),phaseSpeed=b.speed??2;
        const rootX=b.x+b.nx*phaseSpeed*t,rootZ=b.z+b.nz*phaseSpeed*t,s=this.sample;
        if(age>1.8||!sampler(rootX,rootZ,s)||s.depth<=.02||s.depth>8){this.roots[i+3]=0;continue;}
        const rootY=s.height,travel=(.1+(.8+1.5*strength+(b.reach??.6)*2)*flight)*Math.min(1,t/.12),x=rootX+b.nx*travel,z=rootZ+b.nz*travel;
        let tipY=b.height+.24+.60*strength+.4*flight-4.905*flight*flight;
        if(!sampler(x,z,s)||s.depth<=.02||s.depth>8||!Number.isFinite(s.height)){this.roots[i+3]=0;continue;}
        if(this.landed[index]<0&&t>.12&&tipY<=s.height+.025){
          this.landed[index]=age;this.impacts++;
          const left=nodes[Math.max(0,j-1)],right=nodes[Math.min(BREAKER_FRONT_NODES-1,j+1)];
          impact({...b,x,z,height:s.height,width:Math.max(.18,Math.hypot(right.x-left.x,right.z-left.z)*.5),speed:phaseSpeed,eventId:this.eventIds[slot],impactSpeed:Math.min(12,Math.max(0,9.81*flight-.4))});
        }
        const landed=this.landed[index],fade=landed<0?1:Math.max(0,1-(age-landed)/.16);
        if(fade<=0){this.roots[i+3]=0;continue;}alive++;
        // Once the crest beneath the root has fallen away, retire the sheet.
        // Keep its ballistic tip clock alive until contact still emits once.
        // Support is evaluated against CURRENT GPU water in the vertex shader,
        // not stepped in 5Hz CPU readbacks. The tip's W lane retains its birth
        // crest height; it no longer freezes the sheet's peak in world space.
        const ramp=Math.min(1,t/.12)*fade;
        if(landed>=0)tipY=s.height;
        this.roots.set([rootX,rootY,rootZ,ramp],i);this.tips.set([x,tipY,z,b.height],i);
      }
      if(!alive){this.births[slot]=null;this.visible[slot]=0;this.active--;for(let j=0;j<BREAKER_FRONT_NODES;j++)this.roots[(slot*BREAKER_FRONT_NODES+j)*4+3]=0;}
    }
  }
  clear():void{this.births.fill(null);this.visible.fill(0);this.roots.fill(0);this.active=0;}
}

export class ConnectedShoreBreakers {
  readonly group=new THREE.Group();readonly pool=new ConnectedBreakerPool();
  readonly material:THREE.ShaderMaterial;private readonly geometry=new THREE.InstancedBufferGeometry();
  private readonly textures:THREE.DataTexture[];
  constructor(){
    const base=new THREE.PlaneGeometry(1,1,32,48);base.rotateX(-Math.PI/2);
    this.geometry.setIndex(base.index!.clone());this.geometry.setAttribute('position',base.getAttribute('position').clone());base.dispose();
    this.geometry.setAttribute('aSlot',new THREE.InstancedBufferAttribute(Float32Array.from({length:BREAKER_FRONT_CAPACITY},(_,i)=>i),1));
    this.geometry.setAttribute('aActive',new THREE.InstancedBufferAttribute(this.pool.visible,1).setUsage(THREE.DynamicDrawUsage));this.geometry.instanceCount=BREAKER_FRONT_CAPACITY;
    this.textures=[this.pool.roots,this.pool.tips,this.pool.shapes].map(data=>{const texture=new THREE.DataTexture(data,BREAKER_FRONT_NODES,BREAKER_FRONT_CAPACITY,THREE.RGBAFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;return texture;});
    this.material=new THREE.ShaderMaterial({defines:{CURVED_SURFACE:1,CONNECTED_FRONT:1},side:THREE.DoubleSide,depthTest:true,depthWrite:true,uniforms:{uFrontRoots:{value:this.textures[0]},uFrontTips:{value:this.textures[1]},uFrontShapes:{value:this.textures[2]}},fragmentShader:oceanFragment,vertexShader:/* glsl */`
      attribute float aSlot,aActive;uniform sampler2D uFrontRoots,uFrontTips,uFrontShapes;
      varying vec3 vWorld;varying vec2 vOcean;varying float vDistance,vEnvelope,vLip,vWaterThickness;
      varying float vAeration;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${marineSurfaceSampling}
      vec2 lipCoast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 lipDisplacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(lipCoast(p),uSwell,uWind);}
      float lipSurface(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-lipDisplacement(p).xz*uChoppiness;return shoreSolvedSurface(world,lipDisplacement(p).y,0.).x+marineSurface(world).b;}
      vec4 frontState(sampler2D source,float along){float node=along*16.,a=floor(node),b=min(16.,a+1.);return mix(texture2D(source,vec2((a+.5)/17.,(aSlot+.5)/24.)),texture2D(source,vec2((b+.5)/17.,(aSlot+.5)/24.)),fract(node));}
      void main(){
        if(aActive<.5){gl_Position=vec4(2,2,2,1);return;}
        float u=position.x+.5,along=position.z+.5;
        vec4 root=frontState(uFrontRoots,along),tip=frontState(uFrontTips,along),shape=frontState(uFrontShapes,along);shape.xy=normalize(shape.xy);
        float edge=smoothstep(0.,.12,along)*(1.-smoothstep(.88,1.,along));
        vEnvelope=root.w*edge;vLip=u;vWaterThickness=shape.z;
        // Entraining air follows the actual tip's fall below the crest.
        // A rising, still-transparent face is not painted white.
        float d=length(tip.xz-root.xz),v=1.-u,rootHeight=lipSurface(root.xz);
        vec2 rootCoast=lipCoast(root.xz);
        float support=tip.w>.5?smoothstep(tip.w-.55,tip.w-.12,rootHeight):1.;
        support*=(1.-smoothstep(-.2,.15,rootCoast.x))*smoothstep(.25,.5,rootHeight-rootCoast.x);vEnvelope*=support;
        float strength=clamp((shape.z-.06)/.10,0.,1.);
        // Small bores spill into the transported foam/roller field. A broad
        // lifted sheet there looked like a grey board instead of moving water.
        vEnvelope*=smoothstep(.35,.85,shape.w);
        float radius=min(1.15,min(shape.w*.5+.12*strength,max(.12,rootHeight-rootCoast.x)*.32));
        float peak=rootHeight+radius;
        vAeration=clamp((peak-tip.y-.08)/max(.35,peak-rootHeight+.35),0.,1.);
        // A circular upper section genuinely rolls beyond vertical. Only the
        // short falling end stretches to its tracked ballistic contact point.
        float angle=1.2+2.65*smoothstep(0.,max(.1,radius*2.),peak-tip.y),theta=u*angle;
        vec2 section=vec2(radius*(1.-cos(theta)),rootHeight+radius*sin(theta));
        vec2 end=vec2(radius*(1.-cos(angle)),rootHeight+radius*sin(angle));
        float tail=smoothstep(.93,1.,u);section+=(vec2(d,tip.y)-end)*tail*tail;
        vec2 world=root.xz+shape.xy*section.x;float base=lipSurface(world);
        // On contact, collapse every point onto its OWN rendered surface.
        // Lerp toward the root's height left a hanging curtain on slopes.
        float height=mix(base,section.y,vEnvelope);
        // Centimetre folds break up a smooth sheet without detaching its base.
        height+=(.018*sin(along*79.+aSlot*17.)+.012*sin(along*137.+u*23.))*sin(u*3.14159265)*vEnvelope;
        vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
        vWorld=vec3(world.x,height,world.y);vOcean=world;vDistance=length(cameraPosition-vWorld);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);
  }
  bind(uniforms:Record<string,THREE.IUniform>):void{for(const [name,value] of Object.entries(uniforms))this.material.uniforms[name]=value;}
  update(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{this.pool.advance(dt,sampler,impact);for(const texture of this.textures)texture.needsUpdate=true;this.geometry.getAttribute('aActive').needsUpdate=true;}
  dispose():void{this.pool.clear();this.textures.forEach(t=>t.dispose());this.geometry.dispose();this.material.dispose();this.group.clear();}
}
