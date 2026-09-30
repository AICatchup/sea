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
import { Reflector } from 'three/addons/objects/Reflector.js';
import { WaveCaustics } from './caustics';
import { loadPhotographicSky } from './photographic-sky';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FirstPersonBody } from '../world/player-body';
import { shoreWaveSampling } from './surface-detail';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
type Uniforms = Record<string, THREE.IUniform>;

/** Two 14m local patches, 128 GPU samples / 512 bytes, asynchronously at 5Hz.
 * This is the actual FFT height with choppy XZ inversion and coastal shelter.
 * It does not read either full simulation texture or stall every frame.
 */
class LocalWaterHeights {
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
      vec3 displacement(vec2 p){
        vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;vec2 coast=vec2(-110,1);
        if(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)))){
          uv=uv*(uBathyResolution-1.0)/uBathyResolution+.5/uBathyResolution;coast=texture2D(uBathymetry,uv).rg;
        }
        float shelter=shoreWaveScale(coast,uSwell,uWind);
        return (texture2D(uLongWaves,p/384.0).xyz+texture2D(uShortWaves,p/24.0).xyz)*shelter*uSwell;
      }
      void main(){
        vec2 center=gl_FragCoord.y<8.0?uPlayer:uBoat;
        vec2 world=center+(vec2(gl_FragCoord.x,mod(gl_FragCoord.y,8.0))-.5-3.5)*2.0;
        vec2 parameter=world;
        for(int i=0;i<3;i++)parameter=world-displacement(parameter).xz*uChoppiness;
        float h=displacement(parameter).y;
        float code=floor(clamp(h/16.0+.5,0.0,1.0)*65535.0+.5);
        gl_FragColor=vec4(floor(code/256.0),mod(code,256.0),0.0,255.0)/255.0;
      }`,uniforms:{uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},
        uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},
        uPlayer:{value:new THREE.Vector2()},uBoat:{value:new THREE.Vector2()},uSwell:{value:1},uChoppiness:{value:1.55},uWind:{value:8.5}}});
  private pixels:Uint8Array|null=null;
  private readonly origins=[new THREE.Vector2(),new THREE.Vector2()];
  private pending=false;
  private lastUpdate=-Infinity;
  private disposed=false;
  failed=false;
  constructor(private readonly renderer:THREE.WebGLRenderer){
    const quad=new THREE.Mesh(this.geometry,this.material);quad.frustumCulled=false;this.scene.add(quad);
  }
  sample=(x:number,z:number):number=>{
    if(!this.pixels)return 0;
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
  update(clock:number,textures:THREE.Texture[],bathymetry:{texture:THREE.Texture;origin:THREE.Vector2;size:THREE.Vector2},
    player:THREE.Vector3,boat:THREE.Vector3,swell:number,choppiness:number,wind:number):void{
    if(this.pending||this.failed||this.disposed||clock-this.lastUpdate<.2)return;
    this.lastUpdate=clock;this.pending=true;
    const u=this.material.uniforms,origins=[new THREE.Vector2(player.x,player.z),new THREE.Vector2(boat.x,boat.z)];
    u.uPlayer.value.copy(origins[0]);u.uBoat.value.copy(origins[1]);u.uLongWaves.value=textures[0];u.uShortWaves.value=textures[1];
    u.uBathymetry.value=bathymetry.texture;u.uBathyBounds.value.set(bathymetry.origin.x,bathymetry.origin.y,bathymetry.size.x,bathymetry.size.y);
    const image=bathymetry.texture.image as {width:number;height:number};u.uBathyResolution.value.set(image.width,image.height);
    u.uSwell.value=swell;u.uChoppiness.value=choppiness;u.uWind.value=wind;
    const previous=this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(previous);
    void this.renderer.readRenderTargetPixelsAsync(this.target,0,0,8,16,new Uint8Array(512)).then(pixels=>{
      if(this.disposed)return;
      this.pixels=pixels as Uint8Array;this.origins[0].copy(origins[0]);this.origins[1].copy(origins[1]);
    }).catch(error=>{this.failed=true;console.warn('FFT surface-height cache unavailable; mean sea level retained',error);})
      .finally(()=>{this.pending=false;});
  }
  get diagnostics(){return {ready:!!this.pixels,failed:this.failed,samples:128,interval:.2,readbackBytes:512};}
  dispose():void{this.disposed=true;this.target.dispose();this.geometry.dispose();this.material.dispose();this.scene.clear();}
}

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
  readonly body=new FirstPersonBody();
  readonly uniforms:Uniforms;
  readonly ready:Promise<void>;
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
  private readonly reflection=new Reflector(new THREE.PlaneGeometry(2,2),{textureWidth:512,textureHeight:320,multisample:0,clipBias:.001});
  private readonly reflectionMatrix=new THREE.Matrix4();
  private readonly reflectionBias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
  private readonly reflectionContext=new THREE.Group();
  private readonly scannedCoast=new THREE.Group();
  private readonly scannedCoastInstances:THREE.InstancedMesh[]=[];
  private readonly reefGeometries:THREE.BufferGeometry[]=[];
  private readonly caustics:WaveCaustics;
  private readonly waterHeights:LocalWaterHeights;
  private photographicSky:Awaited<ReturnType<typeof loadPhotographicSky>>|null=null;
  private currentPreset:PresetName='day';
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
    this.waterHeights=new LocalWaterHeights(this.renderer);
    this.world=new IslandWorld();
    this.assets=new AssetWorld(this.world);
    this.marine=new MarineLife(this.world);
    this.adventure=new ExplorerControls(canvas,this.world,this.world.destinations,this.world.spawnPoint);
    (this.adventure as ExplorerControls&{setWaterHeightSampler?:(sample:(x:number,z:number)=>number)=>void})
      .setWaterHeightSampler?.(this.waterHeights.sample);
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
      uSceneColor:{value:null},uSceneDepth:{value:null},uSceneOcclusion:{value:null},uResolution:{value:new THREE.Vector2()},
      uNearFar:{value:new THREE.Vector2(this.camera.near,this.camera.far)},uUnderwater:{value:0},
      uReflection:{value:this.reflection.getRenderTarget().texture},uReflectionMatrix:{value:this.reflectionMatrix},uHasReflection:{value:0},
      uReflectionResolution:{value:new THREE.Vector2(512,320)},
      uCaustics:{value:null},uCausticBounds:{value:new THREE.Vector4()},
      uSkyTexture:{value:null},uSkyRotation:{value:0},uSkyExposure:{value:1},uUseSky:{value:0},
    };
    this.caustics=new WaveCaustics(this.renderer,{span:32});
    this.uniforms.uCaustics.value=this.caustics.texture;this.uniforms.uCausticBounds.value=this.caustics.bounds;
    this.compositor=new SceneCompositor(this.renderer,this.uniforms.uExposure,this.uniforms.uUnderwater,this.uniforms.uTime);
    this.compositor.setWaterOptics(this.camera,this.sun,this.uniforms.uSunDirection,this.uniforms.uSunColor);
    Object.assign(this.uniforms,this.compositor.shadowUniforms);
    this.uniforms.uSceneColor.value=this.compositor.landTarget.texture;
    this.uniforms.uSceneDepth.value=this.compositor.landTarget.depthTexture;
    this.uniforms.uSceneOcclusion.value=this.compositor.occlusionTarget.texture;
    const skyMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:skyVertex,fragmentShader:skyFragment,
      depthTest:false,depthWrite:false,toneMapped:false});
    const skyGeometry=new THREE.PlaneGeometry(2,2);
    const sky=new THREE.Mesh(skyGeometry,skyMat);sky.frustumCulled=false;sky.renderOrder=-10;
    sky.onBeforeRender=(_renderer,_scene,viewCamera)=>{
      this.uniforms.uCameraWorld.value=viewCamera.matrixWorld;
      this.uniforms.uInverseProjection.value=viewCamera.projectionMatrixInverse;
    };
    this.scene.add(sky);
    const seaMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:oceanVertex,fragmentShader:oceanFragment,
      side:THREE.DoubleSide,toneMapped:false});
    const seaGeometry=makeOceanGrid();
    const sea=new THREE.Mesh(seaGeometry,seaMat);sea.frustumCulled=false;this.waterScene.add(sea);
    this.materials=[skyMat,seaMat];this.meshGeometries=[skyGeometry,seaGeometry];
    this.scene.add(this.world.group,this.assets.group,this.marine.group,this.body.group,this.sun,this.sun.target,this.fill);
    this.scene.add(this.scannedCoast);
    prepareWorldMaterials(this.world.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    prepareWorldMaterials(this.marine.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:1,far:1500});
    this.sun.shadow.bias=-.00012;this.sun.shadow.normalBias=.075;this.sun.shadow.radius=.85;
    prepareWorldMaterials(this.body.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    this.scene.fog=new THREE.FogExp2(new THREE.Color().setRGB(...p.horizon),.000028);
    this.pmrem=new THREE.PMREMGenerator(this.renderer);
    const reflectionTexture=this.reflection.getRenderTarget().texture;
    reflectionTexture.generateMipmaps=true;reflectionTexture.minFilter=THREE.LinearMipmapLinearFilter;
    this.reflection.rotation.x=-Math.PI/2;this.reflection.updateMatrixWorld(true);
    this.listen();this.resize();this.refreshEnvironment('day');
    this.simulation.advance(this.time,0,this.swell,1.55);
    this.frame(0);
    const marineReady=this.marine.ready.then(()=>{
      if(this.disposed)return;
      prepareWorldMaterials(this.marine.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    });
    const coastReady=this.marine.rockLibrary.ready.then(variants=>{
      if(this.disposed)return;
      this.assets.hydrateRockPlacements(variants);
      prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
      let seed=31851;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const helper=new THREE.Object3D();
      for(const variant of variants){
        const matrices:THREE.Matrix4[]=[];
        for(let attempt=0;attempt<900&&matrices.length<(variant.kind==='shelf'?30:20);attempt++){
          const x=-260+random()*470,z=-230+random()*340,h=this.world.heightAt(x,z);
          const dx=(this.world.heightAt(x+1,z)-this.world.heightAt(x-1,z))*.5;
          const dz=(this.world.heightAt(x,z+1)-this.world.heightAt(x,z-1))*.5;
          const slope=Math.hypot(dx,dz);
          if(h<.2||h>24||slope<.4||slope>2.4)continue;
          const s=variant.kind==='shelf'?.55+random()*.70:.7+random()*1.4;
          const normal=new THREE.Vector3(-dx,1,-dz).normalize();
          helper.position.set(x,h,z).addScaledVector(normal,variant.kind==='shelf'?-.85*s:-.45*s);helper.scale.set(s,.85*s,s);
          helper.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
          helper.rotateY(random()*Math.PI*2);helper.updateMatrix();matrices.push(helper.matrix.clone());
        }
        if(variant.kind==='shelf'){
          const patches:THREE.BufferGeometry[]=[];
          for(const [x,z] of [[-138,-119],[-147,-125],[-157,-117],[-130,-132],[-167,-137],[-155,-150]]){
            const px=x+(random()-.5)*5,pz=z+(random()-.5)*5,h=this.world.heightAt(px,pz),s=.70+random()*.35;
            if(h> -3.8||h< -16)continue;
            helper.position.set(px,h-.20,pz);helper.scale.set(s,.5*s,s);
            helper.rotation.set((random()-.5)*.08,random()*Math.PI*2,(random()-.5)*.08);
            helper.updateMatrix();
            const patch=variant.geometry.clone(),source=variant.geometry.getAttribute('position');
            patch.applyMatrix4(helper.matrix);
            const vertices=patch.getAttribute('position');
            for(let i=0;i<vertices.count;i++){
              const vx=vertices.getX(i),vz=vertices.getZ(i);
              vertices.setY(i,this.world.heightAt(vx,vz)-.30+source.getY(i)*s*.5);
            }
            patch.computeVertexNormals();patches.push(patch);
          }
          if(patches.length){
            const geometry=mergeGeometries(patches,false)!;patches.forEach(patch=>patch.dispose());
            geometry.computeBoundingSphere();this.reefGeometries.push(geometry);
            const reef=new THREE.Mesh(geometry,variant.material);reef.name='Ground-conforming scanned rocky habitat '+variant.id;
            reef.castShadow=reef.receiveShadow=true;this.scannedCoast.add(reef);
          }
        }
        if(!matrices.length)continue;
        const instances=new THREE.InstancedMesh(variant.geometry,variant.material,matrices.length);
        matrices.forEach((matrix,index)=>instances.setMatrixAt(index,matrix));
        instances.name='Photo-scanned cliff outcrops '+variant.id;instances.castShadow=true;instances.receiveShadow=true;
        instances.computeBoundingSphere();this.scannedCoastInstances.push(instances);this.scannedCoast.add(instances);
      }
      prepareWorldMaterials(this.scannedCoast,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    });
    const skyReady=loadPhotographicSky(1.70).then(sky=>{
      if(this.disposed){sky.texture.dispose();return;}
      this.photographicSky=sky;
      this.uniforms.uSkyTexture.value=sky.texture;this.uniforms.uSkyRotation.value=sky.rotation;this.uniforms.uSkyExposure.value=sky.exposure;
      if(this.currentPreset==='day'){
        this.uniforms.uUseSky.value=1;this.uniforms.uSunDirection.value.copy(sky.sun);
        this.environmentTargets.get('day')?.dispose();this.environmentTargets.delete('day');this.refreshEnvironment('day');
      }
    }).catch(error=>console.warn('Photographic sky unavailable; procedural atmosphere retained',error));
    const worldReady=this.world.ready.then(()=>{
      if(!this.disposed)prepareWorldMaterials(this.world.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    });
    const assetReady=((this.assets as AssetWorld&{ready?:Promise<unknown>}).ready??Promise.resolve()).then(()=>{
      if(!this.disposed)prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    });
    this.ready=Promise.allSettled([worldReady,assetReady,marineReady,coastReady,skyReady]).then(results=>{
      for(const result of results)if(result.status==='rejected')console.warn('A photographic asset could not load',result.reason);
    });
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
    this.scene.environment=target.texture;this.scene.environmentIntensity=.48;
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
    this.adventure.update(delta,this.time,this.paused);
    const state=this.adventure.state;
    this.camera.position.copy(state.position);
    if(state.viewOffset)this.camera.position.add(state.viewOffset);
    this.direction.set(Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch),-Math.cos(state.yaw)*Math.cos(state.pitch));
    this.target.copy(this.camera.position).add(this.direction);this.camera.lookAt(this.target);this.camera.updateMatrixWorld();
    this.assets.boat.position.copy(state.boatPosition);
    this.assets.boat.rotation.set(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ');
    this.body.update(state,this.camera,delta,this.time);
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
    this.waterHeights.update(stamp*.001,textures,waterMap,state.position,state.boatPosition,this.swell,this.uniforms.uChoppiness.value,this.wind);
    this.caustics.update(this.time,this.paused?0:delta,textures[0],textures[1],waterMap,this.camera.position,this.uniforms.uSunDirection.value,this.swell,this.wind,1.55);
    this.uniforms.uCaustics.value=this.caustics.texture;
    this.uniforms.uTime.value=this.time;this.uniforms.uSwell.value=this.swell;this.uniforms.uWind.value=this.wind;
    this.sun.position.copy(this.camera.position).addScaledVector(this.uniforms.uSunDirection.value,650);
    this.sun.target.position.copy(this.camera.position);
    const solarColor=this.uniforms.uSunColor.value as THREE.Vector3;
    const solarMaximum=Math.max(solarColor.x,solarColor.y,solarColor.z);
    this.sun.color.setRGB(solarColor.x/solarMaximum,solarColor.y/solarMaximum,solarColor.z/solarMaximum);
    this.sun.intensity=solarMaximum*1.05*(1-.62*this.uniforms.uStorm.value);
    this.fill.intensity=.17+.20*this.uniforms.uStorm.value;
    if(this.frames%4===0)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.info.reset();
    if(underwater<.5&&this.frames%3===0){
      this.renderer.setClearColor(0,1);
      this.reflection.onBeforeRender(this.renderer,this.scene,this.camera,this.reflection.geometry,this.reflection.material as THREE.Material,this.reflectionContext);
      const reflectedCamera=this.reflection.getReflectionCamera(this.camera);
      this.reflectionMatrix.copy(this.reflectionBias).multiply(reflectedCamera.projectionMatrix).multiply(reflectedCamera.matrixWorldInverse);
      this.uniforms.uHasReflection.value=1;
    }
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
    const scale={auto:this.automaticScale,high:1,medium:.85,low:.55}[this.quality];
    const ratio=Math.min(window.devicePixelRatio,this.quality==='high'?1:1.65)*scale;
    const budget=this.quality==='high'?4200000:2300000;
    this.renderer.setPixelRatio(Math.min(ratio,Math.sqrt(budget/(width*height))));
    this.renderer.setSize(width,height,false);this.compositor.resize(this.canvas.width,this.canvas.height);
    const reflectionWidth=Math.max(192,Math.round(this.canvas.width*.42)),reflectionHeight=Math.max(128,Math.round(this.canvas.height*.42));
    this.reflection.getRenderTarget().setSize(reflectionWidth,reflectionHeight);
    this.uniforms.uReflectionResolution.value.set(reflectionWidth,reflectionHeight);
    this.uniforms.uResolution.value.set(this.canvas.width,this.canvas.height);
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  }
  setQuality(quality:Quality):void{this.quality=quality;this.resize();}
  setWind(wind:number):void{this.wind=THREE.MathUtils.clamp(wind,2,18);this.simulation.setWind(this.wind);if(this.paused)this.simulation.advance(this.time,0,this.swell,1.55);}
  setSwell(swell:number):void{this.swell=THREE.MathUtils.clamp(swell,.3,2);if(this.paused)this.simulation.advance(this.time,0,this.swell,1.55);}
  setPreset(name:PresetName):void{
    this.currentPreset=name;this.uniforms.uUseSky.value=name==='day'&&this.photographicSky?1:0;
    const p=presets[name];this.setWind(p.wind);this.setSwell(p.swell);
    for(const [key,value] of Object.entries({uSunDirection:p.sun,uSunColor:p.sunColor,uZenith:p.zenith,uHorizon:p.horizon,uCloudColor:p.cloud,uWaterTint:p.water})){
      this.uniforms[key].value.set(...value);
    }
    this.uniforms.uSunDirection.value.normalize();this.uniforms.uCloudCoverage.value=p.coverage;
    if(name==='day'&&this.photographicSky)this.uniforms.uSunDirection.value.copy(this.photographicSky.sun);
    this.uniforms.uExposure.value=p.exposure;this.uniforms.uStorm.value=p.storm;
    if(this.scene.fog instanceof THREE.FogExp2){this.scene.fog.color.setRGB(...p.horizon);this.scene.fog.density=.000028+.00009*p.storm;}
    this.refreshEnvironment(name);
  }
  resetView():void{this.adventure.home();}
  place(kind:PlaceableKind):void{
    const state=this.adventure.state;
    const x=state.position.x+Math.sin(state.yaw)*8,z=state.position.z-Math.cos(state.yaw)*8;
    this.assets.place(kind,x,z,state.yaw);
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
  }
  capture():Promise<Blob|null>{
    if(this.disposed||this.contextLost||document.hidden)return Promise.resolve(null);
    this.captureNextFrame?.(null);return new Promise(resolve=>{this.captureNextFrame=resolve;});
  }
  probeOptics(){return {caustics:this.caustics.readEnergy(),sun:this.uniforms.uSunDirection.value.toArray(),underwater:this.uniforms.uUnderwater.value};}
  get diagnostics(){
    const state=this.adventure.state;
    return {time:this.time,frames:this.frames,fps:Number(this.fps.toFixed(1)),paused:this.paused,wind:this.wind,swell:this.swell,quality:this.quality,
      resolution:[this.canvas.width,this.canvas.height],camera:{yaw:state.yaw,pitch:state.pitch,height:state.position.y,x:state.position.x,z:state.position.z},
      adventure:{mode:state.mode,depth:state.depth,oxygen:state.oxygen,speed:state.speed,placed:this.assets.placedCount,
        voyage:state.voyageTarget,remaining:state.voyageRemaining,message:state.message},
      photographicSky:!!this.photographicSky,waterHeightCache:this.waterHeights.diagnostics,marineScans:this.marine.group.userData.scannedRocks,
      scannedCoast:this.scannedCoastInstances.map(m=>({name:m.name,count:m.count})),
      ground:this.world.heightAt(state.position.x,state.position.z),programs:this.renderer.info.programs?.length,
      draws:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animationFrame);this.abort.abort();
    this.captureNextFrame?.(null);this.captureNextFrame=null;
    this.scannedCoastInstances.forEach(instance=>instance.dispose());this.scannedCoast.clear();
    this.reefGeometries.forEach(geometry=>geometry.dispose());
    this.adventure.dispose();this.body.dispose();this.waterHeights.dispose();this.assets.dispose();this.marine.dispose();this.world.dispose();this.simulation.dispose();
    this.materials.forEach(m=>m.dispose());this.meshGeometries.forEach(g=>g.dispose());
    this.environmentTargets.forEach(t=>t.dispose());this.pmrem.dispose();this.sun.shadow.dispose();this.compositor.dispose();
    this.caustics.dispose();this.reflection.dispose();this.reflection.geometry.dispose();this.photographicSky?.texture.dispose();this.renderer.dispose();
  }
}
