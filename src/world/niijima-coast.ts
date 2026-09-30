import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { NiijimaDEM, NiijimaSurface, NIIJIMA_DETAIL_PROVENANCE, ease, noise, type SurfaceBounds } from './niijima-detail.ts';
import { ELEVATION_RASTERS } from './geodata.generated.ts';
import { NIIJIMA_NORTH_RASTER, NIIJIMA_NORTH_PROVENANCE } from './niijima-north.generated.ts';
import { NIIJIMA_SOUTH_RASTER, NIIJIMA_SOUTH_PROVENANCE } from './niijima-south.generated.ts';
import type { SandTextureSet } from './sand-material.ts';
export { NIIJIMA_DETAIL_PROVENANCE };
export { NIIJIMA_NORTH_PROVENANCE };
export { NIIJIMA_SOUTH_PROVENANCE };

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
  { id: 'horikiri', label: '堀切・白ママ', lat: 34.35561844, lon: 139.2758477, source: NIIJIMA_DETAIL_PROVENANCE.locationSource, precision: 'Official municipal visitor-map marker.' },
  { id: 'secret', label: 'シークレット', lat: 34.34428046, lon: 139.2757618, source: NIIJIMA_DETAIL_PROVENANCE.locationSource, precision: 'Official municipal visitor-map marker; distinct from entrance.' },
] as const;

