import * as THREE from 'three';
import { shoreWaveSampling } from './surface-detail.ts';

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

/** Negative paths deliberately produce no substitute fog or deep-water spray. */
export function sprayBirthRate(depth:number,energy:number,shelter:number,distance:number):number{
  if(![depth,energy,shelter,distance].every(Number.isFinite)||depth<.2||depth>4||energy<=.08||shelter<.18||distance>90)return 0;
  const shore=Math.min(1,(depth-.2)/.4)*Math.min(1,(4-depth)/1.2);
  return 10*shore*Math.max(0,Math.min(1,energy))*Math.max(0,Math.min(1,shelter))*Math.max(0,1-distance/100);
}

/** 576 current FFT samples, RG16 height/B breaker energy/A depth, 2304 bytes.
 * The shader recomputes compression: FFT alpha contains historical foam, not
 * the instantaneous Jacobian. Bathymetry uses the renderer's half-texel map.
 * Birth sites are a 6m grid and at most 0.2s old: this is a bounded approximation
 * to crest spray, not a resolved fluid or lip-impact simulation. */
export class ShoreSpray {
  readonly group=new THREE.Group();
  private readonly pool=new SprayPool();
  private readonly scene=new THREE.Scene();
  private readonly sampleCamera=new THREE.Camera();
  private readonly target=new THREE.WebGLRenderTarget(GRID,GRID,{type:THREE.UnsignedByteType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
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
  private updateMs=0;
  constructor(renderer:THREE.WebGLRenderer,ground:{heightAt(x:number,z:number):number}){
    this.renderer=renderer;this.ground=ground;
    this.sampleMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uCenter:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:/* glsl */`
      precision highp float;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
      uniform vec4 uBathyBounds;uniform vec2 uBathyResolution,uCenter;
      uniform float uSwell,uWind,uChoppiness;
      ${shoreWaveSampling}
      vec2 coastAt(vec2 p){
        vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
        if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);
        return texture2D(uBathymetry,uv*(uBathyResolution-1.0)/uBathyResolution+.5/uBathyResolution).rg;
      }
      vec3 longAt(vec2 p){return texture2D(uLongWaves,p/384.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 shortAt(vec2 p){return texture2D(uShortWaves,p/24.0).xyz*shoreWaveScale(coastAt(p),uSwell,uWind);}
      vec3 displacement(vec2 p){return (longAt(p)+shortAt(p))*uSwell;}
      void main(){
        vec2 world=uCenter+(gl_FragCoord.xy-vec2(12.0))*6.0;
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
        float code=floor(clamp(h/16.0+.5,0.0,1.0)*65535.0+.5);
        gl_FragColor=vec4(floor(code/256.0),mod(code,256.0),floor(energy*255.0+.5),floor(clamp(depth/8.0,0.0,1.0)*255.0+.5))/255.0;
      }`});
    const quad=new THREE.Mesh(this.quadGeometry,this.sampleMaterial);quad.frustumCulled=false;this.scene.add(quad);
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.pool.positions,3));
    this.geometry.setAttribute('aSize',new THREE.BufferAttribute(this.pool.sizes,1));
    this.geometry.setAttribute('aAlpha',new THREE.BufferAttribute(this.pool.alpha,1));
    for(const attribute of Object.values(this.geometry.attributes))(attribute as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false,
      uniforms:{uPixelScale:{value:500},uTint:{value:new THREE.Color(.68,.78,.81)}},
      vertexShader:/* glsl */`attribute float aSize,aAlpha;uniform float uPixelScale;varying float vAlpha;
        void main(){vec4 p=modelViewMatrix*vec4(position,1);vAlpha=aAlpha;
        gl_PointSize=clamp(aSize*uPixelScale/max(.2,-p.z),1.0,9.0);gl_Position=projectionMatrix*p;}`,
      fragmentShader:/* glsl */`uniform vec3 uTint;varying float vAlpha;
        void main(){vec2 q=gl_PointCoord*2.0-1.0;float r=dot(q,q);if(r>1.0||vAlpha<.001)discard;
        gl_FragColor=vec4(uTint,vAlpha*exp(-r*3.5)*(1.0-smoothstep(.55,1.0,r)));}`});
    const points=new THREE.Points(this.geometry,this.material);points.frustumCulled=false;this.group.add(points);
  }
  private random():number{let x=this.randomState;x^=x<<13;x^=x>>>17;x^=x<<5;this.randomState=x;return (x>>>0)/4294967296;}
  update(time:number,delta:number,camera:THREE.Camera,uniforms:Uniforms):void{
    if(this.disposed)return;
    const underwater=Number(uniforms.uUnderwater?.value??0)>.5;
    this.group.visible=!underwater;
    if(!Number.isFinite(time)||!Number.isFinite(delta)||delta<=0)return;
    const start=performance.now(),dt=Math.min(delta,.05);
    this.pool.advance(dt);
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
          this.credits[cell]=Math.min(2,this.credits[cell]+rate*dt);
          if(this.credits[cell]<1)continue;this.credits[cell]--;
          // Local bathymetric uphill points onshore. Light droplets drag offshore.
          const gx=this.ground.heightAt(x+2,z)-this.ground.heightAt(x-2,z);
          const gz=this.ground.heightAt(x,z+2)-this.ground.heightAt(x,z-2);
          const norm=Math.hypot(gx,gz)||1,nx=gx/norm,nz=gz/norm;
          const mist=this.random()<.65,speed=.6+this.random()*1.9;
          const jitter=(this.random()-.5)*.3;
          const born=this.pool.emit({x:x+jitter,y:h+.04,z:z+jitter,vx:nx*speed+(this.random()-.5),vy:.8+this.random()*2.6*energy,vz:nz*speed+(this.random()-.5),
            windX:-nx*wind*.12,windZ:-nz*wind*.12,drag:mist?2.4:.6,life:mist?.35+this.random()*.45:.2+this.random()*.35,
            size:mist?.045+this.random()*.09:.012+this.random()*.028,opacity:mist?.10:.24});
          if(born){births++;this.emitted++;}
        }
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
    for(const name of ['uLongWaves','uShortWaves','uBathymetry','uBathyBounds','uBathyResolution','uSwell','uWind','uChoppiness']){
      if(uniforms[name])this.sampleMaterial.uniforms[name].value=uniforms[name].value;
    }
    this.sampleMaterial.uniforms.uCenter.value.copy(origin);
    const previous=this.renderer.getRenderTarget();
    try{this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.sampleCamera);}
    catch{this.pending=false;this.failed=true;return;}
    finally{this.renderer.setRenderTarget(previous);}
    let readback:Promise<Uint8Array>;
    try{readback=this.renderer.readRenderTargetPixelsAsync(this.target,0,0,GRID,GRID,new Uint8Array(GRID*GRID*4)) as Promise<Uint8Array>;}
    catch{this.pending=false;this.failed=true;return;}
    void readback.then(pixels=>{
      if(this.disposed)return;
      if(!(pixels instanceof Uint8Array)||pixels.length!==GRID*GRID*4)throw new Error('Invalid spray readback');
      // Black framebuffer is not a valid height field (zero height encodes 128,0).
      if(!pixels.some((value,i)=>i%4<2&&value!==0))throw new Error('Uninitialized spray framebuffer');
      if(!origin.equals(this.sampleOrigin))this.credits.fill(0);
      this.pixels=pixels;this.sampleOrigin.copy(origin);this.sampleTime=time;
    }).catch(()=>{if(!this.disposed)this.failed=true;}).finally(()=>{this.pending=false;if(this.disposed)this.target.dispose();});
  }
  get diagnostics(){return {active:this.pool.active,capacity:LIMIT,drawCalls:1,samples:GRID*GRID,readbackBytes:GRID*GRID*4,interval:INTERVAL,pending:this.pending,ready:!!this.pixels,failed:this.failed,emitted:this.emitted,updateMs:this.updateMs,approximation:'6m grid / <=0.5s cache / finite-difference FFT compression; wind direction follows local offshore gradient'};}
  dispose():void{
    if(this.disposed)return;this.disposed=true;
    this.geometry.dispose();this.material.dispose();this.quadGeometry.dispose();this.sampleMaterial.dispose();
    if(!this.pending)this.target.dispose();this.group.clear();this.scene.clear();this.pixels=null;
  }
}
