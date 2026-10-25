import * as THREE from 'three';
import {CrestHistory,flyWaterParcel,type CrestEmission} from './breaker-parcels.ts';
import {CREST_ATTACHMENT_SECONDS,crestAttachmentGLSL} from './breaker-attachment.ts';
import {oceanFragment} from './shaders.ts';
import {shoreWaveSampling} from './surface-detail.ts';
import {shoreSolverSampling} from './shore-solver.ts';
import {marineSurfaceSampling} from './marine-surface-field.ts';
import {whitewaterAerationStrength} from './whitewater-flow.ts';
import {plungingTakeoff} from './breaker-takeoff.ts';
import {BreakerProfiles,BREAKER_PROFILE_LIMIT} from './breaker-profile.ts';
import type {WhitewaterBirth,WhitewaterSample,WhitewaterSampler} from './shore-whitewater.ts';

export const BREAKER_FRONT_CAPACITY=24,BREAKER_FRONT_NODES=17;
export const SHEET_ROWS=193;
const SHEET_INTERVAL=1/60;
/** Optical thickness grows with the measured local crest-to-face drop. */
export function breakerLipThickness(drop:number,energy:number):number{
  return .06+.10*whitewaterAerationStrength(energy)+.20*Math.max(0,Math.min(3.5,drop)-.5);
}
/** Empirical wave-line closure (not a pressure solve). Bound excess speed
 * in the moving front frame, using the measured crest-to-face drop. The old
 * world-frame kinetic cap prevented even a 3m translating wave from lifting
 * water off its crest. Absolute height above sea level is not available head. */
