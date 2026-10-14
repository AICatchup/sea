import * as THREE from 'three';
import {CrestHistory,flyWaterParcel,type CrestEmission} from './breaker-parcels.ts';
import {oceanFragment} from './shaders.ts';
import {shoreWaveSampling} from './surface-detail.ts';
import {shoreSolverSampling} from './shore-solver.ts';
import {marineSurfaceSampling} from './marine-surface-field.ts';
import {whitewaterAerationStrength} from './whitewater-flow.ts';
import type {WhitewaterBirth,WhitewaterSample,WhitewaterSampler} from './shore-whitewater.ts';

export const BREAKER_FRONT_CAPACITY=24,BREAKER_FRONT_NODES=17;
export const SHEET_ROWS=145;
const SHEET_INTERVAL=1/60;
/** Optical thickness grows with the measured local crest-to-face drop. */
export function breakerLipThickness(drop:number,energy:number):number{
  return .06+.10*whitewaterAerationStrength(energy)+.20*Math.max(0,Math.min(3.5,drop)-.5);
}
/** Height-dependent sheet acceleration (Thuerey 2007, equation 9).
 * Authored gain 0.08; elevation is above mean sea level, not a remote trough.
 * This is the paper's visual closure, not a resolved 3D pressure field. */
export function breakerSheetSpeed(frontSpeed:number,elevation:number):number{
  return Math.min(24,Math.max(0,frontSpeed)*(1+.08*9.81*Math.max(0,elevation)));
}
/** Kinematic free-surface condition: w = dh/dt + u dot grad(h).
 * The measured Eulerian rate is optional while the cache warms up. A known
 * stationary surface must not inject the old constant upward impulse. */
export function breakerVerticalVelocity(s:WhitewaterSample,vx:number,vz:number):number{
  if(s.heightRate===undefined||!Number.isFinite(s.heightRate))return .4;
  const w=s.heightRate+vx*(s.waveGradientX??0)+vz*(s.waveGradientZ??0);
  return Number.isFinite(w)?THREE.MathUtils.clamp(w,-8,8):0;
}
/** Project predicted crest back onto the live surface (Thuerey et al., 2007).
 * A bounded search prevents a root from jumping to the following wave. */
export function trackBreakerRoot(x:number,z:number,nx:number,nz:number,sampler:WhitewaterSampler):{x:number;z:number;height:number}|null{
  const sample=sampleState();let best:{x:number;z:number;height:number}|null=null,score=-Infinity;
  for(let k=-4;k<=4;k++){
    const offset=k*.25,px=x+nx*offset,pz=z+nz*offset;
    if(!sampler(px,pz,sample)||!Number.isFinite(sample.height)||sample.depth<=.25||sample.depth>=8||sample.ground>.15)continue;
    const value=sample.height-.08*offset*offset;
    if(value>score){score=value;best={x:px,z:pz,height:sample.height};}
  }
  return best;
}
export interface BreakerImpact extends WhitewaterBirth {width:number;speed:number;eventId:number;impactSpeed:number;drop?:number;reach?:number}
type FrontNode=WhitewaterBirth&{up?:number;speed?:number;depth?:number;drop?:number;reach?:number};
const sampleState=():WhitewaterSample=>({height:0,compression:0,depth:0,shelter:1,ground:0,gradientX:0,gradientZ:0});
export function breakerRootSupport(surface:number,birthCrest:number):number{return birthCrest>.5?THREE.MathUtils.smoothstep(surface,birthCrest-.55,birthCrest-.12):1;}
function wet(s:WhitewaterSample,source=true):boolean{return [s.height,s.depth,s.ground,s.compression].every(Number.isFinite)&&s.depth>.45&&s.depth<8&&s.ground> -4.2&&s.ground<=.15&&s.ground<s.height-.08&&(!source||s.compression>.08);}

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
      // Compression marks the steep front, not necessarily the crest. Move
      // backward along propagation to the first local height maximum before
      // emitting a sheet (Thuerey et al., section 5). Do not require fresh
      // compression at that higher point: its front already supplied it.
      const frontX=best.x,frontZ=best.z;let peak=best.height,foundRise=false;
      for(let back=.5;back<=8;back+=.5){
        if(!sampler(frontX-nx*back,frontZ-nz*back,s)||!wet(s,false))break;
        if(s.height>peak+.01){peak=s.height;foundRise=true;best.x=frontX-nx*back;best.z=frontZ-nz*back;best.height=s.height;best.depth=s.depth;}
        else if(foundRise&&s.height<peak-.08)break;
      }
      // The crest's temporary water column can be twice its mean depth. Find
      // the lower face ahead, rather than making every big wave a tiny lip.
      let foot=best.height;
      for(let ahead=2;ahead<=8;ahead+=2)if(sampler(best.x+nx*ahead,best.z+nz*ahead,s)&&Number.isFinite(s.height)&&s.depth>.1&&s.ground<s.height-.08)foot=Math.min(foot,s.height);
      best.drop=Math.min(3.5,Math.max(.2,best.height-foot));best.reach=.6+best.drop*1.8;
      if(sampler(best.x,best.z,s)){
        const launch=breakerSheetSpeed(best.speed??2,best.height);
        best.up=breakerVerticalVelocity(s,nx*launch,nz*launch);
      }
      nodes.push(best);previousAcross=THREE.MathUtils.clamp(bestAcross,-4,4);
    }
    else if(nodes.length>=3)break;
  }
  return nodes.length>=3?nodes:[];
}