/** Niijima's chalk-white pumice and talus, distinct from Tomari's darker jointed rocks. */
function pumiceMaterial(base: THREE.MeshStandardMaterial,sand?:SandTextureSet): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.name = 'Niijima white layered pumice, pale strand and talus';
  material.vertexColors = true; material.color.set(0xffffff); material.roughness = .96; material.metalness = 0;
  material.map = material.normalMap = material.bumpMap = material.roughnessMap = material.metalnessMap = material.aoMap = null;
  material.onBeforeCompile = shader => {
    if(sand)Object.assign(shader.uniforms,{uNiiSandAlbedo:{value:sand.albedo},uNiiSandNormal:{value:sand.normalGL},uNiiSandARM:{value:sand.arm}});
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNiijimaPoint;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNiijimaPoint = position - vec3(5500.0, 0.0, -2000.0);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNiijimaPoint;
      ${sand?'uniform sampler2D uNiiSandAlbedo,uNiiSandNormal,uNiiSandARM;':''}
      float niiHash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
      float niiNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(niiHash(i),niiHash(i+vec3(1,0,0)),f.x),mix(niiHash(i+vec3(0,1,0)),niiHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(niiHash(i+vec3(0,0,1)),niiHash(i+vec3(1,0,1)),f.x),mix(niiHash(i+vec3(0,1,1)),niiHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float niiRelief(vec3 p) {
        // Filter procedural relief by its WORLD footprint, so distant steep
        // faces cannot alias sub-centimetre grains into large checker patterns.
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        float grains=niiNoise(p*42.0)*.0014*(1.0-smoothstep(.35,.8,footprint*42.0))
          +niiNoise(p*13.0)*.003*(1.0-smoothstep(.35,.8,footprint*13.0));
        float pores=pow(niiNoise(p*5.0),5.0)*.008*(1.0-smoothstep(.35,.8,footprint*5.0));
        float layers=sin(p.y*12.0+niiNoise(p*.12)*3.0)*.006*(1.0-smoothstep(.35,.8,footprint*1.91));
        return grains-pores+layers*smoothstep(4.0,12.0,p.y);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float niiBand=sin(vNiijimaPoint.y*.77+niiNoise(vNiijimaPoint*.025)*3.0);
      float niiFine=niiNoise(vNiijimaPoint*3.4);
      float niiDry=smoothstep(-.15,1.1,vNiijimaPoint.y);
      diffuseColor.rgb*=.95+niiFine*.07+niiBand*.022*smoothstep(5.0,20.0,vNiijimaPoint.y);
      diffuseColor.rgb*=mix(.80,1.0,niiDry);
      ${sand?`
      vec3 niiGeometricNormal=normalize(cross(dFdx(vNiijimaPoint),dFdy(vNiijimaPoint)));
      float niiSandMask=(1.0-smoothstep(4.0,8.0,vNiijimaPoint.y))*smoothstep(.6,.92,abs(niiGeometricNormal.y));
      vec2 niiSandUV=vNiijimaPoint.xz/2.14;
      vec3 niiSandPhoto=texture2D(uNiiSandAlbedo,niiSandUV).rgb;
      // Neutralize the generic photograph's brown cast, retaining measured
      // within-surface variation instead of recolouring the entire cliff.
      float niiSandGrain=clamp(dot(niiSandPhoto,vec3(.2126,.7152,.0722))/.1011,.60,1.35);
      float niiWash=pow(abs(sin(vNiijimaPoint.x*2.3+niiNoise(vNiijimaPoint*.09)*1.7)),4.0);
      float niiWet=1.0-smoothstep(.15,2.1,vNiijimaPoint.y+niiNoise(vNiijimaPoint*.035)*.35);
      diffuseColor.rgb*=mix(vec3(1),vec3(niiSandGrain*(1.0-.10*niiWash)*mix(1.0,.45,niiWet)),niiSandMask);
      `:''}
    `);
    if(sand)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float niiSandR=texture2D(uNiiSandARM,niiSandUV).g;
      roughnessFactor=mix(roughnessFactor,mix(.80+.16*niiSandR,.30+.16*niiSandR,niiWet),niiSandMask);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float niiBump=niiRelief(vNiijimaPoint);
      vec3 niiQ0=dFdx(-vViewPosition), niiQ1=dFdy(-vViewPosition);
      vec3 niiR0=cross(niiQ1,normal), niiR1=cross(normal,niiQ0);
      float niiDet=dot(niiQ0,niiR0);
      normal=normalize(abs(niiDet)*normal-sign(niiDet)*(dFdx(niiBump)*niiR0+dFdy(niiBump)*niiR1));
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
  material.customProgramCacheKey = () => 'niijima-pumice-v1';
  return material;
}

/** One bounded replacement surface with nested fine grids and a matched depth texture. */
export class NiijimaCoast implements GroundSampler {
  readonly group = new THREE.Group();
  readonly bounds: SurfaceBounds = BASE_BOUNDS;
  readonly dem:NiijimaDEM;
  readonly northDem = new NiijimaDEM(NIIJIMA_NORTH_RASTER);
  readonly southDem = new NiijimaDEM(NIIJIMA_SOUTH_RASTER);
  readonly surfaces: readonly NiijimaSurface[];
  readonly triangleCount: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly baseGround: GroundSampler;
  private readonly maps = new Map<string, { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 }>();

  constructor(baseGround: GroundSampler, material: THREE.MeshStandardMaterial,options:{scarp?:boolean;sand?:SandTextureSet}={}) {
    this.dem=new NiijimaDEM(undefined,{scarp:options.scarp??false});
    this.baseGround = baseGround;
    this.group.name = 'Niijima Horikiri, Shiromama and actual Secret surf region';
    this.group.userData = { source: NIIJIMA_DETAIL_PROVENANCE, northernSource: NIIJIMA_NORTH_PROVENANCE,southernSource:NIIJIMA_SOUTH_PROVENANCE, measuredMacroshape: 'GSI DEM5A/DEM10B', authoredMicrorelief: true, bathymetry: 'inferred',scarpCandidate:options.scarp??false };
    this.material = pumiceMaterial(material,options.sand);
    const authored = { heightAt: (x: number, z: number) => {
      if(z>=-300&&z<=-100){const w=ease(-300,-100,z);return this.dem.refinedHeightAt(x,z)*(1-w)+this.southDem.refinedHeightAt(x,z)*w;}
      return this.demAt(z).refinedHeightAt(x, z);
    } };
    const distant = new NiijimaSurface(this.bounds, step, baseGround, authored, 20);
    const fine = PATCHES.map(patch => new NiijimaSurface(patch.bounds, patch.spacing, distant, authored, 16));
    const hero=options.scarp?[new NiijimaSurface(patchBounds(174,301,8,34),{x:step.x/16,z:step.z/8},fine[0],authored,8)]:[];
    fine.push(...hero);
    this.surfaces = [distant, ...fine];
    this.buildMesh(distant, fine, 'Niijima measured mountain and distant coast / 8m');
    fine.forEach((surface, i) => this.buildMesh(surface,hero.includes(surface)?[]:hero.filter(h=>surface.contains(h.bounds.minX,h.bounds.minZ)&&surface.contains(h.bounds.maxX,h.bounds.maxZ)),PATCHES[i]?.name??'Secret connected close scarp / 0.5m x 1m authored surface'));
    this.triangleCount = this.geometries.reduce((count, geometry) => count + geometry.index!.count / 3, 0);
  }

  contains(x: number, z: number): boolean { const b = this.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  heightAt(x: number, z: number): number {
    if (!this.contains(x, z)) return this.baseGround.heightAt(x, z);
    for (let i = this.surfaces.length - 1; i > 0; i--) if (this.surfaces[i].contains(x, z)) return this.surfaces[i].heightAt(x, z);
    return this.surfaces[0].heightAt(x, z);
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

  waterMap(x = 5990, z = -1600): { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 } {
    const dx = step.x / 8, dz = step.z / 8, span = 2048, stride = 1536;
    const tileX = Math.round((x - this.bounds.minX) / dx / stride), tileZ = Math.round((z - this.bounds.minZ) / dz / stride), key = `${tileX}:${tileZ}`;
    const cached = this.maps.get(key); if (cached) return cached;
    // Overlapping ~2km tiles share the same global sample lattice and remain below 4096 texture limits.
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

  dispose(): void { this.geometries.forEach(geometry => geometry.dispose()); this.material.dispose(); this.maps.forEach(map => map.texture.dispose()); this.maps.clear(); this.group.clear(); }

  private demAt(z: number): NiijimaDEM { return z < -3340 ? this.northDem : z>-200?this.southDem:this.dem; }

  private buildMesh(surface: NiijimaSurface, holes: readonly NiijimaSurface[], name: string): void {
    const b = surface.bounds, width = surface.width, height = surface.height;
    const positions = new Float32Array(width * height * 3), colors = new Float32Array(width * height * 3), uvs = new Float32Array(width * height * 2), indices: number[] = [];
    const white = new THREE.Color('#e5e1d8'), sand = new THREE.Color('#dedbce'), greenery = new THREE.Color('#506346'), cliffShadow = new THREE.Color('#c8c5b9'), c = new THREE.Color();
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const px = b.minX + x * surface.dx, pz = b.minZ + z * surface.dz, i = z * width + x, y = surface.ground[i];
      const dem = this.demAt(pz), slope = Math.hypot(dem.heightAt(px + 3, pz) - dem.heightAt(px - 3, pz), dem.heightAt(px, pz + 3) - dem.heightAt(px, pz - 3)) / 6;
      const shoreline = dem.shoreAt(px, pz), beach = (1 - ease(3, 9, y)) * (1 - ease(.3, .85, slope));
      const canopy = ease(25, 45, y) * (1 - ease(.22, .75, slope)) * ease(75, 160, shoreline);
      c.copy(white).lerp(cliffShadow, noise(px * .017, pz * .017) * .17).lerp(sand, beach).lerp(greenery, canopy);
      c.multiplyScalar(.96 + noise(px * .15, pz * .15) * .06);
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