export function breakerSheetSpeed(frontSpeed:number,drop:number):number{
  if(![frontSpeed,drop].every(Number.isFinite))return 0;
  const phase=Math.max(0,frontSpeed),head=9.81*Math.max(0,Math.min(3.5,drop));
  return Math.min(24,phase+Math.min(phase*.05*head,Math.sqrt(2*head)));
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
/** Track the steep descending face separately from the emission crest.
 * Thuerey 2007 sections 4 and 5 distinguish these two locations. */
export function trackBreakerFace(x:number,z:number,nx:number,nz:number,sampler:WhitewaterSampler):{x:number;z:number;height:number}|null{
  const s=sampleState();let best:{x:number;z:number;height:number}|null=null,score=-Infinity;
  for(let k=-4;k<=4;k++){
    const offset=k*.25,px=x+nx*offset,pz=z+nz*offset;
    if(!sampler(px,pz,s)||!wet(s,false))continue;
    const steep=-((s.waveGradientX??0)*nx+(s.waveGradientZ??0)*nz);
    if(steep<.02)continue;
    const value=steep-.005*offset*offset;
    if(value>score){score=value;best={x:px,z:pz,height:s.height};}
  }
  return best;
}
export function emissionCrest(x:number,z:number,nx:number,nz:number,sampler:WhitewaterSampler):{x:number;z:number;height:number}|null{
  const s=sampleState();if(!sampler(x,z,s)||!wet(s,false))return null;
  const peak={x,z,height:s.height};let foundRise=false;
  for(let back=.5;back<=8;back+=.5){
    const px=x-nx*back,pz=z-nz*back;
    if(!sampler(px,pz,s)||!wet(s,false))break;
    if(s.height>peak.height){peak.x=px;peak.z=pz;peak.height=s.height;foundRise=true;}
    else if(foundRise&&s.height<peak.height-.08)break;
  }
  // Refine the sampled maximum within its half-metre bracket. Snapping the
  // emission origin to whole samples makes successive material rows jump.
  const step=.5;
  if(sampler(peak.x-nx*step,peak.z-nz*step,s)&&wet(s,false)){
    const left=s.height;
    if(sampler(peak.x+nx*step,peak.z+nz*step,s)&&wet(s,false)){
      const right=s.height,curvature=left-2*peak.height+right;
      if(curvature<-.00001){
        const offset=THREE.MathUtils.clamp(.5*(left-right)/curvature,-.5,.5)*step;
        const px=peak.x+nx*offset,pz=peak.z+nz*offset;
        if(sampler(px,pz,s)&&wet(s,false)){peak.x=px;peak.z=pz;peak.height=s.height;}
      }
    }
  }
  return peak;
}
export interface BreakerImpact extends WhitewaterBirth {width:number;speed:number;eventId:number;impactSpeed:number;drop?:number;reach?:number;volume?:number}
type FrontNode=WhitewaterBirth&{frontX?:number;frontZ?:number;up?:number;speed?:number;depth?:number;drop?:number;reach?:number;frontSlope?:number};
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
      const score=Math.max(0,-slope)*4+.3*s.compression-.04*Math.abs(offset);
      if(score>bestScore){bestScore=score;bestAcross=across;best={x:px,z:pz,height:s.height,energy:s.compression,nx,nz,seed,depth:s.depth,frontSlope:Math.max(0,-slope),speed:Math.min(8.5,Math.max(1.2,Math.sqrt(9.81*s.depth)))};}
    }
    if(best){
      // Compression marks the steep front, not necessarily the crest. Move
      // backward along propagation to the first local height maximum before
      // emitting a sheet (Thuerey et al., section 5). Do not require fresh
      // compression at that higher point: its front already supplied it.
      const frontX=best.x,frontZ=best.z;best.frontX=frontX;best.frontZ=frontZ;let peak=best.height,foundRise=false;
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
        // A head-bounded sub-grid turn represents the vertical pressure work
        // absent from the depth-averaged field, without noisy Eulerian rates.
        best.up=plungingTakeoff(best.speed??2,best.drop,best.frontSlope??0).up;
      }
      // A crest search can find a different wave in the next column. That
      // is a separate front, never a face to bridge with a large triangle.
      const previous=nodes.at(-1);
      if(previous&&Math.abs((best.x-previous.x)*nx+(best.z-previous.z)*nz)>2.5){
        if(nodes.length>=3)break;
        nodes.length=0;
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
  readonly profiles=new BreakerProfiles();
  readonly roots=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*4);
  readonly tips=new Float32Array(this.roots.length);
  // The lower texture half stores the living material interval. A normalized
  // front age is not a lip coordinate after older parcels have hit the sea.
  readonly shapes=new Float32Array(this.roots.length*2);
  readonly sheet=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*SHEET_ROWS*4);
  private readonly separated=new Uint8Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*SHEET_ROWS);
  private readonly absorbed=new Uint8Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*SHEET_ROWS);
  private readonly emissionScratch:CrestEmission={time:0,x:0,y:0,z:0};
  private readonly parcelScratch={x:0,y:0,z:0,vy:0};
  private readonly histories=Array.from({length:BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES},()=>new CrestHistory());
  readonly visible=new Float32Array(BREAKER_FRONT_CAPACITY);
  readonly clock=new Float32Array(BREAKER_FRONT_CAPACITY);
  active=0;impacts=0;fronts=0;
  readonly frontAudit:{nodes:{x:number;y:number;z:number}[];maxGap:number;maxPhaseJump:number}[]=[];
  readonly sourceAudit:{height:number;surface:number;up:number;speed:number;clearance:number;drop:number}[]=[];
  readonly flightAudit:{age:number;drop:number;launchHeight:number;landingHeight:number;flightDistance:number;sourceReleased:number}[]=[];
  releaseWater?: (p:{x:number;y:number;z:number;vx:number;vy:number;vz:number})=>void;
  /** Later material rows land after the leading tip. Transfer their water to
   * the foam field once, rather than silently deleting the rest of the jet. */
  depositWater?: (impact:BreakerImpact)=>void;
  private readonly faceSupported=new Uint8Array(BREAKER_FRONT_NODES);
  private readonly rootSteps=new Float64Array(BREAKER_FRONT_NODES);
  private readonly crestSteps=new Float64Array(BREAKER_FRONT_NODES);
  private launchSpeeds=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES);
  private launchUps=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES);
  private crestSpeeds=new Float64Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES);
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
  private lastSampler:WhitewaterSampler|null=null;
  /** Bounded real cross-sections, used by the public capture UI. A floating
   * particle alone is not evidence of a barrel; retain the receiving surface. */
  get sectionAudit(){
    if(!this.lastSampler)return [];
    const sample=sampleState(),sections=[];
    for(let slot=0;slot<this.capacity;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      const j=8,index=slot*BREAKER_FRONT_NODES+j,i=index*4,b=nodes[j];
      if(this.roots[i+3]<=0)continue;
      const x=this.roots[i],z=this.roots[i+2],surface=[],parcels=[];
      for(let q=-2;q<=14;q+=.25)if(this.lastSampler(x+b.nx*q,z+b.nz*q,sample))surface.push([q,this.profiles.height(x+b.nx*q,z+b.nz*q,sample.height)]);
      for(let r=0;r<SHEET_ROWS;r++){const k=(index*SHEET_ROWS+r)*4;if(this.sheet[k+3]>=0)parcels.push([(this.sheet[k]-x)*b.nx+(this.sheet[k+2]-z)*b.nz,this.sheet[k+1],this.sheet[k+3]]);}
      sections.push({slot,age:this.ages[slot],root:[x,this.roots[i+1],z],direction:[b.nx,b.nz],drop:b.drop,frontSlope:b.frontSlope,faceSpeed:this.trackedSpeeds[index],crestSpeed:this.crestSpeeds[index],launchSpeed:this.launchSpeeds[index],up:this.launchUps[index],surface,parcels});
    }
    return sections;
  }
  emit(b:WhitewaterBirth):boolean{
    return this.emitFront(Array.from({length:3},(_,i)=>({...b,x:b.x-b.nz*(i-1)*1.5,z:b.z+b.nx*(i-1)*1.5})));
  }
  emitFront(input:readonly FrontNode[],sampler?:WhitewaterSampler):boolean{
    if(input.length<3||input.length>BREAKER_FRONT_NODES||input.some(b=>!Object.values(b).every(Number.isFinite)||b.energy<=0||b.energy>1||Math.abs(Math.hypot(b.nx,b.nz)-1)>.1))return false;
    const slot=this.births.indexOf(null);if(slot<0)return false;
    const nodes:FrontNode[]=[];
    for(let j=0;j<BREAKER_FRONT_NODES;j++){
      const f=j/(BREAKER_FRONT_NODES-1)*(input.length-1),k=Math.min(input.length-2,Math.floor(f)),t=f-k,a=input[k],b=input[k+1];
      const nx=THREE.MathUtils.lerp(a.nx,b.nx,t),nz=THREE.MathUtils.lerp(a.nz,b.nz,t),n=Math.hypot(nx,nz);
      nodes.push({...a.frontX!==undefined&&b.frontX!==undefined?{frontX:THREE.MathUtils.lerp(a.frontX,b.frontX,t),frontZ:THREE.MathUtils.lerp(a.frontZ!,b.frontZ!,t)}:{},x:THREE.MathUtils.lerp(a.x,b.x,t),z:THREE.MathUtils.lerp(a.z,b.z,t),height:THREE.MathUtils.lerp(a.height,b.height,t),
        up:THREE.MathUtils.lerp(a.up??.4,b.up??.4,t),frontSlope:THREE.MathUtils.lerp(a.frontSlope??0,b.frontSlope??0,t),energy:THREE.MathUtils.lerp(a.energy,b.energy,t),nx:nx/n,nz:nz/n,seed:((Math.sin((j+1)*12.9898+a.seed*78.233)*43758.5453)%1+1)%1,depth:THREE.MathUtils.lerp(a.depth??1,b.depth??1,t),speed:THREE.MathUtils.lerp(a.speed??2,b.speed??2,t),drop:THREE.MathUtils.lerp(a.drop??.2,b.drop??.2,t),reach:THREE.MathUtils.lerp(a.reach??.6,b.reach??.6,t)});
    }
    // Resampling a curved front changes x/z. Interpolating its endpoint
    // heights puts the new node inside a convex crest. Project every final
    // emission node back to the actual source surface before starting flight.
    if(sampler)for(const b of nodes){
      if(!sampler(b.x,b.z,this.sample)||!wet(this.sample,false))return false;
      b.height=this.sample.height;b.depth=this.sample.depth;
      const launch=breakerSheetSpeed(b.speed??2,b.drop??.2);
      b.up=b.frontX===undefined?breakerVerticalVelocity(this.sample,b.nx*launch,b.nz*launch):plungingTakeoff(b.speed??2,b.drop??.2,b.frontSlope??0).up;
    }
    const audit={nodes:nodes.map(b=>({x:b.x,y:b.height,z:b.z})),maxGap:0,maxPhaseJump:0};
    for(let j=1;j<nodes.length;j++){
      const a=nodes[j-1],b=nodes[j],dx=b.x-a.x,dz=b.z-a.z;
      audit.maxGap=Math.max(audit.maxGap,Math.hypot(dx,b.height-a.height,dz));
      audit.maxPhaseJump=Math.max(audit.maxPhaseJump,Math.abs(dx*b.nx+dz*b.nz));
    }
    this.frontAudit.push(audit);if(this.frontAudit.length>8)this.frontAudit.shift();
    this.absorbed.fill(0,slot*BREAKER_FRONT_NODES*SHEET_ROWS,(slot+1)*BREAKER_FRONT_NODES*SHEET_ROWS);
    this.separated.fill(0,slot*BREAKER_FRONT_NODES*SHEET_ROWS,(slot+1)*BREAKER_FRONT_NODES*SHEET_ROWS);
    this.births[slot]=nodes;this.ages[slot]=0;this.clock[slot]=0;this.visible[slot]=1;this.active++;this.eventIds[slot]=++this.fronts;
    for(let j=0;j<BREAKER_FRONT_NODES;j++){this.landed[slot*BREAKER_FRONT_NODES+j]=-1;this.tipSeparated[slot*BREAKER_FRONT_NODES+j]=0;this.released[slot*BREAKER_FRONT_NODES+j]=-1;const b=nodes[j],i=(slot*BREAKER_FRONT_NODES+j)*4;this.trackedSpeeds[slot*BREAKER_FRONT_NODES+j]=b.speed??2;const takeoff=plungingTakeoff(b.speed??2,b.drop??.2,b.frontSlope??0);const launch=takeoff.speed;this.launchSpeeds[slot*BREAKER_FRONT_NODES+j]=launch;this.launchUps[slot*BREAKER_FRONT_NODES+j]=b.up??.4;this.crestSpeeds[slot*BREAKER_FRONT_NODES+j]=b.speed??2;this.histories[slot*BREAKER_FRONT_NODES+j].reset({time:0,x:b.x,y:b.height,z:b.z,vx:b.nx*launch,vz:b.nz*launch,up:b.up??.4});this.trackedRoots[(slot*BREAKER_FRONT_NODES+j)*2]=b.frontX??b.x;this.trackedRoots[(slot*BREAKER_FRONT_NODES+j)*2+1]=b.frontZ??b.z;this.roots.set([b.x,b.height,b.z,0],i);this.tips.set([b.x,b.height,b.z,1],i);this.shapes.set([b.nx,b.nz,breakerLipThickness(b.drop??.2,b.energy)/Math.max(1,launch/(b.speed??2)),b.drop??.2],i);}
    return true;
  }
  advance(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    if(!Number.isFinite(dt)||dt<=0)return;
    this.lastSampler=sampler;
    for(let remaining=dt;remaining>1e-8&&this.active>0;){const step=Math.min(1/60,remaining);this.advanceStep(step,sampler,impact);remaining-=step;}
    if(!this.active)this.profiles.count=0;
  }
  private hideNode(index:number):void{
    this.roots[index*4+3]=0;
    for(let row=0;row<SHEET_ROWS;row++)this.sheet[(index*SHEET_ROWS+row)*4+3]=-1;
  }
  private advanceStep(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    this.updateProfiles(sampler);
    for(let slot=0;slot<this.capacity;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      const age=this.ages[slot]+=dt;this.clock[slot]=age;let alive=0;
      const follow=1-Math.exp(-10*dt);
      // Track a wave line, not 17 independent maxima. Independent projection
      // accumulated metres of differential drift and connected different waves.
      // A robust common phase increment preserves the traced front's shape;
      // already emitted water still follows its own ballistic history.
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const b=nodes[j],index=slot*BREAKER_FRONT_NODES+j,phase=b.speed??2;
        const px=this.trackedRoots[index*2]+b.nx*phase*dt,pz=this.trackedRoots[index*2+1]+b.nz*phase*dt;
        const target=b.frontX===undefined?trackBreakerRoot(px,pz,b.nx,b.nz,sampler):trackBreakerFace(px,pz,b.nx,b.nz,sampler);
        const r=index*4,cx=this.roots[r]+b.nx*phase*dt,cz=this.roots[r+2]+b.nz*phase*dt;
        const crestTarget=trackBreakerRoot(cx,cz,b.nx,b.nz,sampler);
        this.crestSteps[j]=phase*dt+(crestTarget?((crestTarget.x-cx)*b.nx+(crestTarget.z-cz)*b.nz)*follow:0);
        this.faceSupported[j]=target?1:0;
        this.rootSteps[j]=phase*dt+(target?((target.x-px)*b.nx+(target.z-pz)*b.nz)*follow:0);
      }
      this.rootSteps.sort();const sharedStep=this.rootSteps[8];
      this.crestSteps.sort();const sharedCrestStep=this.crestSteps[8];
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const b=nodes[j],index=slot*BREAKER_FRONT_NODES+j,i=index*4;
        // A connected front shares physical time. Local surface/drop creates
        // peeling naturally; delaying clocks by column detached the root.
        const delay=0;
        const t=Math.max(0,age-delay),flight=t,phaseSpeed=b.speed??2;
        const faceX=this.trackedRoots[index*2]+b.nx*sharedStep,faceZ=this.trackedRoots[index*2+1]+b.nz*sharedStep,s=this.sample;
        // Keep the identity of the emission crest. Re-running the eight-metre
        // crest search every frame jumped between peaks, leaving rectangular
        // sheets connecting unrelated parcels. Both lines track coherently.
        const rootX=b.frontX===undefined?faceX:this.roots[i]+b.nx*sharedCrestStep;
        const rootZ=b.frontX===undefined?faceZ:this.roots[i+2]+b.nz*sharedCrestStep;
        const measuredSpeed=((faceX-this.trackedRoots[index*2])*b.nx+(faceZ-this.trackedRoots[index*2+1])*b.nz)/dt;
        this.trackedSpeeds[index]+=(THREE.MathUtils.clamp(measuredSpeed,0,phaseSpeed*2)-this.trackedSpeeds[index])*(1-Math.exp(-dt/.15));
        this.trackedRoots[index*2]=faceX;this.trackedRoots[index*2+1]=faceZ;
        if(b.frontX!==undefined&&!this.faceSupported[j]&&age>.12&&this.released[index]<0)this.released[index]=age;
        if(age>3.2||!sampler(rootX,rootZ,s)||s.depth<=.02||s.depth>8){this.hideNode(index);continue;}
        const rootY=this.profiles.height(rootX,rootZ,s.height),history=this.histories[index];

        this.crestSpeeds[index]+=(THREE.MathUtils.clamp(sharedCrestStep/dt,0,16)-this.crestSpeeds[index])*(1-Math.exp(-dt/.15));
        const takeoff=plungingTakeoff(this.crestSpeeds[index],b.drop??.2,b.frontSlope??0);
        const desiredSpeed=takeoff.speed;
        // Cache arrivals must not give adjacent emission times unrelated jet
        // velocities. Resolve the source response over 180 ms; old parcels
        // keep their own immutable velocity. This is an authored closure.
        this.launchSpeeds[index]+=(desiredSpeed-this.launchSpeeds[index])*(1-Math.exp(-dt/.18));
        const launchSpeed=this.launchSpeeds[index];
        this.launchUps[index]+=(takeoff.up-this.launchUps[index])*(1-Math.exp(-dt/.18));
        const vx=b.nx*launchSpeed,vz=b.nz*launchSpeed,up=b.frontX===undefined?breakerVerticalVelocity(s,b.nx*launchSpeed,b.nz*launchSpeed):this.launchUps[index];
        // Store velocity at emission. Later crest acceleration must neither
        // drag older parcels nor leave all rows using the birth phase speed.
        if(this.released[index]<0)history.record({time:age,x:rootX,y:rootY,z:rootZ,vx,vz,up});
        const emission=history.sample(age-flight,this.emissionScratch),launchHeight=emission.y;
        const endpoint=flyWaterParcel(emission,age,vx,vz,up,this.parcelScratch);
        const x=endpoint.x,z=endpoint.z;let tipY=endpoint.y;
        if(!sampler(x,z,s)||s.depth<=.02||s.depth>8||!Number.isFinite(s.height)){this.hideNode(index);continue;}
        s.height=Math.max(s.ground+.015,this.profiles.height(x,z,s.height));
        if(j===8&&age<=dt+1e-8){
          this.sourceAudit.push({height:launchHeight,surface:s.height,up:emission.up??up,speed:Math.hypot(emission.vx??vx,emission.vz??vz),clearance:tipY-s.height,drop:b.drop??0});
          if(this.sourceAudit.length>128)this.sourceAudit.shift();
        }
        // Contact is a return from air, not merely a point inside the sea.
        // The old age gate reported a splash at 0.13s even when no water had
        // ever left the surface, and prematurely stopped feeding the crest.
        if(this.tipSeparated[index]===0){
          if(tipY>s.height+.025)this.tipSeparated[index]=1;
          else if(tipY<s.height-.025&&(b.frontX===undefined||age>=CREST_ATTACHMENT_SECONDS))this.tipSeparated[index]=2;
        }
        if(this.landed[index]<0&&this.tipSeparated[index]===1&&tipY<=s.height+.025){
          this.landed[index]=age;this.impacts++;
          this.flightAudit.push({age,drop:b.drop??0,launchHeight,landingHeight:s.height,flightDistance:Math.hypot(x-b.x,z-b.z),sourceReleased:this.released[index]});if(this.flightAudit.length>128)this.flightAudit.shift();
          const left=nodes[Math.max(0,j-1)],right=nodes[Math.min(BREAKER_FRONT_NODES-1,j+1)];
          const width=Math.max(.18,Math.hypot(right.x-left.x,right.z-left.z)*.5);
          // The leading row is one emission interval of water, not a separate
          // full-size splash volume in addition to the younger material rows.
          const volume=width*this.shapes[i+2]*Math.hypot(emission.vx??vx,emission.vz??vz)*SHEET_INTERVAL;
          impact({...b,x,z,height:s.height,width,volume,speed:phaseSpeed,drop:Math.max(0,launchHeight-s.height),reach:Math.max(.15,Math.hypot(x-b.x,z-b.z)-phaseSpeed*flight),eventId:this.eventIds[slot],impactSpeed:Math.min(12,Math.max(0,-endpoint.vy))});
        }
        const landed=this.landed[index];
        // Stop feeding a falling crest, but keep its emitted water in flight.
        // Spray carries a small breakup detail; it does not replace the sheet.
        if(this.released[index]<0&&t>.18&&rootY<launchHeight-.45){
          this.released[index]=age;
          for(let row=4;row<SHEET_ROWS;row+=4){
            const parcel=flyWaterParcel(history.sample(age-flight*row/(SHEET_ROWS-1),this.emissionScratch),age,vx,vz,up,this.parcelScratch);
            const parcelVx=this.emissionScratch.vx??vx,parcelVz=this.emissionScratch.vz??vz;
            if(sampler(parcel.x,parcel.z,s)&&parcel.y>s.height+.02)this.releaseWater?.({x:parcel.x,y:parcel.y,z:parcel.z,vx:parcelVx,vy:parcel.vy,vz:parcelVz});
          }
        }
        // Contact belongs to a parcel, not to the whole wave. A supported
        // crest keeps feeding the jet while its leading water is already foam.
        // Bound the emission window independently of the 3.2s flight budget.
        // Loss of face support or crest head above already stops it earlier.
        if(age>=1.2&&this.released[index]<0)this.released[index]=age;
        const emissionEnd=this.released[index]<0?age:this.released[index];
        const ramp=Math.min(1,t/.12);let airborne=false;
        if(landed>=0)tipY=s.height;
        this.roots.set([rootX,rootY,rootZ,ramp],i);this.tips.set([x,tipY,z,this.released[index]<0?1:0],i);
        let contactVolume=0,contactX=0,contactZ=0,contactY=0,contactSpeed=0;
        const left=nodes[Math.max(0,j-1)],right=nodes[Math.min(BREAKER_FRONT_NODES-1,j+1)];
        const width=Math.max(.18,Math.hypot(right.x-left.x,right.z-left.z)*.5);
        let firstLiving=SHEET_ROWS,lastLiving=-1;
        for(let row=0;row<SHEET_ROWS;row++){
          const emissionTime=row*SHEET_INTERVAL,exists=emissionTime<=emissionEnd+1e-8;
          const k=((slot*BREAKER_FRONT_NODES+j)*SHEET_ROWS+row)*4;
          if(!exists){this.sheet[k]=rootX;this.sheet[k+1]=rootY;this.sheet[k+2]=rootZ;this.sheet[k+3]=-1;continue;}
          const parcel=flyWaterParcel(history.sample(emissionTime,this.emissionScratch),age,vx,vz,up,this.parcelScratch);
          this.sheet[k]=parcel.x;this.sheet[k+1]=parcel.y;this.sheet[k+2]=parcel.z;this.sheet[k+3]=Math.max(0,-parcel.vy);
          const validSurface=exists&&sampler(this.sheet[k],this.sheet[k+2],s)&&Number.isFinite(s.height);
          if(validSurface)s.height=Math.max(s.ground+.015,this.profiles.height(this.sheet[k],this.sheet[k+2],s.height));
          // Every row is one fixed emission time shared by all columns.
          // contact is irreversible: falling sea level cannot resurrect water
          // already incorporated into the receiving surface.
          if(validSurface){
            const clearance=parcel.y-s.height;
            if(clearance>.025)this.separated[k/4]=1;
            // The rendered source is attached to the live crest for 120ms.
            // A raw ballistic sample can sit below that surface during this
            // boundary match. Do not irrevocably delete newly fed water before
            // the matching interval ends; a genuine return from air still lands.
            const attaching=b.frontX!==undefined&&this.released[index]<0&&age-emissionTime<CREST_ATTACHMENT_SECONDS&&!this.separated[k/4];
            // A newly emitted parcel starts on the surface. Being within the
            // contact tolerance is not a return from air. Retire genuinely
            // submerged parcels too, so a later trough cannot resurrect them.
            if((clearance<-.025&&!attaching)||(this.separated[k/4]&&parcel.vy<0&&clearance<=.025)){
              if(row>0&&!this.absorbed[k/4]&&this.separated[k/4]&&parcel.vy<0&&s.depth>.02){
                const speed=Math.hypot(this.emissionScratch.vx??vx,this.emissionScratch.vz??vz);
                const volume=width*this.shapes[i+2]*speed*SHEET_INTERVAL;
                contactVolume+=volume;contactX+=parcel.x*volume;contactZ+=parcel.z*volume;
                contactY+=s.height*volume;contactSpeed+=-parcel.vy*volume;
              }
              this.absorbed[k/4]=1;
            }
          }
          if(!exists||this.absorbed[k/4])this.sheet[k+3]=-1;
          else {
            firstLiving=Math.min(firstLiving,row);lastLiving=row;
            if(validSurface&&parcel.y>s.height+.025)airborne=true;
          }
        }
        this.shapes.set([firstLiving,lastLiving,emissionEnd,0],this.roots.length+i);
        // Outside the living material interval, collapse geometry to its real
        // free edge while retaining zero coverage. Interpolating an unborn row
        // at the *current root* with an old detached parcel made a long glass
        // triangle across empty air. Absorbed rows likewise cannot pull a live
        // edge down into a board. No new water or opacity is introduced here.
        if(lastLiving>=firstLiving){
          const start=(index*SHEET_ROWS+firstLiving)*4,end=(index*SHEET_ROWS+lastLiving)*4;
          for(let row=0;row<SHEET_ROWS;row++){
            if(row>=firstLiving&&row<=lastLiving)continue;
            const k=(index*SHEET_ROWS+row)*4,source=row<firstLiving?start:end;
            this.sheet[k]=this.sheet[source];this.sheet[k+1]=this.sheet[source+1];this.sheet[k+2]=this.sheet[source+2];
          }
        }
        if(contactVolume>0)this.depositWater?.({...b,x:contactX/contactVolume,z:contactZ/contactVolume,height:contactY/contactVolume,
          width,speed:phaseSpeed,eventId:this.eventIds[slot],impactSpeed:contactSpeed/contactVolume,volume:contactVolume});
        if(airborne||this.released[index]<0)alive++;else this.roots[i+3]=0;

      }
      // A retired column has no geometry. Extending its old source position
      // toward a neighbouring live jet would still rasterize a diagonal cap.
      // Collapse only those zero-coverage columns to the nearest living one.
      if(alive)for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const index=slot*BREAKER_FRONT_NODES+j;if(this.roots[index*4+3]>0)continue;
        let nearest=-1,distance=Infinity;
        for(let n=0;n<BREAKER_FRONT_NODES;n++)if(this.roots[(slot*BREAKER_FRONT_NODES+n)*4+3]>0&&Math.abs(n-j)<distance){nearest=n;distance=Math.abs(n-j);}
        if(nearest<0)continue;
        for(let row=0;row<SHEET_ROWS;row++){
          const k=(index*SHEET_ROWS+row)*4,source=((slot*BREAKER_FRONT_NODES+nearest)*SHEET_ROWS+row)*4;
          this.sheet[k]=this.sheet[source];this.sheet[k+1]=this.sheet[source+1];this.sheet[k+2]=this.sheet[source+2];this.sheet[k+3]=-1;
        }
      }
      if(!alive){
        this.visible[slot]=0;
        const center=nodes[8],holdBody=age<2.4&&plungingTakeoff(0,center.drop??0,center.frontSlope??0).plunging>=.15;
        if(!holdBody){this.births[slot]=null;this.active--;}
        for(let j=0;j<BREAKER_FRONT_NODES;j++)this.roots[(slot*BREAKER_FRONT_NODES+j)*4+3]=0;
      }
    }
  }
  private updateProfiles(sampler:WhitewaterSampler):void{
    const p=this.profiles;p.count=0;
    for(let slot=0;slot<this.capacity&&p.count<BREAKER_PROFILE_LIMIT;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      const b=nodes[8],drop=b.drop??0,plunge=plungingTakeoff(0,drop,b.frontSlope??0).plunging;
      if(plunge<.15||drop<.6)continue;
      const strength=plunge*THREE.MathUtils.smoothstep(this.ages[slot],0,.25)*(1-THREE.MathUtils.smoothstep(this.ages[slot],1.7,2.4));
      // Three overlapping sections follow the actual traced wave line. A
      // single 32m plane gave every curved crest the silhouette of a weir.
      for(const j of [3,8,13]){
        if(p.count>=BREAKER_PROFILE_LIMIT)break;
        const node=nodes[j],root=(slot*BREAKER_FRONT_NODES+j)*4,x=this.roots[root],z=this.roots[root+2];
        const s=this.sample;if(!sampler(x,z,s))continue;
        const first=nodes[Math.max(0,j-4)],last=nodes[Math.min(16,j+4)],halfWidth=Math.max(2,Math.hypot(last.x-first.x,last.z-first.z)*.65);
        p.crests.set([x,z,s.height,Math.min(node.drop??drop,Math.max(0,s.height-s.ground-.25))],p.count*4);
        p.axes.set([node.nx,node.nz,halfWidth,strength],p.count*4);p.count++;
      }
    }
  }
  /** A living wave front owns its moving face until its emitted water lands.
   * The old 1.1s detector timeout could emit another sheet through a 2.4s
   * front that was still airborne, creating intersecting rectangular slabs. */
  coversActiveFace(x:number,z:number):boolean{
    for(let slot=0;slot<this.capacity;slot++){
      const nodes=this.births[slot];if(!nodes)continue;
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const b=nodes[j],index=slot*BREAKER_FRONT_NODES+j;
        const dx=x-this.trackedRoots[index*2],dz=z-this.trackedRoots[index*2+1];
        if(Math.abs(dx*b.nx+dz*b.nz)<5&&Math.abs(-dx*b.nz+dz*b.nx)<2.5)return true;
      }
    }
    return false;
  }
  overlapsActiveCrest(nodes:readonly FrontNode[]):boolean{
    let covered=0;
    for(const candidate of nodes){
      let hit=false;
      for(let slot=0;slot<this.capacity&&!hit;slot++)if(this.births[slot])for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const i=(slot*BREAKER_FRONT_NODES+j)*4;
        const dx=candidate.x-this.roots[i],dz=candidate.z-this.roots[i+2];
        if(Math.abs(dx*candidate.nx+dz*candidate.nz)<3&&Math.abs(-dx*candidate.nz+dz*candidate.nx)<2.5){hit=true;break;}
      }
      if(hit)covered++;
    }
    return covered>=Math.ceil(nodes.length*.35);
  }
  get geometryAudit(){
    let maxAcrossGap=0,maxAlongGap=0,maxRootGap=0,activeSamples=0,maxAge=0,emittingNodes=0;
    for(let slot=0;slot<this.capacity;slot++)if(this.births[slot]){
      maxAge=Math.max(maxAge,this.ages[slot]);
      for(let j=0;j<BREAKER_FRONT_NODES;j++){
        const node=slot*BREAKER_FRONT_NODES+j,r=node*4;
        if(this.released[node]<0&&this.roots[r+3]>0)emittingNodes++;
        if(j>0)maxRootGap=Math.max(maxRootGap,Math.hypot(this.roots[r]-this.roots[r-4],this.roots[r+1]-this.roots[r-3],this.roots[r+2]-this.roots[r-2]));
        if(this.roots[r+3]<=0)continue;
        for(let row=0;row<SHEET_ROWS;row++){
          const k=(node*SHEET_ROWS+row)*4;if(this.sheet[k+3]<0)continue;activeSamples++;
          const gap=(p:number)=>Math.hypot(this.sheet[k]-this.sheet[p],this.sheet[k+1]-this.sheet[p+1],this.sheet[k+2]-this.sheet[p+2]);
          if(j>0&&this.sheet[k-SHEET_ROWS*4+3]>=0)maxAcrossGap=Math.max(maxAcrossGap,gap(k-SHEET_ROWS*4));
          if(row>0&&this.sheet[k-1]>=0)maxAlongGap=Math.max(maxAlongGap,gap(k-4));
        }
      }
    }
    return {maxAcrossGap,maxAlongGap,maxRootGapIncludingInactive:maxRootGap,activeSamples,maxAge,emittingNodes};
  }
  clear():void{this.births.fill(null);this.visible.fill(0);this.roots.fill(0);this.active=0;this.profiles.count=0;}
}

