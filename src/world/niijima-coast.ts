import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import type {CliffSkin} from './niijima-cliff-skin.ts';
import {MeasuredNiijimaTile} from './niijima-measured.ts';
import {createMeasuredGridPatch,type MeasuredGridPatch} from './measured-grid-patch.ts';
type ReconstructedSurface=Pick<CliffSkin,'group'|'geometries'|'surfaceHeightAt'|'coversOriginalTriangle'>;
import { NiijimaDEM, NiijimaSurface, NIIJIMA_DETAIL_PROVENANCE, NIIJIMA_SEDIMENT_PROVENANCE, ease, noise, type SurfaceBounds } from './niijima-detail.ts';
import { ELEVATION_RASTERS } from './geodata.generated.ts';
import { NIIJIMA_NORTH_RASTER, NIIJIMA_NORTH_PROVENANCE } from './niijima-north.generated.ts';
import { NIIJIMA_SOUTH_RASTER, NIIJIMA_SOUTH_PROVENANCE } from './niijima-south.generated.ts';
import type { SandTextureSet } from './sand-material.ts';
import { niijimaScarpApronHeight } from './niijima-scarp.ts';
import {wetSandUniforms,wetSandSampling} from './coastal-wet-sand.ts';
import {loadCliffTextures,cliffMaterialCommon,cliffMaterialColour,cliffMaterialNormal,type CliffTextureSet} from './niijima-rock-material.ts';
export { NIIJIMA_DETAIL_PROVENANCE };
export { NIIJIMA_NORTH_PROVENANCE };
export { NIIJIMA_SOUTH_PROVENANCE };
const pumiceURL=new URL('../assets/niijima/pumice-albedo-generated-v9.png',import.meta.url).href;
const pumiceWhite=new THREE.Color('#e5e1d8'),pumiceSand=new THREE.Color('#dedbce'),pumiceGreen=new THREE.Color('#506346'),pumiceShade=new THREE.Color('#c8c5b9');

// Edges coincide with complete existing 64m renderer cells. This prevents a crack when
// IslandWorld omits coarse cells whose centres are in bounds. Internal grids divide those cells.
const legacy = ELEVATION_RASTERS.find(raster => raster.id === 'niijima')!;
const coarseDX = (legacy.maxX - legacy.minX) / (legacy.width - 1) * 2;
const coarseDZ = (legacy.maxZ - legacy.minZ) / (legacy.height - 1) * 2;
const SOUTH_BOUNDS = { minX: legacy.minX + coarseDX * 37, maxX: legacy.minX + coarseDX * 72,
  minZ: legacy.minZ + coarseDZ * 132, maxZ: legacy.minZ + coarseDZ * 189 };
const BASE_BOUNDS = { ...SOUTH_BOUNDS, maxX: legacy.minX + coarseDX * 92, minZ: legacy.minZ + coarseDZ * 61,
  maxZ:legacy.minZ+coarseDZ*Math.floor((NIIJIMA_SOUTH_RASTER.maxZ-legacy.minZ)/coarseDZ) };
