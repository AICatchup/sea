import * as THREE from 'three';
import { OceanSimulation } from './fft';
import { environmentFragment, environmentVertex, oceanVertex, oceanFragment, skyVertex, skyFragment } from './shaders';
import { presets, type PresetName } from './presets';
import { IslandWorld } from '../world/terrain';
import { AssetWorld } from '../world/assets';
import { MarineLife } from '../world/marine-life';
import { ExplorerControls } from '../world/explorer-controls';
import { SceneCompositor } from './compositor';
import { prepareWorldMaterials } from './world-materials';
import type { PlaceableKind } from '../world/contracts';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
type Uniforms = Record<string, THREE.IUniform>;

function makeOceanGrid(): THREE.BufferGeometry {
  const rings=230,sectors=384;
  const positions=new Float32Array((rings+1)*(sectors+1)*3);
  const indices=new Uint32Array(rings*sectors*6);
  let v=0,t=0;
  for(let r=0;r<=rings;r++){
    const radius=r===0?0:.12*Math.exp((r/rings)*Math.log(28000/.12));
    for(let s=0;s<=sectors;s++){
      const a=s/sectors*Math.PI*2;
      positions[v++]=Math.cos(a)*radius;positions[v++]=0;positions[v++]=Math.sin(a)*radius;
      if(r<rings&&s<sectors){
        const p=r*(sectors+1)+s,q=p+sectors+1;
        indices[t++]=p;indices[t++]=p+1;indices[t++]=q;
        indices[t++]=p+1;indices[t++]=q+1;indices[t++]=q;
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setIndex(new THREE.BufferAttribute(indices,1));return g;
}

export class Ocean {
  readonly renderer:THREE.WebGLRenderer;
  readonly camera=new THREE.PerspectiveCamera(62,1,.12,35000);
  readonly simulation:OceanSimulation;
  readonly scene=new THREE.Scene();
  readonly waterScene=new THREE.Scene();
  readonly world:IslandWorld;
  readonly assets:AssetWorld;
  readonly marine:MarineLife;
  readonly adventure:ExplorerControls;
  readonly uniforms:Uniforms;
  private readonly compositor:SceneCompositor;
  private readonly sun=new THREE.DirectionalLight(0xfff5df,2.2);
  private readonly fill=new THREE.HemisphereLight(0xb9d9f0,0x666247,.6);
  private readonly pmrem:THREE.PMREMGenerator;
  private readonly environmentTargets=new Map<PresetName,THREE.WebGLRenderTarget>();
  private readonly abort=new AbortController();
  private readonly direction=new THREE.Vector3();
  private readonly target=new THREE.Vector3();
  private readonly materials:THREE.ShaderMaterial[];
  private readonly meshGeometries:THREE.BufferGeometry[];
  private animationFrame=0;
  private disposed=false;
  private contextLost=false;
  private captureNextFrame:((blob:Blob|null)=>void)|null=null;
  private automaticScale=window.innerWidth<650?.78:1;
  private lastStamp=0;
  private measureTime=0;
  private measureFrames=0;
  wind=presets.day.wind;
  swell=presets.day.swell;
  paused=false;
  quality:Quality='auto';
  time=34;
  frames=0;
  fps=60;

  constructor(private readonly canvas:HTMLCanvasElement){
    const context=canvas.getContext('webgl2',{antialias:false,alpha:false,powerPreference:'high-performance'});
    if(!context||!context.getExtension('EXT_color_buffer_float')){
      throw new Error('WebGL 2と浮動小数点テクスチャに対応したGPUが必要です。ブラウザのハードウェアアクセラレーションを確認してください。');
    }
    this.renderer=new THREE.WebGLRenderer({canvas,context,antialias:false,alpha:false});
    this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping=THREE.NoToneMapping;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.info.autoReset=false;
    this.simulation=new OceanSimulation(this.renderer,this.wind);
    this.world=new IslandWorld();
    this.assets=new AssetWorld(this.world);
    this.marine=new MarineLife(this.world);
    this.adventure=new ExplorerControls(canvas,this.world,this.world.destinations,this.world.spawnPoint);
    const p=presets.day;
    this.uniforms={
      uTime:{value:this.time},uSunDirection:{value:new THREE.Vector3(...p.sun).normalize()},
      uSunColor:{value:new THREE.Vector3(...p.sunColor)},uZenith:{value:new THREE.Vector3(...p.zenith)},
      uHorizon:{value:new THREE.Vector3(...p.horizon)},uCloudColor:{value:new THREE.Vector3(...p.cloud)},
      uWaterTint:{value:new THREE.Vector3(...p.water)},uCloudCoverage:{value:p.coverage},
      uExposure:{value:p.exposure},uStorm:{value:p.storm},uLongWaves:{value:null},uShortWaves:{value:null},
      uSwell:{value:this.swell},uChoppiness:{value:1.55},uWind:{value:this.wind},
      uCameraWorld:{value:this.camera.matrixWorld},uInverseProjection:{value:this.camera.projectionMatrixInverse},
      uBathymetry:{value:null},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},
      uSceneColor:{value:null},uSceneDepth:{value:null},uResolution:{value:new THREE.Vector2()},
      uNearFar:{value:new THREE.Vector2(this.camera.near,this.camera.far)},uUnderwater:{value:0},
    };
    this.compositor=new SceneCompositor(this.renderer,this.uniforms.uExposure,this.uniforms.uUnderwater,this.uniforms.uTime);
    this.uniforms.uSceneColor.value=this.compositor.landTarget.texture;
    this.uniforms.uSceneDepth.value=this.compositor.landTarget.depthTexture;
    const skyMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:skyVertex,fragmentShader:skyFragment,
      depthTest:false,depthWrite:false,toneMapped:false});
    const skyGeometry=new THREE.PlaneGeometry(2,2);
    const sky=new THREE.Mesh(skyGeometry,skyMat);sky.frustumCulled=false;sky.renderOrder=-10;this.scene.add(sky);
    const seaMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:oceanVertex,fragmentShader:oceanFragment,
      side:THREE.DoubleSide,toneMapped:false});
    const seaGeometry=makeOceanGrid();
    const sea=new THREE.Mesh(seaGeometry,seaMat);sea.frustumCulled=false;this.waterScene.add(sea);
    this.materials=[skyMat,seaMat];this.meshGeometries=[skyGeometry,seaGeometry];
    this.scene.add(this.world.group,this.assets.group,this.marine.group,this.sun,this.sun.target,this.fill);
    prepareWorldMaterials(this.world.group,this.uniforms.uTime);
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime);
    prepareWorldMaterials(this.marine.group,this.uniforms.uTime);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:1,far:1500});
    this.sun.shadow.bias=-.00012;this.sun.shadow.normalBias=.15;
    this.scene.fog=new THREE.FogExp2(new THREE.Color().setRGB(...p.horizon),.000028);
    this.pmrem=new THREE.PMREMGenerator(this.renderer);
    this.listen();this.resize();this.refreshEnvironment('day');
    this.simulation.advance(this.time,0,this.swell,1.55);
    this.frame(0);
  }

  private refreshEnvironment(name:PresetName):void{
    let target=this.environmentTargets.get(name);
    if(!target){
      const envScene=new THREE.Scene();
      const geometry=new THREE.SphereGeometry(1,24,16);
      const material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:environmentVertex,
        fragmentShader:environmentFragment,side:THREE.BackSide,depthWrite:false,toneMapped:false});
      const sphere=new THREE.Mesh(geometry,material);envScene.add(sphere);
      const cube=new THREE.WebGLCubeRenderTarget(64,{type:THREE.HalfFloatType,generateMipmaps:false});
      const cam=new THREE.CubeCamera(.05,10,cube);
      const previous=this.renderer.getRenderTarget();
      cam.update(this.renderer,envScene);target=this.pmrem.fromCubemap(cube.texture);
      this.environmentTargets.set(name,target);
      cube.dispose();geometry.dispose();material.dispose();this.renderer.setRenderTarget(previous);
    }
    this.scene.environment=target.texture;this.scene.environmentIntensity=.45;
  }

  private listen():void{
    const options={signal:this.abort.signal};
    window.addEventListener('resize',()=>this.resize(),options);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){cancelAnimationFrame(this.animationFrame);this.lastStamp=0;this.captureNextFrame?.(null);this.captureNextFrame=null;}
      else if(!this.disposed&&!this.contextLost){this.lastStamp=0;this.animationFrame=requestAnimationFrame(this.frame);}
    },options);
    this.canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();this.contextLost=true;cancelAnimationFrame(this.animationFrame);
      this.captureNextFrame?.(null);this.captureNextFrame=null;
      window.dispatchEvent(new CustomEvent('ocean-error',{detail:'GPUとの接続が中断されました。ページを再読み込みしてください。'}));
    },options);
  }

  private frame=(stamp:number):void=>{
    if(this.disposed||this.contextLost)return;
    const elapsed=this.lastStamp===0?1/60:(stamp-this.lastStamp)/1000;
    const delta=Math.min(elapsed,.05);this.lastStamp=stamp;
    if(!this.paused){
      this.time+=delta;
      this.simulation.advance(this.time,delta,this.swell,this.uniforms.uChoppiness.value);
    }
    // Reduced ambient motion never prevents intentional walking or looking.
    this.adventure.update(delta,this.time);
    const state=this.adventure.state;
    this.camera.position.copy(state.position);
    this.direction.set(Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch),-Math.cos(state.yaw)*Math.cos(state.pitch));
    this.target.copy(this.camera.position).add(this.direction);this.camera.lookAt(this.target);this.camera.updateMatrixWorld();
    this.assets.boat.position.copy(state.boatPosition);this.assets.boat.rotation.y=-state.boatYaw;
    const underwater=THREE.MathUtils.clamp(-this.camera.position.y/.18,0,1);
    this.uniforms.uUnderwater.value=underwater;
    this.world.update(this.time);this.assets.update(this.time,this.camera.position,underwater>.5);
    this.marine.update(this.time,this.camera.position,underwater>.5);
    const waterMap=this.world.waterMapFor(this.camera.position.x,this.camera.position.z);
    this.uniforms.uBathymetry.value=waterMap.texture;
    this.uniforms.uBathyBounds.value.set(waterMap.origin.x,waterMap.origin.y,waterMap.size.x,waterMap.size.y);
    const image=waterMap.texture.image as {width:number;height:number};
    this.uniforms.uBathyResolution.value.set(image.width,image.height);
    const textures=this.simulation.textures;this.uniforms.uLongWaves.value=textures[0];this.uniforms.uShortWaves.value=textures[1];
    this.uniforms.uTime.value=this.time;this.uniforms.uSwell.value=this.swell;this.uniforms.uWind.value=this.wind;
    this.sun.position.copy(this.camera.position).addScaledVector(this.uniforms.uSunDirection.value,650);
    this.sun.target.position.copy(this.camera.position);
    const luminance=(this.uniforms.uSunColor.value as THREE.Vector3).length();
    this.sun.intensity=luminance*.40*(1-.68*this.uniforms.uStorm.value);
    this.fill.intensity=.26+this.uniforms.uExposure.value*.18;
    if(this.frames%4===0)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.info.reset();
    this.compositor.render(this.scene,this.waterScene,this.camera);this.frames++;
    if(this.captureNextFrame){this.canvas.toBlob(this.captureNextFrame,'image/png');this.captureNextFrame=null;}
    this.measureTime+=elapsed;this.measureFrames++;
    if(this.measureTime>=2.5){
      this.fps=this.measureFrames/this.measureTime;
      if(this.quality==='auto'&&this.frames>80){
        if(this.fps<28&&this.automaticScale>.5){this.automaticScale=Math.max(.5,this.automaticScale*.82);this.resize();}
        else if(this.fps>56&&this.automaticScale<1){this.automaticScale=Math.min(1,this.automaticScale+.07);this.resize();}
      }
      this.measureTime=0;this.measureFrames=0;
    }
    this.animationFrame=requestAnimationFrame(this.frame);
  };

  resize():void{
    const width=window.innerWidth,height=window.innerHeight;
    const scale={auto:this.automaticScale,high:1.18,medium:.85,low:.55}[this.quality];
    const ratio=Math.min(window.devicePixelRatio,1.65)*scale;
    const budget=this.quality==='high'?4200000:2300000;
    this.renderer.setPixelRatio(Math.min(ratio,Math.sqrt(budget/(width*height))));
    this.renderer.setSize(width,height,false);this.compositor.resize(this.canvas.width,this.canvas.height);
    this.uniforms.uResolution.value.set(this.canvas.width,this.canvas.height);
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  }
  setQuality(quality:Quality):void{this.quality=quality;this.resize();}
  setWind(wind:number):void{this.wind=THREE.MathUtils.clamp(wind,2,18);this.simulation.setWind(this.wind);if(this.paused)this.simulation.advance(this.time,0,this.swell,1.55);}
  setSwell(swell:number):void{this.swell=THREE.MathUtils.clamp(swell,.3,2);if(this.paused)this.simulation.advance(this.time,0,this.swell,1.55);}
  setPreset(name:PresetName):void{
    const p=presets[name];this.setWind(p.wind);this.setSwell(p.swell);
    for(const [key,value] of Object.entries({uSunDirection:p.sun,uSunColor:p.sunColor,uZenith:p.zenith,uHorizon:p.horizon,uCloudColor:p.cloud,uWaterTint:p.water})){
      this.uniforms[key].value.set(...value);
    }
    this.uniforms.uSunDirection.value.normalize();this.uniforms.uCloudCoverage.value=p.coverage;
    this.uniforms.uExposure.value=p.exposure;this.uniforms.uStorm.value=p.storm;
    if(this.scene.fog instanceof THREE.FogExp2){this.scene.fog.color.setRGB(...p.horizon);this.scene.fog.density=.000028+.00009*p.storm;}
    this.refreshEnvironment(name);
  }
  resetView():void{this.adventure.home();}
  place(kind:PlaceableKind):void{
    const state=this.adventure.state;
    const x=state.position.x+Math.sin(state.yaw)*8,z=state.position.z-Math.cos(state.yaw)*8;
    this.assets.place(kind,x,z,state.yaw);
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime);
  }
  capture():Promise<Blob|null>{
    if(this.disposed||this.contextLost||document.hidden)return Promise.resolve(null);
    this.captureNextFrame?.(null);return new Promise(resolve=>{this.captureNextFrame=resolve;});
  }
  get diagnostics(){
    const state=this.adventure.state;
    return {time:this.time,frames:this.frames,fps:Number(this.fps.toFixed(1)),paused:this.paused,wind:this.wind,swell:this.swell,quality:this.quality,
      resolution:[this.canvas.width,this.canvas.height],camera:{yaw:state.yaw,pitch:state.pitch,height:state.position.y,x:state.position.x,z:state.position.z},
      adventure:{mode:state.mode,depth:state.depth,oxygen:state.oxygen,speed:state.speed,placed:this.assets.placedCount,
        voyage:state.voyageTarget,remaining:state.voyageRemaining,message:state.message},
      ground:this.world.heightAt(state.position.x,state.position.z),programs:this.renderer.info.programs?.length,
      draws:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animationFrame);this.abort.abort();
    this.captureNextFrame?.(null);this.captureNextFrame=null;
    this.adventure.dispose();this.assets.dispose();this.marine.dispose();this.world.dispose();this.simulation.dispose();
    this.materials.forEach(m=>m.dispose());this.meshGeometries.forEach(g=>g.dispose());
    this.environmentTargets.forEach(t=>t.dispose());this.pmrem.dispose();this.sun.shadow.dispose();this.compositor.dispose();this.renderer.dispose();
  }
}