export class ConnectedShoreBreakers {
  readonly group=new THREE.Group();readonly pool=new ConnectedBreakerPool();
  readonly profileUniforms:Record<string,THREE.IUniform>={uBreakerProfileCount:{value:0},uBreakerProfileCrests:{value:this.pool.profiles.crests},uBreakerProfileAxes:{value:this.pool.profiles.axes}};
  readonly material:THREE.ShaderMaterial;private readonly geometry=new THREE.InstancedBufferGeometry();
  // One vertex atlas keeps the shared optical draw inside the 16-unit budget.
  private readonly atlasStride=SHEET_ROWS+4;
  private readonly atlas=new Float32Array(BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES*(SHEET_ROWS+4)*4);
  private readonly texture:THREE.DataTexture;
  constructor(){
    // Closed outer/inner faces and end caps give the falling lip actual volume.
    const base=new THREE.BoxGeometry(1,1,1,64,1,96);
    this.geometry.setIndex(base.index!.clone());this.geometry.setAttribute('position',base.getAttribute('position').clone());base.dispose();
    this.geometry.setAttribute('aSlot',new THREE.InstancedBufferAttribute(Float32Array.from({length:BREAKER_FRONT_CAPACITY},(_,i)=>i),1));
    this.geometry.setAttribute('aAge',new THREE.InstancedBufferAttribute(this.pool.clock,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aActive',new THREE.InstancedBufferAttribute(this.pool.visible,1).setUsage(THREE.DynamicDrawUsage));this.geometry.instanceCount=BREAKER_FRONT_CAPACITY;
    this.texture=new THREE.DataTexture(this.atlas,BREAKER_FRONT_NODES*this.atlasStride,BREAKER_FRONT_CAPACITY,THREE.RGBAFormat,THREE.FloatType);
    this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;this.texture.needsUpdate=true;
    this.material=new THREE.ShaderMaterial({defines:{CURVED_SURFACE:1,CONNECTED_FRONT:1},side:THREE.DoubleSide,depthTest:true,depthWrite:true,uniforms:{uBehindWater:{value:null},uBehindWaterReady:{value:0},uFrontAtlas:{value:this.texture}},fragmentShader:oceanFragment,vertexShader:/* glsl */`
      attribute float aSlot,aActive,aAge;uniform sampler2D uFrontAtlas;
      varying vec3 vWorld;varying vec2 vOcean;varying float vDistance,vEnvelope,vLip,vWaterThickness;
      varying float vAeration;varying vec3 vSheetNormal;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${marineSurfaceSampling}
      vec2 lipCoast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 lipDisplacement(vec2 p){return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(lipCoast(p),uSwell,uWind);}
      float lipSurface(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-lipDisplacement(p).xz*uChoppiness;return shoreSolvedSurface(world,lipDisplacement(p).y,0.).x+marineSurface(world).b;}
      // Component-wise monotone Hermite interpolation cannot overshoot the
      // bounding samples and invent reflective spikes between water parcels.
      vec4 harmonicTangent(vec4 a,vec4 b){return (sign(a)+sign(b))*abs(a*b)/(abs(a)+abs(b)+vec4(.000001));}
      vec4 boundedCubic(vec4 p0,vec4 p1,vec4 p2,vec4 p3,float t){
        vec4 d=p2-p1,m1=harmonicTangent(p1-p0,d),m2=harmonicTangent(d,p3-p2);
        return (2.*t*t*t-3.*t*t+1.)*p1+(t*t*t-2.*t*t+t)*m1+(-2.*t*t*t+3.*t*t)*p2+(t*t*t-t*t)*m2;
      }
      vec4 atlasNode(float node,float row){return texture2D(uFrontAtlas,vec2((clamp(node,0.,16.)*${this.atlasStride}.+row+.5)/${BREAKER_FRONT_NODES*this.atlasStride}.,(aSlot+.5)/24.));}
      vec4 frontValue(float source,float node){return atlasNode(node,${SHEET_ROWS}.+source);}
      vec4 frontState(float source,float along){float node=along*16.,a=floor(node),t=fract(node);vec4 p0=frontValue(source,a-1.),p1=frontValue(source,a),p2=frontValue(source,a+1.),p3=frontValue(source,a+2.);return boundedCubic(p0,p1,p2,p3,t);}
      vec4 shapeNode(float node,float halfIndex){return atlasNode(node,${SHEET_ROWS+2}.+halfIndex);}
      vec4 shapeState(float along,float halfIndex){float n=along*16.,a=floor(n),t=fract(n);return boundedCubic(shapeNode(a-1.,halfIndex),shapeNode(a,halfIndex),shapeNode(a+1.,halfIndex),shapeNode(a+2.,halfIndex),t);}
      vec4 sheetNode(float node,float row){return atlasNode(node,clamp(row,0.,${SHEET_ROWS-1}.));}
      vec4 sheetRow(float node,float u){float r=clamp((1.-u)*aAge*60.,0.,${SHEET_ROWS-1}.);return mix(sheetNode(node,floor(r)),sheetNode(node,floor(r)+1.),fract(r));}
      float sheetCoverage(float along,float u){
        float r=clamp((1.-u)*aAge*60.,0.,${SHEET_ROWS-1}.),n=along*16.,a=floor(n),b=floor(r);
        float left=mix(step(0.,sheetNode(a,b).w),step(0.,sheetNode(a,b+1.).w),fract(r));
        float right=mix(step(0.,sheetNode(a+1.,b).w),step(0.,sheetNode(a+1.,b+1.).w),fract(r));
        return mix(left,right,fract(n));
      }
      vec4 parcelState(float along,float u){
        float n=along*16.,a=floor(n),t=fract(n);
        vec4 p0=sheetRow(a-1.,u),p1=sheetRow(a,u),p2=sheetRow(a+1.,u),p3=sheetRow(a+2.,u);
        return boundedCubic(p0,p1,p2,p3,t);
      }
      ${crestAttachmentGLSL}
      vec4 attachedParcel(float along,float u){
        vec4 parcel=parcelState(along,u);
        float feeding=clamp(frontState(1.,along).w,0.,1.);
        float parcelAge=u*aAge;
        if(feeding<.001||parcelAge>=${CREST_ATTACHMENT_SECONDS})return parcel;
        vec4 origin=parcelState(along,0.);
        float probeAge=min(aAge,1./60.);
        vec4 probe=parcelState(along,probeAge/max(aAge,.00001));
        float heightError=lipSurface(origin.xz)-origin.y;
        float rateError=(lipSurface(probe.xz)-probe.y-heightError)/max(probeAge,.00001);
        // Hermite boundary matching removes the sharp join slope. Its support
        // is a fixed 120ms of material age, never 10% of an ageing whole sheet.
        // Expensive surface queries are skipped for all older airborne water.
        parcel.y+=crestAttachmentOffset(heightError,rateError,parcelAge)*feeding;
        return parcel;
      }
      void main(){
        if(aActive<.5){gl_Position=vec4(2,2,2,1);return;}
        float u=position.x+.5,along=position.z+.5;
        vec4 root=frontState(0.,along),tip=frontState(1.,along),shape=shapeState(along,0.);shape.xy=normalize(shape.xy);
        vec4 interval=shapeState(along,1.);
        float materialRow=(1.-u)*aAge*60.;
        float liveLip=clamp((interval.y-materialRow)/max(1.,interval.y-interval.x),0.,1.);
        float edge=smoothstep(0.,.12,along)*(1.-smoothstep(.88,1.,along));
        vEnvelope=clamp(root.w,0.,1.)*edge;vLip=liveLip;
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
        vec4 parcel=attachedParcel(along,u);
        vEnvelope*=sheetCoverage(along,u);
        // Differentiate the same attached surface that is actually rendered.
        // Uncorrected trajectories gave the join an unrelated reflection normal.
        vec4 previous=attachedParcel(along,max(0.,u-.03125)),next=attachedParcel(along,min(1.,u+.03125));
        vec2 tangent=vec2(dot(next.xz-previous.xz,shape.xy),next.y-previous.y);
        vec3 across=attachedParcel(min(1.,along+.0078125),u).xyz-attachedParcel(max(0.,along-.0078125),u).xyz;
        vec3 flightTangent=next.xyz-previous.xyz;
        vec3 smoothNormal=cross(across,flightTangent);
        vSheetNormal=length(smoothNormal)>.000001?normalize(smoothNormal):vec3(0.,1.,0.);
        vec2 sideNormal=normalize(vec2(-tangent.y,tangent.x)+vec2(0.,.00001));
        // Optical thickness must match the actual closed sheet, including its
        // pinched free edges. A constant optical path painted a dark rectangle
        // where the geometry had already narrowed to zero volume.
        float thickness=shape.z*sin(liveLip*3.14159265)*edge;
        vWaterThickness=max(0.,thickness);
        parcel.xz+=shape.xy*sideNormal.x*position.y*thickness;
        parcel.y+=sideNormal.y*position.y*thickness;
        vAeration=clamp(parcel.w/6.,0.,1.);
        vec2 world=parcel.xz;float base=lipSurface(world);
        // Visibility is not a vertical displacement. Flattening a dying
        // column onto base joined airborne neighbours with rectangular walls.
        // Preserve its trajectory and let the fragment pass clip submerged water.
        float height=parcel.y;
        // Fine water detail is shaded by the shared capillary model. Do not
        // add untracked geometric ripples after computing the surface normal.
        vec2 horizon=world-cameraPosition.xz;height-=dot(horizon,horizon)/(2.*6371000.);
        vWorld=vec3(world.x,height,world.y);vOcean=world;vDistance=length(cameraPosition-vWorld);
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1);
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);
  }
  bind(uniforms:Record<string,THREE.IUniform>):void{for(const [name,value] of Object.entries(uniforms))this.material.uniforms[name]=value;}
  update(dt:number,sampler:WhitewaterSampler,impact:(b:BreakerImpact)=>void):void{
    this.pool.advance(dt,sampler,impact);this.profileUniforms.uBreakerProfileCount.value=this.pool.profiles.count;
    for(let node=0;node<BREAKER_FRONT_CAPACITY*BREAKER_FRONT_NODES;node++){
      const dest=node*this.atlasStride*4,source=node*SHEET_ROWS*4,k=node*4;
      this.atlas.set(this.pool.sheet.subarray(source,source+SHEET_ROWS*4),dest);
      this.atlas.set(this.pool.roots.subarray(k,k+4),dest+SHEET_ROWS*4);
      this.atlas.set(this.pool.tips.subarray(k,k+4),dest+(SHEET_ROWS+1)*4);
      this.atlas.set(this.pool.shapes.subarray(k,k+4),dest+(SHEET_ROWS+2)*4);
      this.atlas.set(this.pool.shapes.subarray(this.pool.roots.length+k,this.pool.roots.length+k+4),dest+(SHEET_ROWS+3)*4);
    }
    this.texture.needsUpdate=true;this.geometry.getAttribute('aActive').needsUpdate=true;this.geometry.getAttribute('aAge').needsUpdate=true;
  }
  dispose():void{this.pool.clear();this.texture.dispose();this.geometry.dispose();this.material.dispose();this.group.clear();}
}