const step = { x: coarseDX / 8, z: coarseDZ / 8 };
const patchBounds = (x: number, z: number, width: number, height: number): SurfaceBounds => ({
  minX: SOUTH_BOUNDS.minX + x * step.x, maxX: SOUTH_BOUNDS.minX + (x + width) * step.x,
  minZ: SOUTH_BOUNDS.minZ + z * step.z, maxZ: SOUTH_BOUNDS.minZ + (z + height) * step.z,
});
const PATCHES = [
  { bounds: patchBounds(142, 100, 62, 252), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Secret and Shiromama / 2m authored surface' },
  { bounds: patchBounds(160, 38, 42, 62), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Horikiri entrance coast / 2m authored surface' },
  { bounds: patchBounds(112, 352, 92, 260), spacing: { x: step.x / 2, z: step.z / 2 }, name: 'Southern long strand / 4m authored surface' },
  { bounds: patchBounds(270, -568, 96, 160), spacing: { x: step.x / 2, z: step.z / 2 }, name: 'Northern headlands / 4m authored surface' },
  { bounds: patchBounds(200, -408, 96, 78), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Habushi northern bend / 2m authored surface' },
  { bounds: patchBounds(180, -330, 54, 126), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Habushi long northern strand / 2m authored surface' },
  { bounds: patchBounds(172, -204, 42, 126), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Habushi Main Gate strand / 2m authored surface' },
  { bounds: patchBounds(168, -78, 38, 116), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Habushi southern strand / 2m authored surface' },
] as const;

export const NIIJIMA_COAST_BOOKMARKS = [
  { id: 'habushi', label: '羽伏浦メインゲート前の浜', lat: 34.3764393, lon: 139.2755897, source: 'https://niijima-info.jp/course/2499/', precision: 'Official-linked Google place marker; camera and approach are authored.' },
  { id: 'horikiri', label: '堀切入口', lat: 34.35561844, lon: 139.2758477, source: NIIJIMA_DETAIL_PROVENANCE.locationSource, precision: 'Official municipal visitor-map marker; separate from White Mama and the Secret surf point.' },
  { id: 'secret', label: 'シークレット', lat: 34.34428046, lon: 139.2757618, source: NIIJIMA_DETAIL_PROVENANCE.locationSource, precision: 'Official municipal visitor-map marker; distinct from entrance.' },
] as const;

/** Niijima's chalk-white pumice and talus, distinct from Tomari's darker jointed rocks. */
function pumiceMaterial(base: THREE.MeshStandardMaterial,sand?:SandTextureSet,pumice?:THREE.Texture,ready?:THREE.IUniform,water?:Record<string,THREE.IUniform>,detail?:CliffTextureSet,detailAmount?:THREE.IUniform): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.name = 'Niijima white layered pumice, pale strand and talus';
  material.vertexColors = true; material.color.set(0xffffff); material.roughness = .96; material.metalness = 0;
  material.map = material.normalMap = material.bumpMap = material.roughnessMap = material.metalnessMap = material.aoMap = null;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms,{uPumicePhoto:{value:pumice},uPumiceReady:ready??{value:0}});
    if(detail)Object.assign(shader.uniforms,{uCliffAlbedo:{value:detail.albedo},uCliffNormal:{value:detail.normal},uCliffARM:{value:detail.arm},uCliffReady:detail.available,uCliffDetail:detailAmount,uCliffTileMetres:detail.tileMetres,uCliffMeanLuminance:detail.meanLuminance});
    if(sand&&water)Object.assign(shader.uniforms,water);
    if(sand)Object.assign(shader.uniforms,{uNiiSandAlbedo:{value:sand.albedo},uNiiSandNormal:{value:sand.normalGL},uNiiSandARM:{value:sand.arm}});
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNiijimaPoint;varying vec3 vNiijimaSurfaceNormal;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNiijimaPoint = (modelMatrix * vec4(transformed, 1.0)).xyz - vec3(5500.0, 0.0, -2000.0);vNiijimaSurfaceNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNiijimaPoint;varying vec3 vNiijimaSurfaceNormal;
      uniform sampler2D uPumicePhoto;uniform float uPumiceReady;
      ${detail?cliffMaterialCommon:''}
      ${sand?'uniform sampler2D uNiiSandAlbedo,uNiiSandNormal,uNiiSandARM;':''}
      ${sand?wetSandSampling:''}
      float niiHash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
      float niiNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(niiHash(i),niiHash(i+vec3(1,0,0)),f.x),mix(niiHash(i+vec3(0,1,0)),niiHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(niiHash(i+vec3(0,0,1)),niiHash(i+vec3(1,0,1)),f.x),mix(niiHash(i+vec3(0,1,1)),niiHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      // Thin ash beds follow absolute elevation, with slow lateral warping.
      // Colour and relief share a field; loose talus is softened by actual slope.
      vec3 niiStrata(vec3 p) {
        float elevation=p.y+(niiNoise(vec3(p.x*.031,0.,p.z*.043))-.5)*1.1+(niiNoise(vec3(0.,p.y*.14,2.))-.5)*1.2;
        float unit=elevation/1.8;
        float layer=floor(unit),phase=fract(unit);
        float seamAt=.23+.39*niiNoise(vec3(layer,17.,4.));
        float width=.035+.043*niiNoise(vec3(layer,2.,9.));
        float seam=exp(-pow((phase-seamAt)/width,2.));
        float continuity=smoothstep(.15,.55,niiNoise(vec3(p.x*.06,layer*.37,p.z*.045)));
        float thin=sin(elevation*16.5+niiNoise(vec3(0.,elevation*.25,p.z*.045))*1.8);
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        float fineFilter=1.-smoothstep(.06,.22,footprint);
        float seamFilter=1.-smoothstep(.55,1.5,footprint/max(.01,width*1.8));
        float relief=-.012*seam*continuity*seamFilter+.0018*thin*fineFilter;
        float tint=.985+.030*niiNoise(vec3(layer,5.,9.))-.036*seam*continuity*seamFilter;
        return vec3(relief,tint,seam*continuity);
      }
      float niiRelief(vec3 p) {
        // Filter procedural relief by its WORLD footprint, so distant steep
        // faces cannot alias sub-centimetre grains into large checker patterns.
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        float grains=niiNoise(p*42.0)*.0014*(1.0-smoothstep(.35,.8,footprint*42.0))
          +niiNoise(p*13.0)*.003*(1.0-smoothstep(.35,.8,footprint*13.0));
        float pores=pow(niiNoise(p*5.0),5.0)*.008*(1.0-smoothstep(.35,.8,footprint*5.0));
        float layers=(niiNoise(vec3(p.x*.045,p.y*2.8,p.z*.045))-.5)*.016*(1.0-smoothstep(.35,.8,footprint*2.8));
        return grains-pores+layers*smoothstep(4.0,12.0,p.y);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float niiBand=niiNoise(vec3(vNiijimaPoint.x*.012,vNiijimaPoint.y*.36+niiNoise(vNiijimaPoint*.017)*.65,vNiijimaPoint.z*.014))-.5;
      float niiMacro=niiNoise(vNiijimaPoint*vec3(.046,.072,.046))-.5;
      float niiFine=niiNoise(vNiijimaPoint*3.4);
      float niiDry=smoothstep(-.15,1.1,vNiijimaPoint.y);
      diffuseColor.rgb*=.94+niiFine*.075+(niiBand*.16+niiMacro*.17)*smoothstep(5.0,20.0,vNiijimaPoint.y);
      diffuseColor.rgb*=mix(.80,1.0,niiDry);
      vec3 niiFaceAxis=abs(normalize(cross(dFdx(vNiijimaPoint),dFdy(vNiijimaPoint))));
      vec3 niiWeights=pow(niiFaceAxis,vec3(5));niiWeights/=max(.0001,dot(niiWeights,vec3(1)));
      vec2 niiUVX=vNiijimaPoint.zy/2.0,niiUVY=vNiijimaPoint.xz/2.0,niiUVZ=vNiijimaPoint.xy/2.0;
      vec2 niiDXx=dFdx(niiUVX),niiDYx=dFdy(niiUVX),niiDXy=dFdx(niiUVY),niiDYy=dFdy(niiUVY),niiDXz=dFdx(niiUVZ),niiDYz=dFdy(niiUVZ);
      float niiRockPhotoMask=smoothstep(3.0,9.0,vNiijimaPoint.y)*(1.0-smoothstep(.66,.92,niiFaceAxis.y));
      float niiExposedFace=smoothstep(5.,12.,vNiijimaPoint.y)*(1.-smoothstep(.48,.79,niiFaceAxis.y));
      vec3 niiBedding=niiStrata(vNiijimaPoint);
      if(uPumiceReady>.5&&niiRockPhotoMask>.001${detail?'&&uCliffDetail*uCliffReady<.01':''}){
        // Generated intrinsic surface variation, registered in world metres.
        // Explicit gradients retain mip filtering at the branch boundary.
        vec3 niiPhoto=textureGrad(uPumicePhoto,niiUVX,niiDXx,niiDYx).rgb*niiWeights.x
          +textureGrad(uPumicePhoto,niiUVY,niiDXy,niiDYy).rgb*niiWeights.y
          +textureGrad(uPumicePhoto,niiUVZ,niiDXz,niiDYz).rgb*niiWeights.z;
        diffuseColor.rgb*=mix(vec3(1),clamp(niiPhoto/.69,vec3(.45),vec3(1.18)),niiRockPhotoMask*.85);
      }
      ${detail?cliffMaterialColour:''}
      ${sand?`
      // Material identity must not switch from sand to white rock on every
      // individual survey triangle. Use the continuous shading normal.
      vec3 niiGeometricNormal=normalize(vNiijimaSurfaceNormal);
      float niiSandMask=(1.0-smoothstep(4.0,8.0,vNiijimaPoint.y))*smoothstep(.6,.92,abs(niiGeometricNormal.y));
      vec2 niiSandUV=vNiijimaPoint.xz/2.14;
      vec3 niiSandPhoto=texture2D(uNiiSandAlbedo,niiSandUV).rgb;
      // Neutralize the generic photograph's brown cast, retaining measured
      // within-surface variation instead of recolouring the entire cliff.
      float niiSandGrain=clamp(dot(niiSandPhoto,vec3(.2126,.7152,.0722))/.1011,.60,1.35);
      float niiWash=pow(abs(sin(vNiijimaPoint.x*2.3+niiNoise(vNiijimaPoint*.09)*1.7)),4.0);
      float niiWet=1.0-smoothstep(.15,2.1,vNiijimaPoint.y+niiNoise(vNiijimaPoint*.035)*.35);
      float niiFilm=0.;
      if(niiSandMask>.001&&vNiijimaPoint.y<4.){
        if(uSandMemoryEnabled>.5){
          vec2 wetState=sandWetState(vNiijimaPoint+vec3(5500,0,-2000));
          // A faint pre-existing damp band is authored; dynamic darkening and
          // gloss depend on actual contact and separate decay histories.
          niiWet=max(niiWet*.28,wetState.x);niiFilm=wetState.y;
        }else niiWet=max(niiWet*.78,sandWaterFilm(vNiijimaPoint+vec3(5500,0,-2000)));
      }
      diffuseColor.rgb*=mix(vec3(1),vec3(niiSandGrain*(1.0-.10*niiWash)*mix(1.0,.45,niiWet)),niiSandMask);
      // The observed White Mama strand has dark, fine deposits and long
      // meandering wash lines. This bounded distribution is authored; the
      // photograph is not copied into the material or treated as a survey.
      float niiAshRegion=smoothstep(950.0,1040.0,vNiijimaPoint.z)*(1.0-smoothstep(1400.0,1510.0,vNiijimaPoint.z));
      float niiDeposit=niiNoise(vec3(vNiijimaPoint.x*.65,0.0,vNiijimaPoint.z*.024));
      float niiStrand=(1.0-smoothstep(2.4,5.0,vNiijimaPoint.y))*niiSandMask*niiAshRegion;
      diffuseColor.rgb*=mix(1.0,.36+.22*niiDeposit,niiStrand*.85);
      `:''}
    `);
    if(sand)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float niiSandR=texture2D(uNiiSandARM,niiSandUV).g;
      float niiRoughness=mix(.80+.16*niiSandR,.30+.16*niiSandR,niiWet);
      if(uSandMemoryEnabled>.5)niiRoughness=mix(mix(.80+.16*niiSandR,.58+.14*niiSandR,niiWet),.18+.09*niiSandR,niiFilm);
      roughnessFactor=mix(roughnessFactor,niiRoughness,niiSandMask);
      ${detail?'roughnessFactor=mix(roughnessFactor,clamp(.84+.12*cliffARM.g,.84,.98),cliffAmount);':''}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float niiBump=niiRelief(vNiijimaPoint)${detail?'+niiBedding.x*niiExposedFace*uCliffReady*uCliffDetail':''};
      vec3 niiQ0=dFdx(-vViewPosition), niiQ1=dFdy(-vViewPosition);
      vec3 niiR0=cross(niiQ1,normal), niiR1=cross(normal,niiQ0);
      float niiDet=dot(niiQ0,niiR0);
      normal=normalize(abs(niiDet)*normal-sign(niiDet)*(dFdx(niiBump)*niiR0+dFdy(niiBump)*niiR1));
      ${detail?cliffMaterialNormal:''}
      ${sand?`
      vec3 niiWorldNormal=inverseTransformDirection(normal,viewMatrix);
      vec3 niiTx=normalize(vec3(1,-niiWorldNormal.x/max(.2,niiWorldNormal.y),0));
      vec3 niiTz=normalize(cross(niiTx,niiWorldNormal));
      vec3 niiSampleNormal=texture2D(uNiiSandNormal,niiSandUV).xyz*2.0-1.0;
      vec3 niiMapped=normalize(niiTx*niiSampleNormal.x*.32+niiTz*niiSampleNormal.y*.32+niiWorldNormal*niiSampleNormal.z);
      normal=normalize(mix(normal,mat3(viewMatrix)*niiMapped,niiSandMask));
      `:''}
    `);
  };
  material.customProgramCacheKey = () => 'niijima-pumice-metre-detail-v54-'+!!detail;
  return material;
}

/** One bounded replacement surface with nested fine grids and a matched depth texture. */
export class NiijimaCoast implements GroundSampler {
  readonly group = new THREE.Group();
  readonly bounds: SurfaceBounds = BASE_BOUNDS;
  readonly dem:NiijimaDEM;
  readonly measured:MeasuredNiijimaTile|null;
  readonly measuredPatch:MeasuredGridPatch|null=null;
  readonly northDem = new NiijimaDEM(NIIJIMA_NORTH_RASTER);
  readonly southDem = new NiijimaDEM(NIIJIMA_SOUTH_RASTER);
  readonly surfaces: readonly NiijimaSurface[];
  readonly triangleCount: number;
  readonly ready:Promise<void>;
  readonly detailAmount={value:1};
  private readonly detailTextures:CliffTextureSet|null;
  readonly materialDiagnostics:{pumice:'loading'|'ready'|'failed'|'not-loaded';detail?:string;detailAsset?:string;tileMetres?:number}={pumice:'loading'};
  private readonly pumiceTexture:THREE.Texture;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly waterUniforms=wetSandUniforms();
  private readonly baseGround: GroundSampler;
  private cliffSurface:ReconstructedSurface|null=null;
  private readonly cliffReplaced=new Map<NiijimaSurface,Uint8Array>();
  readonly cliffReplacement={removedTriangles:0,queriedTriangles:0};
  private readonly maps = new Map<string, { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 }>();

  constructor(baseGround: GroundSampler, material: THREE.MeshStandardMaterial,options:{scarp?:boolean;volume?:boolean;sand?:SandTextureSet;coastConfidence?:boolean;cliffDetail?:boolean;measured?:boolean;pumiceGrain?:boolean}={}) {
    this.dem=new NiijimaDEM(undefined,{scarp:options.scarp??false,coastConfidence:options.coastConfidence});
    this.baseGround = baseGround;
    this.measured=options.measured?new MeasuredNiijimaTile():null;
    this.group.name = 'Niijima Horikiri, Shiromama and actual Secret surf region';
    this.group.userData = { source: NIIJIMA_DETAIL_PROVENANCE, northernSource: NIIJIMA_NORTH_PROVENANCE,southernSource:NIIJIMA_SOUTH_PROVENANCE, measuredMacroshape: 'GSI DEM5A/DEM10B', authoredMicrorelief: true, bathymetry: 'inferred',scarpCandidate:options.scarp??false };
    this.group.userData.sediment=NIIJIMA_SEDIMENT_PROVENANCE;
    this.group.userData.coastConfidence=this.dem.coastConfidence;
    this.group.userData.wetSand='Actual wave contact with local ground-fixed optical damp/film memory; authored decay and baseline, not measured hydrology or sediment transport';
    const pumiceReady={value:0};
    let resolvePumice:()=>void=()=>{};
    const pumicePending=new Promise<void>(resolve=>{resolvePumice=resolve;});
    this.detailTextures=options.cliffDetail?loadCliffTextures(options.pumiceGrain):null;
    if(this.detailTextures){
      this.materialDiagnostics.detail='loading';this.materialDiagnostics.detailAsset=options.pumiceGrain?'generated-pumice-grain-v54':'CC0-rock-face-03-analogue';this.materialDiagnostics.tileMetres=this.detailTextures.tileMetres.value;
      void this.detailTextures.ready.then(()=>{this.materialDiagnostics.detail=typeof document==='undefined'?'cpu-placeholder':this.detailTextures!.available.value===1?'ready':'failed';});
    }
    this.ready=Promise.all([pumicePending,...(this.detailTextures?[this.detailTextures.ready]:[])]).then(()=>{});
    this.pumiceTexture=typeof document!=='undefined'?new THREE.TextureLoader().load(pumiceURL,()=>{pumiceReady.value=1;this.materialDiagnostics.pumice='ready';resolvePumice();},undefined,()=>{this.materialDiagnostics.pumice='failed';console.warn('Niijima pumice image unavailable; procedural fallback retained');resolvePumice();}):new THREE.Texture();
    if(typeof document==='undefined'){this.materialDiagnostics.pumice='not-loaded';resolvePumice();}
    this.pumiceTexture.colorSpace=THREE.SRGBColorSpace;this.pumiceTexture.wrapS=this.pumiceTexture.wrapT=THREE.RepeatWrapping;
    this.pumiceTexture.anisotropy=8;this.pumiceTexture.minFilter=THREE.LinearMipmapLinearFilter;
    this.material = pumiceMaterial(material,options.sand,this.pumiceTexture,pumiceReady,this.waterUniforms,this.detailTextures??undefined,this.detailAmount);
    const authored = { heightAt: (x: number, z: number) => {
      if(z>=-300&&z<=-100){const w=ease(-300,-100,z);return this.dem.refinedHeightAt(x,z)*(1-w)+this.southDem.refinedHeightAt(x,z)*w;}
      const y=this.demAt(z).refinedHeightAt(x,z);
      return options.volume?niijimaScarpApronHeight(this.dem,x,z,y):y;
    } };
    const distant = new NiijimaSurface(this.bounds, step, baseGround, authored, 20);
    const fine = PATCHES.map(patch => new NiijimaSurface(patch.bounds, patch.spacing, distant, authored, 16));
    const hero=options.scarp?[new NiijimaSurface(patchBounds(174,301,8,34),{x:step.x/16,z:step.z/8},fine[0],authored,8)]:[];
    fine.push(...hero);
    this.surfaces = [distant, ...fine];
    this.buildMesh(distant, fine, 'Niijima measured mountain and distant coast / 8m');
    fine.forEach((surface, i) => this.buildMesh(surface,hero.includes(surface)?[]:hero.filter(h=>surface.contains(h.bounds.minX,h.bounds.minZ)&&surface.contains(h.bounds.maxX,h.bounds.maxZ)),PATCHES[i]?.name??(this.measured?'Tokyo measured cliff / 0.5m lattice, 16m parent seam':'Secret connected close scarp / 0.5m x 1m authored surface')));
    if(this.measured){
      this.measuredPatch=createMeasuredGridPatch(this.measured.grid,{heightAt:(x,z)=>this.baseHeightAt(x,z)},this.material);
      const color=new THREE.Color();
      for(const object of this.measuredPatch.group.children){if(!(object instanceof THREE.Mesh))continue;
        const geometry=object.geometry,p=geometry.getAttribute('position'),colors=new Float32Array(p.count*3);
        for(let i=0;i<p.count;i++){this.colorAt(p.getX(i)+object.position.x,p.getY(i),p.getZ(i)+object.position.z,color);colors.set([color.r,color.g,color.b],i*3);}
        geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));object.castShadow=true;object.receiveShadow=true;
      }
      this.group.add(this.measuredPatch.group);
      this.replaceCliffSurface(this.measuredPatch,-Infinity);
    }
    this.triangleCount = this.geometries.reduce((count, geometry) => count + geometry.index!.count / 3, 0)+(this.measuredPatch?.diagnostics.triangles??0);
  }

  contains(x: number, z: number): boolean { const b = this.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  /** Bind once before material compilation; values then track ocean updates. */
  bindWaterSurface(uniforms:Record<string,THREE.IUniform>):void{
    for(const key of Object.keys(this.waterUniforms))if(uniforms[key])this.waterUniforms[key]=uniforms[key];
  }
  invalidateWaterMaps():void{for(const map of this.maps.values())map.texture.dispose();this.maps.clear();}
  heightAt(x: number, z: number): number {
    if(this.cliffSurface)for(let i=this.surfaces.length-1;i>=0;i--){const s=this.surfaces[i];if(!s.contains(x,z))continue;const mask=this.cliffReplaced.get(s);if(mask){const px=Math.max(0,Math.min(s.width-1,(x-s.bounds.minX)/s.dx)),pz=Math.max(0,Math.min(s.height-1,(z-s.bounds.minZ)/s.dz)),ix=Math.min(s.width-2,Math.floor(px)),iz=Math.min(s.height-2,Math.floor(pz));const index=(iz*(s.width-1)+ix)*2+(px-ix+pz-iz>1?1:0);if(mask[index]){const y=this.cliffSurface.surfaceHeightAt(x,z);if(y!==null)return y;}}break;}
    const base=this.baseHeightAt(x,z),measured=this.measuredPatch?.surfaceHeightAt(x,z);
    return measured===undefined||measured===null?base:Math.max(base,measured);
  }
  baseHeightAt(x:number,z:number):number{
    if (!this.contains(x, z)) return this.baseGround.heightAt(x, z);
    for (let i = this.surfaces.length - 1; i > 0; i--) if (this.surfaces[i].contains(x, z)) return this.surfaces[i].heightAt(x, z);
    return this.surfaces[0].heightAt(x, z);
  }
  /** Replace only proven interior source triangles; the render and floor choose
   * the same projected triangle mask. The source DEM and base field remain intact. */
  replaceCliffSurface(skin:ReconstructedSurface,minimumHeight=6):void{
    if(this.cliffSurface)throw new Error('Cliff surface already attached');
    skin.group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(skin.group);
    for(const object of this.group.children){if(!(object instanceof THREE.Mesh)||!object.userData.surface)continue;
      const s=object.userData.surface as NiijimaSurface,g=object.geometry,p=g.getAttribute('position'),idx=g.index!;
      if(s.bounds.maxX<bounds.min.x||s.bounds.minX>bounds.max.x||s.bounds.maxZ<bounds.min.z||s.bounds.minZ>bounds.max.z)continue;
      const mask=new Uint8Array((s.width-1)*(s.height-1)*2),kept=new Uint32Array(idx.count);let count=0;
      for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)] as const;
        const points=ids.map(j=>({x:p.getX(j),y:p.getY(j),z:p.getZ(j)})) as [{x:number;y:number;z:number},{x:number;y:number;z:number},{x:number;y:number;z:number}];
        const inside=points.every(v=>v.x>bounds.min.x&&v.x<bounds.max.x&&v.z>bounds.min.z&&v.z<bounds.max.z&&v.y>minimumHeight);
        if(inside)this.cliffReplacement.queriedTriangles++;
        if(inside&&skin.coversOriginalTriangle(points)){
          const row=Math.floor(Math.min(...ids)/s.width),col=Math.min(...ids.map(j=>j%s.width)),a=row*s.width+col;
          mask[(row*(s.width-1)+col)*2+(ids.includes(a)?0:1)]=1;this.cliffReplacement.removedTriangles++;
        }else{kept[count++]=ids[0];kept[count++]=ids[1];kept[count++]=ids[2];}
      }
      this.cliffReplaced.set(s,mask);g.setIndex(new THREE.BufferAttribute(kept.slice(0,count),1));
    }
    this.cliffSurface=skin;for(const map of this.maps.values())map.texture.dispose();this.maps.clear();
  }

  /** Flatten only a built landmark's finite footprint, including its rendered
   * height grids and depth texture. This is authored grading, not source DEM. */
  applyGrading(grade:{center:{x:number;z:number};level:number;halfWidth:number;halfDepth:number;feather:number;rotation:number}):void{
    const c=Math.cos(grade.rotation),s=Math.sin(grade.rotation);
    const weight=(x:number,z:number):number=>{
      const dx=x-grade.center.x,dz=z-grade.center.z;
      const localX=c*dx-s*dz,localZ=s*dx+c*dz;
      const outside=Math.max(Math.abs(localX)-grade.halfWidth,Math.abs(localZ)-grade.halfDepth);
      return 1-ease(0,grade.feather,outside);
    };
    for(const surface of this.surfaces){
      for(let iz=0;iz<surface.height;iz++)for(let ix=0;ix<surface.width;ix++){
        const x=surface.bounds.minX+ix*surface.dx,z=surface.bounds.minZ+iz*surface.dz,w=weight(x,z);
        if(w>0){const index=iz*surface.width+ix;surface.ground[index]+=(grade.level-surface.ground[index])*w;}
      }
    }
    for(const geometry of this.geometries){
      const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');let changed=false;
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),z=positions.getZ(i);
        // Include the normal transition immediately outside the grading edge.
        if(Math.hypot(x-grade.center.x,z-grade.center.z)>Math.hypot(grade.halfWidth,grade.halfDepth)+grade.feather+2)continue;
        positions.setY(i,this.heightAt(x,z));
        const nx=this.heightAt(x-.5,z)-this.heightAt(x+.5,z),nz=this.heightAt(x,z-.5)-this.heightAt(x,z+.5),length=Math.hypot(nx,1,nz);
        normals.setXYZ(i,nx/length,1/length,nz/length);changed=true;
      }
      if(changed){positions.needsUpdate=true;normals.needsUpdate=true;geometry.computeBoundingSphere();geometry.computeBoundingBox();}
    }
    for(const map of this.maps.values())map.texture.dispose();this.maps.clear();
    this.group.userData.landmarkGrading={...grade,provenance:'Authored bounded foundation level; not a surveyed elevation'};
  }

  colorAt(x:number,y:number,z:number,target:THREE.Color):THREE.Color{
    const dem=this.demAt(z),slope=Math.hypot(dem.heightAt(x+3,z)-dem.heightAt(x-3,z),dem.heightAt(x,z+3)-dem.heightAt(x,z-3))/6;
    const d=dem.shoreAt(x,z),beach=(1-ease(3,9,y))*(1-ease(.3,.85,slope)),canopy=ease(25,45,y)*(1-ease(.22,.75,slope))*ease(75,160,d);
    return target.copy(pumiceWhite).lerp(pumiceShade,noise(x*.017,z*.017)*.17).lerp(pumiceSand,beach).lerp(pumiceGreen,canopy).multiplyScalar(.96+noise(x*.15,z*.15)*.06);
  }
  waterMap(x = 5990, z = -1600): { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 } {
    const measuredBounds=this.measured?.bounds,nearSurvey=measuredBounds&&x>measuredBounds.minX-64&&x<measuredBounds.maxX+64&&z>measuredBounds.minZ-64&&z<measuredBounds.maxZ+64;
    const divisor=nearSurvey?32:8,dx = step.x / divisor, dz = step.z / divisor, span = 2048;
    // Keep the entire 192m SWE domain and its neighbor stencil inside every
    // map even just before a tile switches. The former 1536 stride gave only
    // 63m guard at 25cm spacing, incorrectly initializing cliff cells as sea.
    const stride=nearSurvey?1024:1536;
    const tileX = Math.round((x - this.bounds.minX) / dx / stride), tileZ = Math.round((z - this.bounds.minZ) / dz / stride), key = `${divisor}:${tileX}:${tileZ}`;
    const cached = this.maps.get(key); if (cached) return cached;
    // Close to the survey, sample the actual native-triangle floor at ~0.25m
    // for water contact. Farther views retain the wider original map extent.
    // Overlapping tiles remain below 4096 texture limits.
    const b = { minX: this.bounds.minX + (tileX * stride - span / 2) * dx, minZ: this.bounds.minZ + (tileZ * stride - span / 2) * dz };
    const width = span + 1, height = span + 1;
    const bytes = new Uint16Array(width * height * 4);
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const px = b.minX + x * dx, pz = b.minZ + z * dz, y = this.heightAt(px, pz), i = (z * width + x) * 4;
      bytes[i] = THREE.DataUtils.toHalfFloat(y); bytes[i + 1] = THREE.DataUtils.toHalfFloat(1); // Open Pacific coast: no invented cove shelter.
      bytes[i + 2] = THREE.DataUtils.toHalfFloat((1 - ease(3, 8, Math.abs(y))) * (1 - ease(50, 140, Math.abs(this.demAt(pz).shoreAt(px, pz)))));
      bytes[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.name = 'Niijima: R ground metres, G exposure, B sand, A valid; authored seabed';
    texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
    // A texel centre is at each ground sample. Padding half a sample is essential for GPU UV agreement.
    const map = { texture, origin: new THREE.Vector2(b.minX - dx / 2, b.minZ - dz / 2), size: new THREE.Vector2(width * dx, height * dz) };
    this.maps.set(key, map);
    if (this.maps.size > 2) { const oldest = this.maps.keys().next().value!; this.maps.get(oldest)!.texture.dispose(); this.maps.delete(oldest); }
    return map;
  }

  dispose(): void { this.measuredPatch?.dispose();this.geometries.forEach(geometry => geometry.dispose()); this.material.dispose();this.pumiceTexture.dispose();this.detailTextures?.textures.forEach(t=>t.dispose()); this.maps.forEach(map => map.texture.dispose()); this.maps.clear(); this.group.clear(); }

  private demAt(z: number): NiijimaDEM { return z < -3340 ? this.northDem : z>-200?this.southDem:this.dem; }

  private buildMesh(surface: NiijimaSurface, holes: readonly NiijimaSurface[], name: string): void {
    const b = surface.bounds, width = surface.width, height = surface.height;
    const positions = new Float32Array(width * height * 3), colors = new Float32Array(width * height * 3), uvs = new Float32Array(width * height * 2), indices: number[] = [];
    const c = new THREE.Color();
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const px = b.minX + x * surface.dx, pz = b.minZ + z * surface.dz, i = z * width + x, y = surface.ground[i];
      this.colorAt(px,y,pz,c);
      positions.set([px, y, pz], i * 3); colors.set([c.r, c.g, c.b], i * 3); uvs.set([px * .18, pz * .18], i * 2);
    }
    for (let z = 0; z + 1 < height; z++) for (let x = 0; x + 1 < width; x++) {
      const px = b.minX + (x + .5) * surface.dx, pz = b.minZ + (z + .5) * surface.dz;
      if (holes.some(hole => hole.contains(px, pz))) continue;
      const a = z * width + x, bb = a + 1, c = a + width, d = c + 1; indices.push(a, c, bb, bb, c, d);
    }
    const normals = new Float32Array(positions.length), normal = new THREE.Vector3();
    for (let i = 0; i < width * height; i++) {
      const x = positions[i * 3], z = positions[i * 3 + 2];
      // Sample the composite surface on both sides of patch joins, avoiding a lighting seam.
      normal.set(this.heightAt(x - .5, z) - this.heightAt(x + .5, z), 1, this.heightAt(x, z - .5) - this.heightAt(x, z + .5)).normalize();
      normals.set([normal.x, normal.y, normal.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material); mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.userData = { triangleCount: indices.length / 3, surface, measured: 'GSI land macroshape', refinement: 'authored sub-DEM erosion and sand', seabed: 'inferred' };
    this.geometries.push(geometry); this.group.add(mesh);
  }
}
