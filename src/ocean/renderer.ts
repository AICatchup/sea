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
import {targetCameraFov,approachCameraFov} from '../world/camera-lens.ts';
import { LocalWaterHeights, cameraSubmersion } from './local-water-heights.ts';
import { WorldCollision, withWorldCollision } from '../world/world-collision';
import { WorldSolidBinding } from '../world/world-solid-binding';
import { ShoreSpray } from './shore-spray';
import { ShoreBreaker } from './shore-breaker';
import { ShoreSolver, createShoreSolverUniforms } from './shore-solver.ts';
import { buildPhotoCoastPresentation } from '../world/photo-coast-presentation';
import { experienceOptions } from '../qa/experience-options';
import {ReceiverBridge} from './receiver-bridge.ts';
import {loadSandTextures,type SandTextureSet} from '../world/sand-material.ts';
import {inspectGeometryRays} from '../qa/geometry-inspection.ts';
import {SkinnedReceivers} from './skinned-receivers.ts';
import {GPUSkinnedReceivers} from './gpu-skinned-receivers.ts';
import {LightProbeGenerator} from 'three/addons/lights/LightProbeGenerator.js';
import {Expedition,createExpeditionMap,type SaveStore} from '../game/expedition.ts';
import {ExpeditionWorld} from '../game/expedition-world.ts';
import {resizeReflectionTarget} from './reflection-target.ts';
import {groundScannedShelf} from '../world/grounded-reef.ts';

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
  private receiverBridge:ReceiverBridge|null=null;
  private skinnedReceivers:SkinnedReceivers|null=null;
  private gpuSkinnedReceivers:GPUSkinnedReceivers|null=null;
  private receiverSand:SandTextureSet|null=null;
  private receiverInitialization:Promise<void>|null=null;
  private geometryRefraction=false;
  private readonly environmentProbes=new Map<PresetName,Promise<THREE.LightProbe>>();
  private receiverEnvironmentPreset:PresetName|undefined;
  /** Development capture lock only; normal movement never enables it. */
  visualCaptureLocked=false;
  readonly collision=new WorldCollision();
  private readonly solidBinding=new WorldSolidBinding(this.collision);
  private photoCoast:ReturnType<typeof buildPhotoCoastPresentation>|null=null;
  private solidContactReady=false;
  private readonly spray:ShoreSpray;
  private readonly breaker:ShoreBreaker|null;
  private readonly shoreSolver:ShoreSolver|null;
  private shoreCandidateEnabled=true;
  private breakerCandidateEnabled=true;
  readonly renderer:THREE.WebGLRenderer;
  readonly camera=new THREE.PerspectiveCamera(62,1,.12,35000);
  private readonly reflectionViewCamera=new THREE.PerspectiveCamera();
  private reflectionOverscan=1.3;
  readonly simulation:OceanSimulation;
  readonly scene=new THREE.Scene();
  readonly waterScene=new THREE.Scene();
  readonly world:IslandWorld;
  readonly assets:AssetWorld;
  readonly marine:MarineLife;
  readonly adventure:ExplorerControls;
  readonly expedition:Expedition;
  private readonly expeditionWorld:ExpeditionWorld;
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
  private reflectionSamplingEnabled=true;
  private reflectionNeedsUpdate=true;
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

  constructor(private readonly canvas:HTMLCanvasElement, controlSettings?: import('../input/control-settings.ts').ControlSettings){
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
    const experience=experienceOptions(location.search);
    this.shoreSolver=experience.surf?new ShoreSolver(this.renderer,{order:new URLSearchParams(location.search).get('shoreorder')==='1'?1:2}):null;
    this.waterHeights=new LocalWaterHeights(this.renderer);
    this.world=new IslandWorld(new URLSearchParams(location.search).get('rock')!=='legacy',new URLSearchParams(location.search).get('toe')!=='legacy',new URLSearchParams(location.search).get('coastform')==='1',new URLSearchParams(location.search).get('ground')!=='0',new URLSearchParams(location.search).get('cliffskin')!=='0',new URLSearchParams(location.search).get('strandprofile')!=='0');
    this.world.sandAppearance.value=new URLSearchParams(location.search).get('whitesand')!=='0'?1:0;
    this.spray=new ShoreSpray(this.renderer,this.world,{whitewater:experience.whitewater,volume:experience.volume});
    // Surface spray/foam must blend AFTER the water inside the water target.
    // Land-target transparency writes no depth, so the later water merge hides it.
    this.waterScene.add(this.spray.group);
    this.breaker=new URLSearchParams(location.search).get('breaker')==='1'?new ShoreBreaker():null;
    if(this.breaker)this.waterScene.add(this.breaker.group);
    this.assets=new AssetWorld(this.world,{branchCanopy:new URLSearchParams(location.search).get('branches')!=='0',canopyContinuity:new URLSearchParams(location.search).get('canopy')!=='0',crownSupport:new URLSearchParams(location.search).get('crown')==='1',originalCanopy:new URLSearchParams(location.search).get('originaltree')==='1',leafVolumeRefinement:new URLSearchParams(location.search).get('leafvolume')==='1'?{pineTriangles:1440,shrubTriangles:320}:false});
    this.marine=new MarineLife(this.world);
    const ground={heightAt:(x:number,z:number)=>this.world.heightAt(x,z),
      bodySegmentBlocked:(from:Parameters<IslandWorld['bodySegmentBlocked']>[0],to:Parameters<IslandWorld['bodySegmentBlocked']>[1],radius?:number,height?:number)=>
        this.solidContactReady?false:this.world.bodySegmentBlocked(from,to,radius,height)};
    this.adventure=new ExplorerControls(canvas,withWorldCollision(ground,this.collision),this.world.destinations,this.world.spawnPoint,controlSettings);
    (this.adventure as ExplorerControls&{setWaterHeightSampler?:(sample:(x:number,z:number)=>number)=>void})
      .setWaterHeightSampler?.(this.waterHeights.sample);
    this.assets.setWaterHeightSampler(this.waterHeights.sample);
    let expeditionStore:SaveStore|undefined;
    try{
      const query=new URLSearchParams(location.search);
      if(query.get('capture')!=='1')expeditionStore=window.localStorage;
      else if(import.meta.env.DEV&&query.get('qaSave')==='1'){
        const storage=window.localStorage;
        expeditionStore={getItem:()=>storage.getItem('sea.expedition.qa.v1'),setItem:(_key,value)=>storage.setItem('sea.expedition.qa.v1',value)};
      }
    }catch{/* Session play remains available. */}
    this.expedition=new Expedition(createExpeditionMap(this.world,this.world.destinations),this.world,expeditionStore);
    this.expeditionWorld=new ExpeditionWorld(this.expedition);
    this.adventure.setContextInteraction({label:state=>this.expedition.context(state)?.label??'',activate:state=>this.expedition.interact(state)});
    const p=presets.day;
    this.uniforms={
      uSandAppearance:this.world.sandAppearance,
      ...createShoreSolverUniforms(),uPointwiseContact:{value:1},uContactDebug:{value:0},uWetStencil:{value:1},uHideSurfaceFoam:{value:0},uFoamFilm:{value:new URLSearchParams(location.search).get('foamfilm')==='0'?0:1},uFarWaveFilter:{value:new URLSearchParams(location.search).get('wavefilter')==='0'?0:1},
      uSnellRay:{value:new URLSearchParams(location.search).get('ray')==='1'?1:0},uWaterProjection:{value:this.camera.projectionMatrix},
      uTime:{value:this.time},uSunDirection:{value:new THREE.Vector3(...p.sun).normalize()},
      uSunColor:{value:new THREE.Vector3(...p.sunColor)},uZenith:{value:new THREE.Vector3(...p.zenith)},
      uHorizon:{value:new THREE.Vector3(...p.horizon)},uCloudColor:{value:new THREE.Vector3(...p.cloud)},
      uWaterTint:{value:new THREE.Vector3(...p.water)},uCloudCoverage:{value:p.coverage},
      uExposure:{value:p.exposure},uStorm:{value:p.storm},uLongWaves:{value:null},uShortWaves:{value:null},
      uSwell:{value:this.swell},uChoppiness:{value:1.55},uWind:{value:this.wind},
      uCameraWorld:{value:this.camera.matrixWorld},uInverseProjection:{value:this.camera.projectionMatrixInverse},
      uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},
      uSceneColor:{value:null},uSceneDepth:{value:null},uSceneOcclusion:{value:null},uResolution:{value:new THREE.Vector2()},
      uReflectionDepth:{value:null},uReflectionInverseProjection:{value:new THREE.Matrix4()},uReflectionCameraWorld:{value:new THREE.Matrix4()},
      uNearFar:{value:new THREE.Vector2(this.camera.near,this.camera.far)},uUnderwater:{value:0},
      uReflection:{value:this.reflection.getRenderTarget().texture},uReflectionMatrix:{value:this.reflectionMatrix},uHasReflection:{value:0},
      uReflectionResolution:{value:new THREE.Vector2(512,320)},
      uCaustics:{value:null},uCausticBounds:{value:new THREE.Vector4()},
      uSkyTexture:{value:null},uSkyRotation:{value:0},uSkyExposure:{value:1},uUseSky:{value:0},
    };
    this.caustics=new WaveCaustics(this.renderer,{span:32,photonResolution:new URLSearchParams(location.search).get('light')==='legacy'?256:512});
    if(this.shoreSolver){this.shoreSolver.bindUniforms(this.uniforms);Object.assign(this.uniforms,this.shoreSolver.uniforms);}
    this.waterHeights.bindShore(this.uniforms);this.caustics.bindShore(this.uniforms);
    this.world.niijimaCoast.bindWaterSurface(this.uniforms);
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
      // Reflector mutates only the clip row and leaves its inverse stale. Sky
      // directions use the main camera's current intrinsic projection; camera
      // rotation/position above still come from the reflected camera.
      this.uniforms.uInverseProjection.value=viewCamera===this.camera?this.camera.projectionMatrixInverse:this.reflectionViewCamera.projectionMatrixInverse;
    };
    this.scene.add(sky);
    const seaMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:oceanVertex,fragmentShader:oceanFragment,
      side:THREE.DoubleSide,toneMapped:false});
    const seaGeometry=makeOceanGrid();
    const sea=new THREE.Mesh(seaGeometry,seaMat);sea.frustumCulled=false;this.waterScene.add(sea);
    this.materials=[skyMat,seaMat];this.meshGeometries=[skyGeometry,seaGeometry];
    this.scene.add(this.world.group,this.assets.group,this.marine.group,this.body.group,this.expeditionWorld.group,this.sun,this.sun.target,this.fill);
    this.scene.add(this.scannedCoast);
    prepareWorldMaterials(this.world.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    prepareWorldMaterials(this.marine.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-220,right:220,top:220,bottom:-220,near:1,far:1500});
    this.sun.shadow.bias=-.00012;this.sun.shadow.normalBias=.075;this.sun.shadow.radius=.85;
    prepareWorldMaterials(this.body.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    prepareWorldMaterials(this.expeditionWorld.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    this.scene.fog=new THREE.FogExp2(new THREE.Color().setRGB(...p.horizon),.000028);
    this.pmrem=new THREE.PMREMGenerator(this.renderer);
    const reflectionTexture=this.reflection.getRenderTarget().texture;
    this.reflection.getRenderTarget().depthTexture=new THREE.DepthTexture(512,320,THREE.UnsignedIntType);
    this.uniforms.uReflectionDepth.value=this.reflection.getRenderTarget().depthTexture;
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
      if(experience.photoCoast){
        this.photoCoast=buildPhotoCoastPresentation(this.world,variants);
        this.photoCoast.group.traverse(object=>{if(object instanceof THREE.Mesh)object.castShadow=true;});
        this.scannedCoast.add(this.photoCoast.group);
        if(this.photoCoast.diagnostics.instances){
          const authored=this.world.group.getObjectByName('Tomari jointed rhyolite ledges and fissures');
          if(authored){authored.visible=false;authored.userData.worldSolid=false;}
        }
      }
      let seed=31851;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const groundedReef=new URLSearchParams(location.search).get('reefseat')!=='0';
      const helper=new THREE.Object3D();
      for(const variant of variants){
        const matrices:THREE.Matrix4[]=[];
        for(let attempt=0;attempt<900&&!this.photoCoast&&matrices.length<(variant.kind==='shelf'?30:20);attempt++){
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
          const patches:THREE.BufferGeometry[]=[],seating:ReturnType<typeof groundScannedShelf>['diagnostics'][]=[];
          for(const [x,z] of [[-138,-119],[-147,-125],[-157,-117],[-130,-132],[-167,-137],[-155,-150]]){
            const px=x+(random()-.5)*5,pz=z+(random()-.5)*5,h=this.world.heightAt(px,pz),s=.70+random()*.35;
            if(h> -3.8||h< -16)continue;
            helper.position.set(px,h-.20,pz);helper.scale.set(s,.5*s,s);
            helper.rotation.set((random()-.5)*.08,random()*Math.PI*2,(random()-.5)*.08);
            helper.updateMatrix();
            if(groundedReef){
              const patch=groundScannedShelf(variant.geometry,helper.matrix,(x,z)=>this.world.heightAt(x,z));
              patches.push(patch.geometry);seating.push(patch.diagnostics);
            }else{
              const patch=variant.geometry.clone(),source=variant.geometry.getAttribute('position');patch.applyMatrix4(helper.matrix);
              const vertices=patch.getAttribute('position');
              for(let i=0;i<vertices.count;i++){
                const vx=vertices.getX(i),vz=vertices.getZ(i);vertices.setY(i,this.world.heightAt(vx,vz)-.30+source.getY(i)*s*.5);
              }
              patch.computeVertexNormals();patches.push(patch);
            }
          }
          if(patches.length){
            const geometry=mergeGeometries(patches,false)!;patches.forEach(patch=>patch.dispose());
            geometry.computeBoundingSphere();this.reefGeometries.push(geometry);
            const reef=new THREE.Mesh(geometry,variant.material);reef.name='Ground-conforming scanned rocky habitat '+variant.id;
            reef.userData.groundedShelf={enabled:groundedReef,patches:seating};
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
      if(!this.disposed)this.syncSolids();
    });
  }

  private refreshEnvironment(name:PresetName):void{
    let target=this.environmentTargets.get(name);
    if(!target){
      const envScene=new THREE.Scene();
      const geometry=new THREE.SphereGeometry(1,24,16);
      const material=new THREE.ShaderMaterial({uniforms:{...this.uniforms,uEnvironmentSolarRemoval:{value:new URLSearchParams(location.search).get('ibl')==='solar'?0:1}},vertexShader:environmentVertex,
        fragmentShader:environmentFragment,side:THREE.BackSide,depthWrite:false,toneMapped:false});
      const sphere=new THREE.Mesh(geometry,material);envScene.add(sphere);
      const cube=new THREE.WebGLCubeRenderTarget(64,{type:THREE.HalfFloatType,generateMipmaps:false});
      const cam=new THREE.CubeCamera(.05,10,cube);
      const previous=this.renderer.getRenderTarget();
      cam.update(this.renderer,envScene);target=this.pmrem.fromCubemap(cube.texture);
      this.environmentTargets.set(name,target);
      const probe=LightProbeGenerator.fromCubeRenderTarget(this.renderer,cube).finally(()=>cube.dispose());this.environmentProbes.set(name,probe);void probe.catch(error=>console.warn('Environment irradiance probe unavailable',error));
      geometry.dispose();material.dispose();this.renderer.setRenderTarget(previous);
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
    if(!this.visualCaptureLocked){
      this.adventure.setEquipment(this.expedition.hasGear('air')?1.45:1,this.expedition.hasGear('fins')?1.18:1);
      this.adventure.update(delta,this.time,this.paused);
      if(!this.adventure.inputBlocked)this.expedition.update(delta,this.adventure.state);
    }
    const state=this.adventure.state;
    const nextFov=approachCameraFov(this.camera.fov,targetCameraFov(state,this.adventure.settings.value.boatFov),delta);
    if(nextFov!==this.camera.fov){this.camera.fov=nextFov;this.camera.updateProjectionMatrix();this.reflectionNeedsUpdate=true;}
    this.camera.position.copy(state.position);
    if(state.viewOffset)this.camera.position.add(state.viewOffset);
    this.direction.set(Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch),-Math.cos(state.yaw)*Math.cos(state.pitch));
    this.target.copy(this.camera.position).add(this.direction);this.camera.lookAt(this.target);this.camera.updateMatrixWorld();
    this.assets.boat.position.copy(state.boatPosition);
    this.assets.boat.rotation.set(state.boatPitch??0,-state.boatYaw,state.boatRoll??0,'YXZ');
    this.body.update(state,this.camera,delta,this.time);
    const underwater=cameraSubmersion(this.camera.position.y,this.waterHeights.sample(this.camera.position.x,this.camera.position.z));
    this.uniforms.uUnderwater.value=underwater;
    this.world.update(this.time);this.assets.update(this.time,this.camera.position,underwater>.5,this.camera.getWorldDirection(new THREE.Vector3()),this.canvas.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov)*.5)));
    this.marine.update(this.time,this.camera.position,underwater>.5);
    this.expeditionWorld.update(this.time,state,this.waterHeights.sample);
    if(this.geometryRefraction&&this.receiverBridge){this.scene.updateMatrixWorld(true);this.updateSkinnedReceivers();if(!this.receiverBridge.sync()||!this.skinnedReceiverReady())this.setGeometryShader(false);}
    const waterMap=this.world.waterMapFor(this.camera.position.x,this.camera.position.z);
    this.uniforms.uBathymetry.value=waterMap.texture;
    this.uniforms.uBathyBounds.value.set(waterMap.origin.x,waterMap.origin.y,waterMap.size.x,waterMap.size.y);
    const image=waterMap.texture.image as {width:number;height:number};
    this.uniforms.uBathyResolution.value.set(image.width,image.height);this.uniforms.uBathyTriangulated.value=waterMap.triangulated?1:0;
    const textures=this.simulation.textures;this.uniforms.uLongWaves.value=textures[0];this.uniforms.uShortWaves.value=textures[1];
    this.uniforms.uSwell.value=this.swell;this.uniforms.uWind.value=this.wind;
    if(this.shoreSolver){
      if(waterMap.triangulated){
        if(this.shoreCandidateEnabled)this.shoreSolver.update(this.paused?0:delta,this.camera.position.x,this.camera.position.z);
        else this.uniforms.uShoreReady.value=0;
      }else this.shoreSolver.reset();
    }
    this.waterHeights.update(stamp*.001,textures,waterMap,state.position,state.boatPosition,this.swell,this.uniforms.uChoppiness.value,this.wind);
    this.caustics.update(this.time,this.paused?0:delta,textures[0],textures[1],waterMap,this.camera.position,this.uniforms.uSunDirection.value,this.swell,this.wind,1.55);
    this.uniforms.uCaustics.value=this.caustics.texture;
    this.uniforms.uTime.value=this.time;this.uniforms.uSwell.value=this.swell;this.uniforms.uWind.value=this.wind;
    this.spray.update(this.time,this.paused?0:delta,this.camera,this.uniforms);
    if(this.breaker){
      this.breaker.bindUniforms(this.uniforms);
      this.breaker.update(this.camera.position.x,this.camera.position.z,underwater>.5);
      this.breaker.group.visible&&=this.breakerCandidateEnabled;
    }
    this.sun.position.copy(this.camera.position).addScaledVector(this.uniforms.uSunDirection.value,650);
    this.sun.target.position.copy(this.camera.position);
    const solarColor=this.uniforms.uSunColor.value as THREE.Vector3;
    const solarMaximum=Math.max(solarColor.x,solarColor.y,solarColor.z);
    this.sun.color.setRGB(solarColor.x/solarMaximum,solarColor.y/solarMaximum,solarColor.z/solarMaximum);
    this.sun.intensity=solarMaximum*1.05*(1-.62*this.uniforms.uStorm.value);
    this.fill.intensity=.17+.20*this.uniforms.uStorm.value;
    if(this.frames%4===0)this.renderer.shadowMap.needsUpdate=true;
    this.renderer.info.reset();
    if(this.frames%3===0||this.reflectionNeedsUpdate){
      // Both sides of the interface need the scene on their own side: below
      // water, total internal reflection sees the real seabed and organisms.
      this.reflection.rotation.x=underwater>.5?Math.PI/2:-Math.PI/2;this.reflection.updateMatrixWorld(true);
      this.renderer.setClearColor(0,1);
      // Capture real offscreen geometry for distorted reflection rays. Fading
      // an empty border to the sky only produced a wider bright edge band.
      this.reflectionViewCamera.copy(this.camera);
      this.reflectionViewCamera.projectionMatrix.elements[0]/=this.reflectionOverscan;
      this.reflectionViewCamera.projectionMatrix.elements[5]/=this.reflectionOverscan;
      this.reflectionViewCamera.projectionMatrixInverse.copy(this.reflectionViewCamera.projectionMatrix).invert();
      this.reflection.onBeforeRender(this.renderer,this.scene,this.reflectionViewCamera,this.reflection.geometry,this.reflection.material as THREE.Material,this.reflectionContext);
      const reflectedCamera=this.reflection.getReflectionCamera(this.reflectionViewCamera);
      reflectedCamera.projectionMatrixInverse.copy(reflectedCamera.projectionMatrix).invert();
      this.uniforms.uReflectionInverseProjection.value.copy(reflectedCamera.projectionMatrixInverse);
      this.uniforms.uReflectionCameraWorld.value.copy(reflectedCamera.matrixWorld);
      this.reflectionMatrix.copy(this.reflectionBias).multiply(reflectedCamera.projectionMatrix).multiply(reflectedCamera.matrixWorldInverse);
      this.uniforms.uHasReflection.value=this.reflectionSamplingEnabled?1:0;
      this.reflectionNeedsUpdate=false;
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
    // High quality owns one drawing-buffer pixel per CSS pixel before the budget
    // cap; fractional browser zoom must not silently turn 1280 into 1279.
    const ratio=(this.quality==='high'?1:Math.min(window.devicePixelRatio,1.65))*scale;
    const budget=this.quality==='high'?4200000:2300000;
    this.renderer.setPixelRatio(Math.min(ratio,Math.sqrt(budget/(width*height))));
    this.renderer.setSize(width,height,false);this.compositor.resize(this.canvas.width,this.canvas.height);
    const reflectionWidth=Math.max(192,Math.round(this.canvas.width*.42)),reflectionHeight=Math.max(128,Math.round(this.canvas.height*.42));
    if(resizeReflectionTarget(this.reflection.getRenderTarget(),reflectionWidth,reflectionHeight)){
      this.uniforms.uHasReflection.value=0;this.reflectionNeedsUpdate=true;
    }
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
    if(this.uniforms.receiverIBLHasProbe){this.uniforms.receiverIBLHasProbe.value=0;this.receiverEnvironmentPreset=undefined;void this.bindReceiverEnvironment();}
  }
  resetView():void{this.adventure.home();}
  place(kind:PlaceableKind):void{
    const state=this.adventure.state;
    const x=state.position.x+Math.sin(state.yaw)*8,z=state.position.z-Math.cos(state.yaw)*8;
    this.assets.place(kind,x,z,state.yaw);
    prepareWorldMaterials(this.assets.group,this.uniforms.uTime,{texture:this.uniforms.uCaustics,bounds:this.uniforms.uCausticBounds,sunDirection:this.uniforms.uSunDirection});
    this.syncSolids();
  }
  undoPlacement():void{this.assets.undoPlacement();this.syncSolids();}
  private syncSolids():void{
    this.solidBinding.sync(this.world.group,this.assets,this.scannedCoast,[this.world.habushiGate.solidsGroup,this.world.habushiGround.solidsGroup,this.expeditionWorld.solids,...(this.world.scarpVolume?[this.world.scarpVolume.group]:[]),...(this.world.cliffVolume?[this.world.cliffVolume.group]:[])]);
    this.solidContactReady=true;
  }
  capture():Promise<Blob|null>{
    if(this.disposed||this.contextLost||document.hidden)return Promise.resolve(null);
    this.captureNextFrame?.(null);return new Promise(resolve=>{this.captureNextFrame=resolve;});
  }
  probeOptics(){return {caustics:this.caustics.readEnergy(),sun:this.uniforms.uSunDirection.value.toArray(),underwater:this.uniforms.uUnderwater.value};}
  setCausticResolution(count:128|256|512):128|256|512{const previous=this.caustics.photonResolution;this.caustics.setPhotonResolution(count);return previous;}
  getCausticResolution(){return this.caustics.photonResolution;}
  async prepareGeometryReceivers():Promise<void>{
    if(this.receiverBridge)return;
    if(this.receiverInitialization)return this.receiverInitialization;
    this.receiverInitialization=(async()=>{
      await this.ready;if(this.disposed)throw new Error('Ocean disposed');
      this.receiverSand=loadSandTextures();await this.receiverSand.ready;if(this.disposed)throw new Error('Ocean disposed');
      this.scene.updateMatrixWorld(true);
      const include=(mesh:THREE.Mesh)=>{
        if(mesh instanceof THREE.SkinnedMesh||mesh.geometry.morphAttributes.position?.length||mesh.userData.foliageLod||mesh.userData.surface||/DEM|forest|pine|foliage|needles|sprays|shrub|seagrass|leaf|leaves|cloud/i.test(mesh.name))return false;
        for(let p:THREE.Object3D|null=mesh;p;p=p.parent)if(p.userData.foliageLod)return false;
        const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(materials.some(m=>!(m instanceof THREE.MeshStandardMaterial||m instanceof THREE.MeshBasicMaterial)))return false;
        if(!materials.some(m=>m.visible&&!m.transparent&&m.opacity>=1&&m.alphaTest===0&&(!('alphaMap' in m)||!m.alphaMap)&&(!('transmission' in m)||m.transmission===0)))return false;
        return true;
      };
      const activeMesh=(mesh:THREE.Mesh)=>{
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();let box:THREE.Box3;
        if(mesh instanceof THREE.InstancedMesh){mesh.computeBoundingBox();box=mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);}else box=mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
        return box.min.y<=4;
      };
      this.skinnedReceivers=new SkinnedReceivers(this.body.group);this.updateSkinnedReceivers();
      if(new URLSearchParams(location.search).get('gpuskin')==='1'){
        try{this.gpuSkinnedReceivers=new GPUSkinnedReceivers(this.renderer,this.skinnedReceivers);this.updateSkinnedReceivers();}
        catch(error){console.warn('GPU skin candidate unavailable; CPU receiver retained',error);}
      }
      const gl=this.renderer.getContext() as WebGL2RenderingContext;this.receiverBridge=new ReceiverBridge(this.scene,include,this.renderer.capabilities.maxTextureSize,gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),this.receiverSand.albedo,{activeMesh,bedNormal:this.receiverSand.normalGL,bedARM:this.receiverSand.arm,extraMaterials:()=>this.skinnedReceivers?.materials??[],extraDynamicData:()=>this.skinnedReceivers?.packed.data??new Float32Array(0),dynamicWriter:()=>this.gpuSkinnedReceivers?.diagnostics.available?this.gpuSkinnedReceivers:undefined});
      if(!this.receiverBridge.diagnostics.available)throw new Error(this.receiverBridge.diagnostics.reason);
      Object.assign(this.uniforms,this.receiverBridge.uniforms);
      this.uniforms.receiverIBLHasProbe={value:0};this.uniforms.receiverSH={value:Array.from({length:9},()=>new THREE.Vector3())};this.uniforms.receiverEnvironmentIntensity={value:this.scene.environmentIntensity};
      await this.bindReceiverEnvironment();
      this.uniforms.skinnedDataOffset=this.receiverBridge.uniforms.receiverExtraDataOffset;
      this.uniforms.skinnedTriangleOffset={value:this.skinnedReceivers.packed.triangleOffset};this.uniforms.skinnedRoot={value:this.skinnedReceivers.packed.root};this.uniforms.skinnedAvailable={value:this.skinnedReceivers.diagnostics.available?1:0};
    })();
    try{await this.receiverInitialization;}finally{this.receiverInitialization=null;}
  }
  private setGeometryShader(enabled:boolean):void{
    this.geometryRefraction=enabled;
    this.waterScene.traverse(object=>{if(!(object instanceof THREE.Mesh))return;for(const m of Array.isArray(object.material)?object.material:[object.material])if(m instanceof THREE.ShaderMaterial&&m.fragmentShader===oceanFragment&&!m.defines?.CURVED_SURFACE){m.defines??={};if(enabled)m.defines.GEOMETRIC_REFRACTION=1;else delete m.defines.GEOMETRIC_REFRACTION;m.needsUpdate=true;}});
  }
  private updateSkinnedReceivers(){
    if(!this.skinnedReceivers)return;this.body.group.traverse(object=>{if(object instanceof THREE.SkinnedMesh)object.skeleton.update();});
    if(!this.gpuSkinnedReceivers?.update())this.skinnedReceivers.update();
    if(this.uniforms.skinnedAvailable)this.uniforms.skinnedAvailable.value=this.skinnedReceiverReady()?1:0;
  }
  private skinnedReceiverReady(){return this.gpuSkinnedReceivers?.diagnostics.available||this.skinnedReceivers?.diagnostics.available||false;}
  private async bindReceiverEnvironment(){
    const preset=this.currentPreset,pending=this.environmentProbes.get(preset);if(!pending||!this.uniforms.receiverSH)return;
    try{const probe=await pending;if(this.disposed||this.currentPreset!==preset||this.environmentProbes.get(preset)!==pending)return;this.uniforms.receiverSH.value=probe.sh.coefficients.map(coefficient=>coefficient.clone());this.uniforms.receiverIBLHasProbe.value=1;this.receiverEnvironmentPreset=preset;this.uniforms.receiverEnvironmentIntensity.value=this.scene.environmentIntensity;}catch{if(this.currentPreset===preset&&this.environmentProbes.get(preset)===pending){this.uniforms.receiverIBLHasProbe.value=0;this.receiverEnvironmentPreset=undefined;}}
  }
  async setGeometryRefraction(enabled:boolean):Promise<boolean>{const previous=this.geometryRefraction;if(enabled){await this.prepareGeometryReceivers();await this.bindReceiverEnvironment();this.scene.updateMatrixWorld(true);this.updateSkinnedReceivers();if(!this.receiverBridge?.sync()||!this.skinnedReceiverReady())throw new Error(this.receiverBridge?.diagnostics.reason??'Receiver unavailable');}this.setGeometryShader(enabled);return previous;}
  getGeometryRefraction(){return this.geometryRefraction;}
  async inspectGeometryReceivers(){await this.prepareGeometryReceivers();this.scene.updateMatrixWorld(true);if(!this.receiverBridge?.sync())throw new Error('Receiver unavailable');return inspectGeometryRays(this.renderer,this.receiverBridge,this.camera.position);}
  async inspectSkinnedReceivers(){await this.prepareGeometryReceivers();this.scene.updateMatrixWorld(true);this.updateSkinnedReceivers();this.skinnedReceivers?.update();if(!this.receiverBridge?.sync()||!this.skinnedReceivers?.diagnostics.available)throw new Error('Skinned receiver unavailable');return inspectGeometryRays(this.renderer,this.receiverBridge,this.camera.position,this.skinnedReceivers,{skinnedDataOffset:this.uniforms.skinnedDataOffset,skinnedRoot:this.uniforms.skinnedRoot,skinnedAvailable:this.uniforms.skinnedAvailable,skinnedTriangleOffset:this.uniforms.skinnedTriangleOffset});}
  probeGeometryReceivers(){const gpu=this.gpuSkinnedReceivers;return {enabled:this.geometryRefraction,bridge:this.receiverBridge?{...this.receiverBridge.diagnostics}:null,geometry:this.receiverBridge?{...this.receiverBridge.geometry.diagnostics}:null,skinned:this.skinnedReceivers?{...this.skinnedReceivers.diagnostics,backend:gpu?.diagnostics.available?'gpu':'cpu',timeMs:gpu?.diagnostics.available?gpu.diagnostics.cpuSubmitMs:this.skinnedReceivers.diagnostics.timeMs,gpu:gpu?{...gpu.diagnostics}:null}:null,irradiance:{measured:this.uniforms.receiverIBLHasProbe?.value===1,preset:this.receiverEnvironmentPreset,intensity:this.uniforms.receiverEnvironmentIntensity?.value??0,coefficients:this.uniforms.receiverSH?.value?.map((v:THREE.Vector3)=>v.toArray())??[],scope:'Nine SH coefficients from the actual rendered solar-removed environment cube; diffuse only, specular hemisphere remains approximate'},maxTextures:this.renderer.capabilities.maxTextures,maxTextureSize:this.renderer.capabilities.maxTextureSize};}
  setSnellRay(enabled:boolean):boolean{const before=this.uniforms.uSnellRay.value>.5;this.uniforms.uSnellRay.value=enabled?1:0;return before;}
  setObservationClock(time:number):void{
    if(!this.visualCaptureLocked||!this.paused||!Number.isFinite(time)||time<0||time>86400)throw new Error('Finite 0..86400 observation clock requires paused, locked QA state');
    this.time=time;this.simulation.advance(time,0,this.swell,this.uniforms.uChoppiness.value);
  }
  setLeafAlphaThreshold(value:number){
    if(!Number.isFinite(value)||value<.05||value>.6)throw new Error('Leaf threshold .05..6 required');
    const before=new Map<THREE.MeshStandardMaterial,number>();
    this.assets.group.traverse(object=>{if(!(object instanceof THREE.Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial&&material.userData.foliageRole==='leaves'&&!before.has(material)){before.set(material,material.alphaTest);material.alphaTest=value;}});
    this.renderer.shadowMap.needsUpdate=true;return before;
  }
  restoreLeafAlphaThreshold(before:Map<THREE.MeshStandardMaterial,number>){for(const [material,value] of before)material.alphaTest=value;this.renderer.shadowMap.needsUpdate=true;}
  setLeafColourMips(enabled:boolean){
    const before=new Map<THREE.MeshStandardMaterial,THREE.Texture|null>();
    this.assets.group.traverse(object=>{if(!(object instanceof THREE.Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial&&material.userData.correctedLeafMap&&!before.has(material)){before.set(material,material.map);material.map=enabled?material.userData.correctedLeafMap:material.userData.originalLeafMap;}});
    if(!before.size)throw new Error('Detailed native leaf colour maps are unavailable');return before;
  }
  restoreLeafColourMips(before:Map<THREE.MeshStandardMaterial,THREE.Texture|null>){for(const [material,map] of before)material.map=map;}
  setBreakerCandidateEnabled(enabled:boolean):void{this.breakerCandidateEnabled=enabled;}
  setShoreCandidateEnabled(enabled:boolean):void{this.shoreCandidateEnabled=enabled;if(!enabled)this.uniforms.uShoreReady.value=0;}
  setReflectionOverscan(scale:number):void{if(Number.isFinite(scale))this.reflectionOverscan=THREE.MathUtils.clamp(scale,1,1.6);}
  setReflectionSampling(enabled:boolean):boolean{const before=this.reflectionSamplingEnabled;this.reflectionSamplingEnabled=enabled;this.uniforms.uHasReflection.value=enabled&&!this.reflectionNeedsUpdate?1:0;return before;}
  probeReflectionTarget(){
    const target=this.reflection.getRenderTarget(),raw=new Uint16Array(4),samples=[],gl=this.renderer.getContext(),initialError=gl.getError(),previous=this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);this.renderer.setRenderTarget(previous);
    for(const [u,v] of [[.5367,.5237],[.423,.4951],[.3067,.4449],[.479,.4286],[.1,.8],[.5,.9],[.9,.8]]){
      this.renderer.readRenderTargetPixels(target,Math.floor(u*target.width),Math.floor(v*target.height),1,1,raw);
      samples.push({uv:[u,v],raw:Array.from(raw),rgb:Array.from(raw,n=>THREE.DataUtils.fromHalfFloat(n)),error:gl.getError()});
    }
    const normal=new THREE.Vector3(0,0,1).transformDirection(this.reflection.matrixWorld),origin=new THREE.Vector3().setFromMatrixPosition(this.reflection.matrixWorld),eye=new THREE.Vector3().setFromMatrixPosition(this.reflectionViewCamera.matrixWorld),colour=target.texture.image as {width:number;height:number};
    return {width:target.width,height:target.height,type:target.texture.type,minFilter:target.texture.minFilter,generateMipmaps:target.texture.generateMipmaps,status,depthImage:target.depthTexture?{width:target.depthTexture.image.width,height:target.depthTexture.image.height}:null,depthType:target.depthTexture?.type,colorImage:{width:colour.width,height:colour.height},initialError,framebuffer:!!(this.renderer.properties.get(target) as {__webglFramebuffer?:unknown}).__webglFramebuffer,normal:normal.toArray(),eye:eye.toArray(),facingDot:origin.sub(eye).dot(normal),underwater:this.uniforms.uUnderwater.value,samples};
  }
  probeShoreState(){return this.shoreSolver?.probeState()??null;}
  probeCrestDriver(expanded=false){return this.breaker?.probeDriver(this.renderer,expanded)??null;}
  setWhitewaterVisible(visible:boolean):boolean{const material=this.spray.whitewater?.material;const before=material?.visible??false;if(material)material.visible=visible;return before;}
  probeWhitewaterSites(){const pool=this.spray.whitewater?.pool;if(!pool)return [];const sites=[];for(let i=0;i<pool.capacity&&sites.length<32;i++)if(pool.alpha[i]>.01){const x=pool.positions[i*3],y=pool.positions[i*3+1],z=pool.positions[i*3+2];sites.push({x,y,z,alpha:pool.alpha[i],distance:Math.hypot(x-this.camera.position.x,z-this.camera.position.z)});}return sites;}
  /** Raw floating-point water-only probes; no tone mapping or temporal update. */
  probeWaterContact(points:readonly{x:number;y:number}[]){
    if(points.length>16||points.some(p=>![p.x,p.y].every(Number.isFinite)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('Up to sixteen normalized contact probes required');
    if(!this.renderer.extensions.has('EXT_color_buffer_float'))return {available:false,reason:'float color target unavailable'};
    const r=this.renderer,size=r.getDrawingBufferSize(new THREE.Vector2());
    const target=new THREE.WebGLRenderTarget(size.x,size.y,{type:THREE.FloatType,depthBuffer:false});
    target.texture.colorSpace=THREE.LinearSRGBColorSpace;
    const saved={target:r.getRenderTarget(),viewport:r.getViewport(new THREE.Vector4()),scissor:r.getScissor(new THREE.Vector4()),scissorTest:r.getScissorTest(),clear:r.getClearColor(new THREE.Color()),alpha:r.getClearAlpha(),auto:r.autoClear,tone:r.toneMapping,color:r.outputColorSpace,debug:this.uniforms.uContactDebug.value};
    const result=points.map(point=>({point,values:[] as number[][]})),pixel=new Float32Array(4);
    try{
      r.autoClear=true;r.toneMapping=THREE.NoToneMapping;r.outputColorSpace=THREE.LinearSRGBColorSpace;r.setClearColor(0,0);r.setScissorTest(false);r.setRenderTarget(target);
      for(let mode=1;mode<=19;mode++){
        this.uniforms.uContactDebug.value=mode;r.render(this.waterScene,this.camera);
        for(const row of result){const x=Math.min(size.x-1,Math.floor(row.point.x*size.x)),y=Math.min(size.y-1,Math.floor((1-row.point.y)*size.y));r.readRenderTargetPixels(target,x,y,1,1,pixel);row.values.push(Array.from(pixel));}
      }
      return {available:true,time:this.time,layout:['fresnel,skyVisibility,visibleBottom','normalXYZ','opticalPath,bottomContact,nV','meshHeight,pointHeight,bed','worldX,worldZ,reflectedY','straightPath,acceptedPath,snellUsed','snellHitXYZ','receiverNormalXYZ,kind','receiverUV,materialId,kind','reflectionUV,lod,valid','reflectionLod0RGB','reflectionFilteredRGB','footprint,longStep,roughnessAlpha','refractedRGB','waterBodyRGB','reflectionRGB','transmissionRGB','waterOutputRGB','screenReceiverRGB'],result};
    }finally{
      this.uniforms.uContactDebug.value=saved.debug;r.setRenderTarget(saved.target);r.setViewport(saved.viewport);r.setScissor(saved.scissor);r.setScissorTest(saved.scissorTest);r.setClearColor(saved.clear,saved.alpha);r.autoClear=saved.auto;r.toneMapping=saved.tone;r.outputColorSpace=saved.color;target.dispose();
    }
  }
  getBreakerCandidateEnabled():boolean{return this.breakerCandidateEnabled;}
  probeDepthSamples(points:readonly{x:number;y:number}[]){return this.compositor.probeDepthSamples(points);}
  /** Developer picking of foliage only; tight per-instance bounds avoid testing
   * the full island terrain or an entire dense instance field. */
  probeFoliage(x:number,y:number,foliageOnly=true,includeTerrain=false){
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),this.camera);
    const box=new THREE.Box3(),local=new THREE.Matrix4(),matrix=new THREE.Matrix4();
    const hits:{name:string;instance:number;material:string[];distance:number;point:number[]}[]=[];
    this.scene.updateMatrixWorld(true);
    this.scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||!object.visible)return;
      if(foliageOnly&&!object.userData.foliageLod)return;
      if(!foliageOnly&&((!includeTerrain&&(object.userData.surface||/DEM/.test(object.name)))||object instanceof THREE.SkinnedMesh||
        (Array.isArray(object.material)?object.material:[object.material]).some(m=>m instanceof THREE.ShaderMaterial)))return;
      if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
      for(let i=0;i<(object instanceof THREE.InstancedMesh?object.count:1);i++){
        if(object instanceof THREE.InstancedMesh){object.getMatrixAt(i,local);matrix.multiplyMatrices(object.matrixWorld,local);}
        else matrix.copy(object.matrixWorld);
        box.copy(object.geometry.boundingBox!).applyMatrix4(matrix);if(!ray.ray.intersectsBox(box))continue;
        const proxy=new THREE.Mesh(object.geometry,object.material);proxy.matrixWorld.copy(matrix);
        const intersections:THREE.Intersection[]=[];proxy.raycast(ray,intersections);
        for(const hit of intersections)hits.push({name:object.name,instance:i,material:(Array.isArray(object.material)?object.material:[object.material]).map(m=>m.name),distance:hit.distance,point:hit.point.toArray()});
      }
    });
    return hits.sort((a,b)=>a.distance-b.distance).slice(0,8);
  }
  get diagnostics(){
    const state=this.adventure.state;
    return {time:this.time,frames:this.frames,fps:Number(this.fps.toFixed(1)),paused:this.paused,wind:this.wind,swell:this.swell,quality:this.quality,preset:this.currentPreset,
      visualCaptureLocked:this.visualCaptureLocked,sandAppearance:this.world.sandAppearance.value,fieldOfView:this.camera.fov,
      resolution:[this.canvas.width,this.canvas.height],camera:{yaw:state.yaw,pitch:state.pitch,height:state.position.y,x:state.position.x,z:state.position.z},
      adventure:{mode:state.mode,depth:state.depth,oxygen:state.oxygen,speed:state.speed,placed:this.assets.placedCount,
        voyage:state.voyageTarget,remaining:state.voyageRemaining,message:state.message,
        boat:state.boatPosition.toArray(),boatYaw:state.boatYaw,interaction:state.interactionLabel,boarding:state.boardingProgress,
        grounded:state.grounded,stamina:state.stamina,avatarAction:state.avatarAction},
      topography:{coherentRock:this.world.elevation.coherentRock,dryToe:this.world.elevation.dryToe,connectedForm:this.world.elevation.connectedForm,strandProfile:this.world.elevation.beach?.strandDiagnostics??null,canopyContinuity:this.assets.group.userData.canopyContinuity===true,cliffVolume:this.world.cliffVolume?.group.userData.cliffVolume??null},
      geometryReceivers:this.probeGeometryReceivers(),
      foliage:{...this.assets.group.userData.foliage,pines:this.assets.group.userData.coastalPineLod,shrubs:this.assets.group.userData.coastalShrubLod},
      expedition:{...this.expedition.snapshot,credits:this.expedition.credits,capacity:this.expedition.capacity,rank:this.expedition.rank,race:this.expedition.race?{next:this.expedition.race.next,elapsed:this.expedition.race.elapsed}:null,target:this.expedition.target(state),save:this.expedition.saveStatus},
      photographicSky:!!this.photographicSky,waterHeightCache:this.waterHeights.diagnostics,marineScans:this.marine.group.userData.scannedRocks,niijimaMaterials:{...this.world.niijimaCoast.materialDiagnostics},
      worldSolids:this.solidBinding.stats,collision:this.collision.stats,
      spray:this.spray.diagnostics,habushiGate:this.world.habushiGate.diagnostics,habushiGround:this.world.habushiGround.diagnostics,
      shoreSolver:this.shoreSolver?{...this.shoreSolver.diagnostics,ready:this.uniforms.uShoreReady.value}:null,
      photoCoast:this.photoCoast?{instances:this.photoCoast.diagnostics.instances,triangles:this.photoCoast.diagnostics.triangles,draws:this.photoCoast.diagnostics.draws,roles:this.photoCoast.diagnostics.roles}:null,
      scannedCoast:this.scannedCoastInstances.map(m=>({name:m.name,count:m.count})),
      reefShelves:this.scannedCoast.children.filter(m=>m.userData.groundedShelf).map(m=>({name:m.name,...m.userData.groundedShelf})),
      ground:this.world.heightAt(state.position.x,state.position.z),programs:this.renderer.info.programs?.length,
      draws:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.animationFrame);this.abort.abort();
    this.captureNextFrame?.(null);this.captureNextFrame=null;
    this.gpuSkinnedReceivers?.dispose();this.skinnedReceivers?.dispose();this.receiverBridge?.dispose();this.receiverSand?.textures.forEach(texture=>texture.dispose());
    this.photoCoast?.dispose();this.scannedCoastInstances.forEach(instance=>instance.dispose());this.scannedCoast.clear();
    this.reefGeometries.forEach(geometry=>geometry.dispose());
    this.solidBinding.dispose();this.collision.dispose();this.spray.dispose();this.breaker?.dispose();
    this.shoreSolver?.dispose();
    this.expeditionWorld.dispose();this.adventure.dispose();this.body.dispose();this.waterHeights.dispose();this.assets.dispose();this.marine.dispose();this.world.dispose();this.simulation.dispose();
    this.materials.forEach(m=>m.dispose());this.meshGeometries.forEach(g=>g.dispose());
    this.environmentTargets.forEach(t=>t.dispose());this.pmrem.dispose();this.sun.shadow.dispose();this.compositor.dispose();
    this.caustics.dispose();this.reflection.dispose();this.reflection.geometry.dispose();this.photographicSky?.texture.dispose();this.renderer.dispose();
  }
}