/** A front owns an ID and a common clock. Every node lands once, with local
 * surface variation. Completed parcels keep falling into water; fading must
 * not morph them into a flat surface while neighbours are still airborne. */
export class ConnectedBreakerPool {
  readonly roots=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*4);
  readonly tips=new Float32Array(this.roots.length);
  readonly shapes=new Float32Array(this.roots.length);
  readonly sheet=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*SHEET_ROWS*4);
  private readonly absorbed=new Uint8Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*SHEET_ROWS);
  private readonly emissionScratch:CrestEmission={time:0,x:0,y:0,z:0};
  private readonly parcelScratch={x:0,y:0,z:0,vy:0};
  private readonly histories=Array.from({length:BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES},()=>new CrestHistory());
  readonly visible=new Float32Array(BREAKER_FRONT_CAPACITY);
  readonly clock=new Float32Array(BREAKER_FRONT_CAPACITY);
  active=0;impacts=0;fronts=0;
  readonly flightAudit:{age:number;drop:number;launchHeight:number;landingHeight:number;flightDistance:number;sourceReleased:number}[]=[];
  releaseWater?: (p:{x:number;y:number;z:number;vx:number;vy:number;vz:number})=>void;
  private trackedSpeeds=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES);
  private trackedRoots=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*2);
  private released=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES).fill(-1);
  readonly capacity=BREAKER_FRONT_CAPACITY;
  private births:(FrontNode[]|null)[]=Array(BREAKER_FRONT_CAPACITY).fill(null);
  private ages=new Float64Array(BREAKER_FRONT_CAPACITY);
  private tipSeparated=new Uint8Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES);
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
        up:THREE.MathUtils.lerp(a.up??.4,b.up??.4,t),energy:THREE.MathUtils.lerp(a.energy,b.energy,t),nx:nx/n,nz:nz/n,seed:((Math.sin((j+1)*12.9898+a.seed*78.233)*43758.5453)%1+1)%1,depth:THREE.MathUtils.lerp(a.depth??1,b.depth??1,t),speed:THREE.MathUtils.lerp(a.speed??2,b.speed??2,t),drop:THREE.MathUtils.lerp(a.drop??.2,b.drop??.2,t),reach:THREE.MathUtils.lerp(a.reach??.6,b.reach??.6,t)});
    }
    this.absorbed.fill(0,slot*BREAKER_FRONT_NODES*SHEET_ROWS,(slot+1)*BREAKER_FRONT_NODES*SHEET_ROWS);
    this.births[slot]=nodes;this.ages[slot]=0;this.clock[slot]=0;this.visible[slot]=1;this.active++;this.eventIds[slot]=++this.fronts;
    for(let j=0;j<BREAKER_FRONT_NODES;j++){this.landed[slot*BREAKER_FRONT_NODES+j]=-1;this.tipSeparated[slot*BREAKER_FRONT_NODES+j]=0;this.released[slot*BREAKER_FRONT_NODES+j]=-1;const b=nodes[j],i=(slot*BREAKER_FRONT_NODES+j)*4;this.trackedSpeeds[slot*BREAKER_FRONT_NODES+j]=b.speed??2;const launch=breakerSheetSpeed(b.speed??2,b.height);this.histories[slot*BREAKER_FRONT_NODES+j].reset({time:0,x:b.x,y:b.height,z:b.z,vx:b.nx*launch,vz:b.nz*launch,up:b.up??.4});this.trackedRoots[(slot*BREAKER_FRONT_NODES+j)*2]=b.x;this.trackedRoots[(slot*BREAKER_FRONT_NODES+j)*2+1]=b.z;this.roots.set([b.x,b.height,b.z,0],i);this.tips.set([b.x,b.height,b.z,1],i);this.shapes.set([b.nx,b.nz,breakerLipThickness(b.drop??.2,b.energy)/Math.max(1,launch/(b.speed??2)),b.drop??.2],i);}
    return true;
  }
  advance(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    if(!Number.isFinite(dt)||dt<=0)return;
    for(let remaining=dt;remaining>1e-8&&this.active>0;){const step=Math.min(1/60,remaining);this.advanceStep(step,sampler,impact);remaining-=step;}
  }
  private advanceStep(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    for(let slot=0;slot<this.capacity;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      const age=this.ages[slot]+=dt;this.clock[slot]=age;let alive=0;
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const b=nodes[j],index=slot*BREAKER_FRONT_NODES+j,i=index*4;
        // A connected front shares physical time. Local surface/drop creates
        // peeling naturally; delaying clocks by column detached the root.
        const delay=0;
        const t=Math.max(0,age-delay),flight=t,phaseSpeed=b.speed??2;
        const predictedX=this.trackedRoots[index*2]+b.nx*phaseSpeed*dt,predictedZ=this.trackedRoots[index*2+1]+b.nz*phaseSpeed*dt;
        const tracked=trackBreakerRoot(predictedX,predictedZ,b.nx,b.nz,sampler);
        const follow=1-Math.exp(-10*dt);
        const rootX=predictedX+((tracked?.x??predictedX)-predictedX)*follow,rootZ=predictedZ+((tracked?.z??predictedZ)-predictedZ)*follow,s=this.sample;
        const measuredSpeed=((rootX-this.trackedRoots[index*2])*b.nx+(rootZ-this.trackedRoots[index*2+1])*b.nz)/dt;
        this.trackedSpeeds[index]+=(THREE.MathUtils.clamp(measuredSpeed,0,phaseSpeed*2)-this.trackedSpeeds[index])*(1-Math.exp(-dt/.15));
        this.trackedRoots[index*2]=rootX;this.trackedRoots[index*2+1]=rootZ;
        if(age>2.4||!sampler(rootX,rootZ,s)||s.depth<=.02||s.depth>8){this.roots[i+3]=0;continue;}
        const rootY=s.height,history=this.histories[index];

        const launchSpeed=breakerSheetSpeed(this.trackedSpeeds[index],rootY);
        const vx=b.nx*launchSpeed,vz=b.nz*launchSpeed,up=breakerVerticalVelocity(s,b.nx*launchSpeed,b.nz*launchSpeed);
        // Store velocity at emission. Later crest acceleration must neither
        // drag older parcels nor leave all rows using the birth phase speed.
        if(this.released[index]<0)history.record({time:age,x:rootX,y:rootY,z:rootZ,vx,vz,up});
        const emission=history.sample(age-flight,this.emissionScratch),launchHeight=emission.y;
        const endpoint=flyWaterParcel(emission,age,vx,vz,up,this.parcelScratch);
        const x=endpoint.x,z=endpoint.z;let tipY=endpoint.y;
        if(!sampler(x,z,s)||s.depth<=.02||s.depth>8||!Number.isFinite(s.height)){this.roots[i+3]=0;continue;}
        // Contact is a return from air, not merely a point inside the sea.
        // The old age gate reported a splash at 0.13s even when no water had
        // ever left the surface, and prematurely stopped feeding the crest.
        if(this.tipSeparated[index]===0){
          if(tipY>s.height+.025)this.tipSeparated[index]=1;
          else if(tipY<s.height-.025)this.tipSeparated[index]=2;
        }
        if(this.landed[index]<0&&this.tipSeparated[index]===1&&tipY<=s.height+.025){
          this.landed[index]=age;this.impacts++;
          this.flightAudit.push({age,drop:b.drop??0,launchHeight,landingHeight:s.height,flightDistance:Math.hypot(x-b.x,z-b.z),sourceReleased:this.released[index]});if(this.flightAudit.length>128)this.flightAudit.shift();
          const left=nodes[Math.max(0,j-1)],right=nodes[Math.min(BREAKER_FRONT_NODES-1,j+1)];
          impact({...b,x,z,height:s.height,width:Math.max(.18,Math.hypot(right.x-left.x,right.z-left.z)*.5),speed:phaseSpeed,drop:Math.max(0,launchHeight-s.height),reach:Math.max(.15,Math.hypot(x-b.x,z-b.z)-phaseSpeed*flight),eventId:this.eventIds[slot],impactSpeed:Math.min(12,Math.max(0,-endpoint.vy))});
        }
        const landed=this.landed[index];
        // Stop feeding a falling crest, but keep its emitted water in flight.
        // Spray carries a small breakup detail; it does not replace the sheet.
        if(this.released[index]<0&&landed<0&&t>.18&&rootY<launchHeight-.45){
          this.released[index]=age;
          for(let row=4;row<SHEET_ROWS;row+=4){
            const parcel=flyWaterParcel(history.sample(age-flight*row/(SHEET_ROWS-1),this.emissionScratch),age,vx,vz,up,this.parcelScratch);
            const parcelVx=this.emissionScratch.vx??vx,parcelVz=this.emissionScratch.vz??vz;
            if(sampler(parcel.x,parcel.z,s)&&parcel.y>s.height+.02)this.releaseWater?.({x:parcel.x,y:parcel.y,z:parcel.z,vx:parcelVx,vy:parcel.vy,vz:parcelVz});
          }
        }
        // First contact ends emission, not the flight of younger water.
        if(landed>=0&&this.released[index]<0)this.released[index]=age;
        const emissionEnd=this.released[index]<0?age:this.released[index];
        const ramp=Math.min(1,t/.12);let airborne=false;
        if(landed>=0)tipY=s.height;
        this.roots.set([rootX,rootY,rootZ,ramp],i);this.tips.set([x,tipY,z,this.released[index]<0?1:0],i);
        for(let row=0;row<SHEET_ROWS;row++){
          const emissionTime=row*SHEET_INTERVAL,exists=emissionTime<=emissionEnd+1e-8;
          const parcel=flyWaterParcel(history.sample(Math.min(emissionTime,emissionEnd),this.emissionScratch),age,vx,vz,up,this.parcelScratch);
          const k=((slot*BREAKER_FRONT_NODES+j)*SHEET_ROWS+row)*4;
          this.sheet[k]=parcel.x;this.sheet[k+1]=parcel.y;this.sheet[k+2]=parcel.z;this.sheet[k+3]=Math.max(0,-parcel.vy);
          const validSurface=exists&&sampler(this.sheet[k],this.sheet[k+2],s)&&Number.isFinite(s.height);
          // Every row is one fixed emission time shared by all columns.
          // contact is irreversible: falling sea level cannot resurrect water
          // already incorporated into the receiving surface.
          if(validSurface&&parcel.vy<0&&parcel.y<=s.height+.025)this.absorbed[k/4]=1;
          if(!exists||this.absorbed[k/4])this.sheet[k+3]=-1;
          else if(validSurface&&parcel.y>s.height+.025)airborne=true;
        }
        if(airborne||landed<0)alive++;else this.roots[i+3]=0;

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
    // Closed outer/inner faces and end caps give the falling lip actual volume.
    const base=new THREE.BoxGeometry(1,1,1,64,1,96);
    this.geometry.setIndex(base.index!.clone());this.geometry.setAttribute('position',base.getAttribute('position').clone());base.dispose();
    this.geometry.setAttribute('aSlot',new THREE.InstancedBufferAttribute(Float32Array.from({length:BREAKER_FRONT_CAPACITY},(_,i)=>i),1));
    this.geometry.setAttribute('aAge',new THREE.InstancedBufferAttribute(this.pool.clock,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aActive',new THREE.InstancedBufferAttribute(this.pool.visible,1).setUsage(THREE.DynamicDrawUsage));this.geometry.instanceCount=BREAKER_FRONT_CAPACITY;
    this.textures=[this.pool.roots,this.pool.tips,this.pool.shapes].map(data=>{const texture=new THREE.DataTexture(data,BREAKER_FRONT_NODES,BREAKER_FRONT_CAPACITY,THREE.RGBAFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;return texture;});
    const sheetTexture=new THREE.DataTexture(this.pool.sheet,BREAKER_FRONT_NODES*SHEET_ROWS,BREAKER_FRONT_CAPACITY,THREE.RGBAFormat,THREE.FloatType);
    sheetTexture.minFilter=sheetTexture.magFilter=THREE.NearestFilter;sheetTexture.needsUpdate=true;this.textures.push(sheetTexture);
    this.material=new THREE.ShaderMaterial({defines:{CURVED_SURFACE:1,CONNECTED_FRONT:1},side:THREE.DoubleSide,depthTest:true,depthWrite:true,uniforms:{uBehindWater:{value:null},uBehindWaterReady:{value:0},uFrontRoots:{value:this.textures[0]},uFrontTips:{value:this.textures[1]},uFrontShapes:{value:this.textures[2]},uFrontSheet:{value:this.textures[3]}},fragmentShader:oceanFragment,vertexShader:/* glsl */`
      attribute float aSlot,aActive,aAge;uniform sampler2D uFrontRoots,uFrontTips,uFrontShapes,uFrontSheet;
      varying vec3 vWorld;varying vec2 vOcean;varying float vDistance,vEnvelope,vLip,vWaterThickness;
      varying float vAeration;varying vec3 vSheetNormal;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${marineSurfaceSampling}
      vec2 lipCoast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 lipDisplacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(lipCoast(p),uSwell,uWind);}
      float lipSurface(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-lipDisplacement(p).xz*uChoppiness;return shoreSolvedSurface(world,lipDisplacement(p).y,0.).x+marineSurface(world).b;}
      vec4 frontValue(sampler2D source,float node){return texture2D(source,vec2((clamp(node,0.,16.)+.5)/17.,(aSlot+.5)/24.));}
      vec4 frontState(sampler2D source,float along){float node=along*16.,a=floor(node),t=fract(node);vec4 p0=frontValue(source,a-1.),p1=frontValue(source,a),p2=frontValue(source,a+1.),p3=frontValue(source,a+2.);return .5*((2.*p1)+(-p0+p2)*t+(2.*p0-5.*p1+4.*p2-p3)*t*t+(-p0+3.*p1-3.*p2+p3)*t*t*t);}
      vec4 sheetNode(float node,float row){return texture2D(uFrontSheet,vec2((clamp(node,0.,16.)*145.+clamp(row,0.,144.)+.5)/2465.,(aSlot+.5)/24.));}
      vec4 sheetRow(float node,float u){float r=clamp((1.-u)*aAge*60.,0.,144.);return mix(sheetNode(node,floor(r)),sheetNode(node,floor(r)+1.),fract(r));}
      float sheetCoverage(float along,float u){
        float r=clamp((1.-u)*aAge*60.,0.,144.),n=along*16.,a=floor(n),b=floor(r);
        float left=mix(step(0.,sheetNode(a,b).w),step(0.,sheetNode(a,b+1.).w),fract(r));
        float right=mix(step(0.,sheetNode(a+1.,b).w),step(0.,sheetNode(a+1.,b+1.).w),fract(r));
        return mix(left,right,fract(n));
      }
      vec4 parcelState(float along,float u){
        float n=along*16.,a=floor(n),t=fract(n);
        vec4 p0=sheetRow(a-1.,u),p1=sheetRow(a,u),p2=sheetRow(a+1.,u),p3=sheetRow(a+2.,u);
        return .5*((2.*p1)+(-p0+p2)*t+(2.*p0-5.*p1+4.*p2-p3)*t*t+(-p0+3.*p1-3.*p2+p3)*t*t*t);
      }
      void main(){
        if(aActive<.5){gl_Position=vec4(2,2,2,1);return;}
        float u=position.x+.5,along=position.z+.5;
        vec4 root=frontState(uFrontRoots,along),tip=frontState(uFrontTips,along),shape=frontState(uFrontShapes,along);shape.xy=normalize(shape.xy);
        float edge=smoothstep(0.,.12,along)*(1.-smoothstep(.88,1.,along));
        vEnvelope=clamp(root.w,0.,1.)*edge;vLip=u;
        // Entraining air follows the actual tip's fall below the crest.
        // A rising, still-transparent face is not painted white.
        float rootHeight=lipSurface(parcelState(along,0.).xz);
        vec2 rootCoast=lipCoast(root.xz);
        float support=1.;
        support*=(1.-smoothstep(-.2,.15,rootCoast.x))*smoothstep(.25,.5,rootHeight-rootCoast.x);vEnvelope*=support;
        // Small bores spill into the transported foam/roller field. A broad
        // lifted sheet there looked like a grey board instead of moving water.
        vEnvelope*=smoothstep(.35,.85,shape.w);
        // Temporal rows are emitted at the moving crest and retain their
        // own position/velocity under gravity. No arc is refitted to a tip.
        vec4 parcel=parcelState(along,u);
        vEnvelope*=sheetCoverage(along,u);
        vec4 originParcel=parcelState(along,0.);
        // Only newly emitted water remains attached to the source. Correcting
        // the entire sheet every GPU frame bent old airborne water sideways.
        parcel.y+=(rootHeight-originParcel.y)*(1.-smoothstep(0.,.10,u))*clamp(tip.w,0.,1.);
        vec4 previous=parcelState(along,max(0.,u-.03125)),next=parcelState(along,min(1.,u+.03125));
        vec2 tangent=vec2(dot(next.xz-previous.xz,shape.xy),next.y-previous.y);
        vec3 across=parcelState(min(1.,along+.0078125),u).xyz-parcelState(max(0.,along-.0078125),u).xyz;
        vec3 flightTangent=next.xyz-previous.xyz;
        vec3 smoothNormal=cross(across,flightTangent);
        vSheetNormal=length(smoothNormal)>.000001?normalize(smoothNormal):vec3(0.,1.,0.);
        vec2 sideNormal=normalize(vec2(-tangent.y,tangent.x)+vec2(0.,.00001));
        // Optical thickness must match the actual closed sheet, including its
        // pinched free edges. A constant optical path painted a dark rectangle
        // where the geometry had already narrowed to zero volume.
        float thickness=shape.z*sin(u*3.14159265)*edge;
        vWaterThickness=max(0.,thickness);
        parcel.xz+=shape.xy*sideNormal.x*position.y*thickness;
        parcel.y+=sideNormal.y*position.y*thickness;
        vAeration=clamp(parcel.w/6.,0.,1.);
        vec2 world=parcel.xz;float base=lipSurface(world);
        // Visibility is not a vertical displacement. Flattening a dying
        // column onto base joined airborne neighbours with rectangular walls.
        // Preserve its trajectory and let the fragment pass clip submerged water.
        float height=parcel.y;
        // Centimetre folds break up a smooth sheet without detaching its base.
        height+=(.018*sin(along*79.+aSlot*17.)+.012*sin(along*137.+u*23.))*sin(u*3.14159265)*vEnvelope;
        vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
        vWorld=vec3(world.x,height,world.y);vOcean=world;vDistance=length(cameraPosition-vWorld);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);
  }
  bind(uniforms:Record<string,THREE.IUniform>):void{for(const [name,value] of Object.entries(uniforms))this.material.uniforms[name]=value;}
  update(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{this.pool.advance(dt,sampler,impact);for(const texture of this.textures)texture.needsUpdate=true;this.geometry.getAttribute('aActive').needsUpdate=true;this.geometry.getAttribute('aAge').needsUpdate=true;}
  dispose():void{this.pool.clear();this.textures.forEach(t=>t.dispose());this.geometry.dispose();this.material.dispose();this.group.clear();}
}
