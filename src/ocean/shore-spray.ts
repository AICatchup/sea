import * as THREE from 'three';
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

const GRID=24, SPAN=144, INTERVAL=.2, LIMIT=1500;
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
  advance(delta:number):void{
    if(!Number.isFinite(delta)||delta<=0)return;
    for(let i=0;i<this.capacity;i++){
      const b=this.births[i];if(!b)continue;
      const t=this.ages[i]+=delta;
      if(t>=b.life){this.births[i]=null;this.alpha[i]=0;this.active--;continue;}
      const travel=(1-Math.exp(-b.drag*t))/b.drag;
      this.positions[i*3]=b.x+b.windX*t+(b.vx-b.windX)*travel;
      this.positions[i*3+1]=b.y+b.vy*t-4.905*t*t;
      this.positions[i*3+2]=b.z+b.windZ*t+(b.vz-b.windZ)*travel;
      const fade=Math.min(1,t/.06)*Math.pow(1-t/b.life,1.4);
      this.alpha[i]=b.opacity*fade;
    }
  }
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
 * Volume mode adds 576 RG8 signed flow/B validity/A sentinel pixels in the
 * same draw/read request (4608 bytes total at 5Hz, not another readback).
 * The shader recomputes compression: FFT alpha contains historical foam, not
 * the instantaneous Jacobian. Bathymetry uses the renderer's half-texel map.
 * Birth sites are a 6m grid and at most 0.2s old: this is a bounded approximation
 * to crest spray, not a resolved fluid or lip-impact simulation. */
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
  private lastRequest=-Infinity;
  private pending=false;
  private disposed=false;
  private failed=false;
  private randomState=0x137a942;
  private credits=new Float32Array(GRID*GRID);
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
  private readonly foamCredits=new Float32Array(GRID*GRID);
  private readonly foamSample:WhitewaterSample={height:0,compression:0,depth:0,shelter:1,ground:0,gradientX:0,gradientZ:0};
  private foamCacheValid=false;
  private readonly sampleFoam=(x:number,z:number,out:WhitewaterSample):boolean=>{
    if(!this.foamCacheValid||!this.pixels)return false;
    const cx=(x-this.sampleOrigin.x)/6+GRID/2-.5,cz=(z-this.sampleOrigin.y)/6+GRID/2-.5;
    if(cx<0||cz<0||cx>GRID-1||cz>GRID-1)return false;
    const ix=Math.floor(cx),iz=Math.floor(cz),fx=cx-ix,fz=cz-iz;
    const h=(a:number,b:number)=>{const i=(b*GRID+a)*4;return (this.pixels![i]*256+this.pixels![i+1])/65535*16-8;};
    out.height=THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(ix,iz),h(Math.min(ix+1,GRID-1),iz),fx),THREE.MathUtils.lerp(h(ix,Math.min(iz+1,GRID-1)),h(Math.min(ix+1,GRID-1),Math.min(iz+1,GRID-1)),fx),fz);
    const i=(Math.round(cz)*GRID+Math.round(cx))*4;
    out.waveGradientX=(h(Math.min(ix+1,GRID-1),iz)-h(Math.max(ix-1,0),iz))/(ix>0&&ix<GRID-1?12:6);
    out.waveGradientZ=(h(ix,Math.min(iz+1,GRID-1))-h(ix,Math.max(iz-1,0)))/(iz>0&&iz<GRID-1?12:6);
    out.compression=this.pixels[i+2]/255;out.shelter=1;
    out.ground=this.ground.heightAt(x,z);out.gradientX=this.ground.heightAt(x+2,z)-this.ground.heightAt(x-2,z);out.gradientZ=this.ground.heightAt(x,z+2)-this.ground.heightAt(x,z-2);
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
  constructor(renderer:THREE.WebGLRenderer,ground:{heightAt(x:number,z:number):number},options:{whitewater?:boolean;volume?:boolean}={}){
    this.renderer=renderer;this.ground=ground;
    this.flowReadback=!!options.volume;
    this.target=new THREE.WebGLRenderTarget(GRID,GRID*(this.flowReadback?2:1),{type:THREE.UnsignedByteType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    this.whitewater=options.volume?new ShoreWhitewaterVolume():options.whitewater?new ShoreWhitewater():null;
    if(this.whitewater)this.group.add(this.whitewater.group);
    this.sampleMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...createShoreSolverUniforms(),uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uCenter:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55},uDepthCapLoss:{value:(options.whitewater||options.volume)?1:0}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:/* glsl */`
      precision highp float;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
      uniform vec4 uBathyBounds;uniform vec2 uBathyResolution,uCenter;
      uniform float uSwell,uWind,uChoppiness,uDepthCapLoss;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      ${shoreBreakerDissipationSampling}
      ${whitewaterFlowSampling}
      vec2 coastAt(vec2 p){
        vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
        if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);
        return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;
      }
      vec3 longAt(vec2 p){return texture2D(uLongWaves,p/384.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 shortAt(vec2 p){return texture2D(uShortWaves,p/24.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 displacement(vec2 p){return (longAt(p)+shortAt(p))*uSwell;}
      void main(){
        vec2 world=uCenter+(vec2(gl_FragCoord.x,mod(gl_FragCoord.y,24.))-vec2(12.0))*6.0;
        vec4 flow=whitewaterSolvedFlow(world);
        if(gl_FragCoord.y>=24.){
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
        h=shoreSolvedSurface(world,h,0.).x;
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
  update(time:number,delta:number,camera:THREE.Camera,uniforms:Uniforms):void{
    if(this.disposed)return;
    const underwater=Number(uniforms.uUnderwater?.value??0)>.5;
    this.group.visible=!underwater;
    const viewport=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for(const material of [this.material,this.whitewater?.material])if(material){
      material.uniforms.uOccludingDepth.value=uniforms.uSceneDepth?.value??null;
      material.uniforms.uOccludingDepthReady.value=uniforms.uSceneDepth?.value?1:0;
      material.uniforms.uViewport.value.copy(viewport);
    }
    if(this.whitewater)for(const key of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uSwell','uWind','uChoppiness','uShoreState','uShoreBounds','uShoreReady','uShoreResolution','uSunDirection','uSunColor','uHorizon'])
      if(uniforms[key]&&this.whitewater.material.uniforms[key])this.whitewater.material.uniforms[key]=uniforms[key];
    if(!Number.isFinite(time)||!Number.isFinite(delta)||delta<=0)return;
    const start=performance.now(),dt=Math.min(delta,.05);
    this.pool.advance(dt);
    this.foamCacheValid=!!this.pixels&&time-this.sampleTime<=.5&&time>=this.sampleTime;
    this.whitewater?.update(delta,this.sampleFoam,underwater);
    if(!underwater){
      this.requestSample(time,camera,uniforms);
      const wind=Math.max(0,Math.min(35,Number(uniforms.uWind?.value??0)));
      if(this.pixels&&time-this.sampleTime<=.5&&time>=this.sampleTime){
        // Maximum 100 births per update; this bounds both CPU work and draw size.
        let births=0;
        for(let cell=0;cell<GRID*GRID&&births<100&&this.pool.active<this.pool.capacity;cell++){
          const index=cell*4,x=this.sampleOrigin.x+(cell%GRID+.5-GRID/2)*SPAN/GRID;
          const z=this.sampleOrigin.y+(Math.floor(cell/GRID)+.5-GRID/2)*SPAN/GRID;
          const h=(this.pixels[index]*256+this.pixels[index+1])/65535*16-8;
          const depth=this.pixels[index+3]/255*8,energy=this.pixels[index+2]/255;
          const distance=Math.hypot(camera.position.x-x,camera.position.z-z);
          const ground=this.ground.heightAt(x,z);
          if(!Number.isFinite(ground)||ground>=h-.08){this.credits[cell]=0;continue;}
          const rate=sprayBirthRate(depth,energy,1,distance);
          if(rate<=0){this.credits[cell]=0;continue;}
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
            windX:-nx*wind*.12,windZ:-nz*wind*.12,drag:mist?2.4:.6,life:mist?.35+this.random()*.45:.2+this.random()*.35,
            size:mist?.10+this.random()*.18:.012+this.random()*.028,opacity:mist?.12:.24});
          if(born){births++;this.emitted++;}
          }
        }
      }
      if(this.whitewater&&this.foamCacheValid){
        let count=0;
        for(let offset=0;offset<GRID*GRID&&count<24&&this.whitewater.pool.active<this.whitewater.pool.capacity;offset++){
          const cell=(offset+this.foamScanCursor)%(GRID*GRID);
          const x=this.sampleOrigin.x+(cell%GRID+.5-GRID/2)*6,z=this.sampleOrigin.y+(Math.floor(cell/GRID)+.5-GRID/2)*6;
          const s=this.foamSample;if(!this.sampleFoam(x,z,s))continue;
          const rate=whitewaterBirthRate(s);if(rate<=0){this.foamCredits[cell]=0;continue;}
          if(this.random()>=Math.min(1,rate*dt))continue;
          const norm=Math.hypot(s.gradientX,s.gradientZ),seed=this.random(),along=(seed-.5)*4;
          const nx=s.gradientX/norm,nz=s.gradientZ/norm;
          // The coarse cache is Eulerian. Sample the actual wet field at a
          // subcell position rather than stamping parallel 6m birth rows.
          const across=this.whitewater instanceof ShoreWhitewaterVolume?(this.random()-.5)*5.4:0;
          const bx=x-nz*along+nx*across,bz=z+nx*along+nz*across;
          if(!this.sampleFoam(bx,bz,s)||whitewaterBirthRate(s)<=0)continue;
          if(this.whitewater.pool.emit({x:bx,z:bz,height:s.height,energy:s.compression,nx,nz,seed})){count++;this.whitewaterEmitted++;}
        }
        if(this.whitewater instanceof ShoreWhitewaterVolume)this.foamScanCursor=(this.foamScanCursor+137)%(GRID*GRID);
      }
    }
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const perspective=camera as THREE.PerspectiveCamera;
    this.material.uniforms.uPixelScale.value=size.y/(2*Math.tan(THREE.MathUtils.degToRad(perspective.fov??62)/2));
    if(uniforms.uHorizon?.value){const tint=uniforms.uHorizon.value as THREE.Vector3;this.material.uniforms.uTint.value.setRGB(tint.x*.5+.3,tint.y*.5+.3,tint.z*.5+.3);}
    for(const attribute of Object.values(this.geometry.attributes))attribute.needsUpdate=true;
    this.updateMs=performance.now()-start;
  }
  private requestSample(time:number,camera:THREE.Camera,uniforms:Uniforms):void{
    if(this.pending||this.failed||time-this.lastRequest<INTERVAL||!uniforms.uLongWaves?.value||!uniforms.uShortWaves?.value||!uniforms.uBathymetry?.value)return;
    this.lastRequest=time;this.pending=true;
    const origin=new THREE.Vector2(Math.round(camera.position.x/6)*6,Math.round(camera.position.z/6)*6);
    for(const name of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uSwell','uWind','uChoppiness','uShoreState','uShoreBounds','uShoreReady','uShoreResolution']){
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
    void readback.then(pixels=>{
      if(this.disposed)return;
      if(!(pixels instanceof Uint8Array)||pixels.length!==GRID*GRID*4*(this.flowReadback?2:1))throw new Error('Invalid spray readback');
      if(this.flowReadback)for(let i=GRID*GRID*4+3;i<pixels.length;i+=4)if(pixels[i]!==137)throw new Error('Uninitialized flow framebuffer');
      // Black framebuffer is not a valid height field (zero height encodes 128,0).
      if(!pixels.some((value,i)=>i<GRID*GRID*4&&i%4<2&&value!==0))throw new Error('Uninitialized spray framebuffer');
      this.maxSampleEnergy=0;this.maxSampleCrest=0;this.maxEstimatedHeightDepthRatio=0;this.sampleEnergyPositiveCount=0;this.sampleWetEligibleCount=0;
      for(let i=0;i<GRID*GRID*4;i+=4){
        const height=(pixels[i]*256+pixels[i+1])/65535*16-8,depth=pixels[i+3]/255*8,energy=pixels[i+2]/255;
        this.maxSampleEnergy=Math.max(this.maxSampleEnergy,energy);this.maxSampleCrest=Math.max(this.maxSampleCrest,height);
        if(energy>0)this.sampleEnergyPositiveCount++;
        if(depth>=.2&&depth<=3.8){this.sampleWetEligibleCount++;this.maxEstimatedHeightDepthRatio=Math.max(this.maxEstimatedHeightDepthRatio,Math.max(0,height)/depth);}
      }
      if(!origin.equals(this.sampleOrigin)){this.credits.fill(0);this.foamCredits.fill(0);}
      this.pixels=pixels;this.sampleOrigin.copy(origin);this.sampleTime=time;
    }).catch(()=>{if(!this.disposed)this.failReadback();}).finally(()=>{this.pending=false;if(this.disposed)this.target.dispose();});
  }
  private failReadback():void{
    this.failed=true;this.pixels=null;this.foamCacheValid=false;
    this.credits.fill(0);this.foamCredits.fill(0);
  }
  get diagnostics(){return {active:this.pool.active,capacity:LIMIT,drawCalls:this.whitewater?2:1,whitewaterActive:this.whitewater?.pool.active??0,whitewaterCapacity:this.whitewater?.pool.capacity??0,whitewaterTriangles:this.whitewater instanceof ShoreWhitewaterVolume?this.whitewater.geometry.getAttribute('position').count/3*this.whitewater.pool.capacity:this.whitewater?2048:0,whitewaterMode:this.whitewater instanceof ShoreWhitewaterVolume?'volume':this.whitewater?'legacy':'off',whitewaterEmitted:this.whitewaterEmitted,maxSampleEnergy:this.maxSampleEnergy,maxSampleCrest:this.maxSampleCrest,maxEstimatedHeightDepthRatio:this.maxEstimatedHeightDepthRatio,sampleEnergyPositiveCount:this.sampleEnergyPositiveCount,sampleWetEligibleCount:this.sampleWetEligibleCount,samples:GRID*GRID,readbackBytes:GRID*GRID*4*(this.flowReadback?2:1),flowSamples:this.flowReadback?GRID*GRID:0,interval:INTERVAL,pending:this.pending,ready:!!this.pixels,failed:this.failed,emitted:this.emitted,updateMs:this.updateMs,birthProxyUnits:'SWE compression × 0.7s onset / FFT instantaneous dissipation proxy; no residual foam input',approximation:this.whitewater instanceof ShoreWhitewaterVolume?'6m grid / <=0.5s cache; instantaneous compression births; sampled SWE flow with FFT-only heuristic fallback; no overturning CFD':'6m grid / <=0.5s cache / finite-difference FFT compression; wind direction follows local offshore gradient; whitewater bilinear cached height, ground-culling, analytic onshore drift'};}
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    this.whitewater?.dispose();
    this.geometry.dispose();this.material.dispose();this.quadGeometry.dispose();this.sampleMaterial.dispose();
    if(!this.pending)this.target.dispose();this.group.clear();this.scene.clear();this.pixels=null;
  }
}
