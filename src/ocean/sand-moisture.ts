import * as THREE from 'three';
import {sandContactSampling,wetSandUniforms} from '../world/coastal-wet-sand.ts';

/** A local optical history, not soil hydrology or a moving sand bed. RG=damp/film, B=bed, A=valid. */
export class SandMoisture {
  readonly uniforms:Record<string,THREE.IUniform>;
  private readonly targets:THREE.WebGLRenderTarget[];
  private readonly material:THREE.ShaderMaterial;
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));
  private index=0;
  private initialized=false;
  private disposed=false;
  private bathymetry:THREE.Texture|null=null;
  private bathymetryVersion=-1;
  private readonly bathymetryBounds=new THREE.Vector4();
  private readonly bathymetryResolution=new THREE.Vector2();
  private triangulated=-1;
  private elapsed=0;
  private passes=0;
  constructor(private readonly renderer:THREE.WebGLRenderer,readonly resolution=256,readonly span=192){
    if(!Number.isInteger(resolution)||resolution<4||resolution>512||!Number.isFinite(span)||span<=0)throw new RangeError('Bounded moisture grid required');
    this.uniforms={uSandMemoryEnabled:{value:1},uSandMoisture:{value:null},uSandMoistureBounds:{value:new THREE.Vector4()},uSandMoistureResolution:{value:resolution},uSandMoistureReady:{value:0}};
    this.targets=Array.from({length:2},()=>new THREE.WebGLRenderTarget(resolution,resolution,{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false}));
    this.material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{...wetSandUniforms(),uHistory:{value:null},uHistoryBounds:{value:new THREE.Vector4()},uWindow:this.uniforms.uSandMoistureBounds,uInitialized:{value:0},uSeconds:{value:0},uSize:{value:resolution}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:/* glsl */`
      ${sandContactSampling}
      uniform sampler2D uHistory;
      uniform vec4 uHistoryBounds,uWindow;
      uniform float uInitialized,uSeconds,uSize;
      void main(){
        vec2 p=uWindow.xy+gl_FragCoord.xy/uSize*uWindow.zw;
        vec2 buv=(p-uBathyBounds.xy)/uBathyBounds.zw;
        if(any(lessThan(buv,vec2(0)))||any(greaterThan(buv,vec2(1)))){gl_FragColor=vec4(0);return;}
        float bed=sampleCoastalGround(uBathymetry,buv,uBathyResolution).r;
        vec2 oldUV=(p-uHistoryBounds.xy)/uHistoryBounds.zw;
        vec2 memory=vec2(0);
        if(uInitialized>.5&&all(greaterThanEqual(oldUV,vec2(0)))&&all(lessThan(oldUV,vec2(1)))){
          vec4 previous=texture2D(uHistory,oldUV);
          if(previous.a>.5&&abs(previous.b-bed)<.03)memory=previous.rg;
        }
        float contact=sandContact(sandWaterClearance(vec3(p.x,bed,p.y)));
        gl_FragColor=vec4(advanceSandMoisture(memory,contact,uSeconds),bed,1.);
      }`});
    this.quad.material=this.material;this.quad.frustumCulled=false;this.scene.add(this.quad);
  }
  bindUniforms(shared:Record<string,THREE.IUniform>):void {
    for(const name of ['uBathymetry','uBathyBounds','uBathyResolution','uBathyTriangulated','uLongWaves','uShortWaves','uSwell','uChoppiness','uWind','uShoreState','uShoreBounds','uShoreReady','uShoreResolution'])if(shared[name])this.material.uniforms[name]=shared[name];
  }
  update(seconds:number,x:number,z:number):void {
    if(this.disposed||![seconds,x,z].every(Number.isFinite)||seconds<0)return;
    const u=this.material.uniforms;
    if(!this.renderer.extensions.has('EXT_color_buffer_float')||!u.uBathymetry.value||!u.uLongWaves.value||!u.uShortWaves.value){this.reset();return;}
    const bathymetry=u.uBathymetry.value as THREE.Texture,bounds=u.uBathyBounds.value as THREE.Vector4,resolution=u.uBathyResolution.value as THREE.Vector2;
    if(this.bathymetry!==bathymetry||this.bathymetryVersion!==bathymetry.version||!this.bathymetryBounds.equals(bounds)||!this.bathymetryResolution.equals(resolution)||this.triangulated!==u.uBathyTriangulated.value){
      this.reset();this.bathymetry=bathymetry;this.bathymetryVersion=bathymetry.version;this.bathymetryBounds.copy(bounds);this.bathymetryResolution.copy(resolution);this.triangulated=u.uBathyTriangulated.value;
    }
    const window=this.uniforms.uSandMoistureBounds.value as THREE.Vector4,dx=this.span/this.resolution;
    const bx=Math.floor((x-this.span/2)/dx)*dx,bz=Math.floor((z-this.span/2)/dx)*dx;
    if(this.initialized&&seconds===0&&window.x===bx&&window.y===bz)return;
    const previousTarget=this.renderer.getRenderTarget(),xr=this.renderer.xr.enabled;
    try{
      this.renderer.xr.enabled=false;u.uHistoryBounds.value.copy(window);window.set(bx,bz,this.span,this.span);
      u.uInitialized.value=this.initialized?1:0;u.uSeconds.value=seconds;u.uHistory.value=this.targets[this.index].texture;
      this.index=1-this.index;this.renderer.setRenderTarget(this.targets[this.index]);this.renderer.render(this.scene,this.camera);
      this.uniforms.uSandMoisture.value=this.targets[this.index].texture;this.uniforms.uSandMoistureReady.value=1;this.initialized=true;this.elapsed+=seconds;this.passes++;
    }finally{this.renderer.setRenderTarget(previousTarget);this.renderer.xr.enabled=xr;}
  }
  /** Development readback only; normal frames never read the GPU. */
  probe(){
    const data=new Float32Array(this.resolution*this.resolution*4);
    if(this.initialized)this.renderer.readRenderTargetPixels(this.targets[this.index],0,0,this.resolution,this.resolution,data);
    return {data,bounds:(this.uniforms.uSandMoistureBounds.value as THREE.Vector4).toArray(),...this.diagnostics};
  }
  get diagnostics(){return {ready:this.initialized,resolution:this.resolution,span:this.span,elapsed:this.elapsed,passes:this.passes,bytes:2*this.resolution*this.resolution*16,scope:'Local ground-fixed optical dampness/film; authored decay, no soil hydrology, erosion or saved global sediment state'};}
  reset():void {this.initialized=false;this.uniforms.uSandMoistureReady.value=0;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.reset();this.targets.forEach(t=>t.dispose());this.material.dispose();this.quad.geometry.dispose();this.scene.clear();}
}
