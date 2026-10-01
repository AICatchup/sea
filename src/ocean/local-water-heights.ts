import * as THREE from 'three';
import { shoreWaveSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
type Uniforms = Record<string, THREE.IUniform>;

/** Same finite wave-height envelope as ExplorerControls.waterAt, including the
 * camera's actual eye/bob height. Mean sea level is only the missing-sample fallback. */
export function cameraSubmersion(eyeY:number,surfaceY:number):number{
  if(!Number.isFinite(eyeY))return 0;
  const water=Number.isFinite(surfaceY)?THREE.MathUtils.clamp(surfaceY,-4,4):0;
  return THREE.MathUtils.clamp((water-eyeY)/.18,0,1);
}

/** Two 14m local patches, 128 GPU samples / 512 bytes, asynchronously at 5Hz.
 * This is the actual FFT height with choppy XZ inversion and coastal shelter.
 * It does not read either full simulation texture or stall every frame.
 */
export class LocalWaterHeights {
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly target=new THREE.WebGLRenderTarget(8,16,{depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  private readonly geometry=new THREE.PlaneGeometry(2,2);
  private readonly material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0,1);}',fragmentShader:/* glsl */`
      precision highp float;
      uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
      uniform vec4 uBathyBounds;uniform vec2 uBathyResolution,uPlayer,uBoat;
      uniform float uSwell,uChoppiness,uWind;
      ${shoreWaveSampling}
      ${shoreSolverSampling}
      vec3 displacement(vec2 p){
        vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;vec2 coast=vec2(-110,1);
        if(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)))){
          coast=sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;
        }
        float shelter=shoreWaveScale(coast,uSwell,uWind);
        return (texture2D(uLongWaves,p/384.0).xyz+texture2D(uShortWaves,p/24.0).xyz)*shelter*uSwell;
      }
      void main(){
        vec2 center=gl_FragCoord.y<8.0?uPlayer:uBoat;
        vec2 world=center+(vec2(gl_FragCoord.x,mod(gl_FragCoord.y,8.0))-.5-3.5)*2.0;
        vec2 parameter=world;
        for(int i=0;i<3;i++)parameter=world-displacement(parameter).xz*uChoppiness;
        float h=shoreSolvedSurface(world,displacement(parameter).y,0.).x;
        float code=floor(clamp(h/16.0+.5,0.0,1.0)*65535.0+.5);
        gl_FragColor=vec4(floor(code/256.0),mod(code,256.0),137.0,255.0)/255.0;
      }`,uniforms:{...createShoreSolverUniforms(),uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},
        uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},
        uPlayer:{value:new THREE.Vector2()},uBoat:{value:new THREE.Vector2()},uSwell:{value:1},uChoppiness:{value:1.55},uWind:{value:8.5}}});
  private pixels:Uint8Array|null=null;
  private readonly origins=[new THREE.Vector2(),new THREE.Vector2()];
  private pending=false;
  private lastUpdate=-Infinity;
  private sampleTime=-Infinity;
  private latestClock=-Infinity;
  private disposed=false;
  failed=false;
  private readonly renderer:THREE.WebGLRenderer;
  constructor(renderer:THREE.WebGLRenderer){
    this.renderer=renderer;
    const quad=new THREE.Mesh(this.geometry,this.material);quad.frustumCulled=false;this.scene.add(quad);
  }
  sample=(x:number,z:number):number=>{
    if(!this.pixels||!Number.isFinite(x)||!Number.isFinite(z))return 0;
    for(let patch=0;patch<2;patch++){
      const px=(x-this.origins[patch].x)/2+3.5,pz=(z-this.origins[patch].y)/2+3.5;
      if(px<0||px>7||pz<0||pz>7)continue;
      const x0=Math.min(6,Math.floor(px)),z0=Math.min(6,Math.floor(pz)),fx=px-x0,fz=pz-z0;
      const at=(xx:number,zz:number)=>{const i=((zz+patch*8)*8+xx)*4;return (this.pixels![i]*256+this.pixels![i+1])/65535*16-8;};
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(x0,z0),at(x0+1,z0),fx),
        THREE.MathUtils.lerp(at(x0,z0+1),at(x0+1,z0+1),fx),fz);
    }
    return 0;
  };
  update(clock:number,textures:THREE.Texture[],bathymetry:{texture:THREE.Texture;origin:THREE.Vector2;size:THREE.Vector2;triangulated?:boolean},
    player:THREE.Vector3,boat:THREE.Vector3,swell:number,choppiness:number,wind:number):void{
    if(!Number.isFinite(clock)||this.disposed)return;
    if(clock<this.latestClock){this.pixels=null;this.lastUpdate=-Infinity;}
    this.latestClock=clock;
    if(clock-this.sampleTime>.5)this.pixels=null;
    if(this.pending||this.failed||clock-this.lastUpdate<.2)return;
    this.lastUpdate=clock;this.pending=true;
    const u=this.material.uniforms,origins=[new THREE.Vector2(player.x,player.z),new THREE.Vector2(boat.x,boat.z)];
    u.uPlayer.value.copy(origins[0]);u.uBoat.value.copy(origins[1]);u.uLongWaves.value=textures[0];u.uShortWaves.value=textures[1];
    u.uBathymetry.value=bathymetry.texture;u.uBathyBounds.value.set(bathymetry.origin.x,bathymetry.origin.y,bathymetry.size.x,bathymetry.size.y);
    const image=bathymetry.texture.image as {width:number;height:number};u.uBathyResolution.value.set(image.width,image.height);
    u.uBathyTriangulated.value=bathymetry.triangulated?1:0;u.uSwell.value=swell;u.uChoppiness.value=choppiness;u.uWind.value=wind;
    const previous=this.renderer.getRenderTarget();
    let readback:Promise<Uint8Array>;
    try{
      try{this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);}
      finally{this.renderer.setRenderTarget(previous);}
      readback=this.renderer.readRenderTargetPixelsAsync(this.target,0,0,8,16,new Uint8Array(512)) as Promise<Uint8Array>;
    }catch(error){this.pending=false;this.fail(error);return;}
    void readback.then(pixels=>{
      if(this.disposed||this.latestClock-clock>.5||this.latestClock<clock)return;
      if(!(pixels instanceof Uint8Array)||pixels.length!==512||pixels.some((value,i)=>i%4===2&&value!==137)){
        throw new Error('Uninitialized FFT height framebuffer');
      }
      this.pixels=pixels;this.sampleTime=clock;this.origins[0].copy(origins[0]);this.origins[1].copy(origins[1]);
    }).catch(error=>{if(!this.disposed)this.fail(error);})
      .finally(()=>{this.pending=false;if(this.disposed)this.target.dispose();});
  }
  private fail(error:unknown):void{
    this.failed=true;this.pixels=null;
    console.warn('FFT surface-height cache unavailable; mean sea level retained',error);
  }
  get diagnostics(){return {ready:!!this.pixels,failed:this.failed,samples:128,interval:.2,readbackBytes:512};}
  bindShore(uniforms:Uniforms):void {for(const key of ['uShoreState','uShoreBounds','uShoreReady','uShoreResolution'])if(uniforms[key])this.material.uniforms[key]=uniforms[key];}
  dispose():void{
    if(this.disposed)return;
    this.disposed=true;this.pixels=null;
    if(!this.pending)this.target.dispose();
    this.geometry.dispose();this.material.dispose();this.scene.clear();
  }
}

