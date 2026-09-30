import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { NiijimaDEM, NiijimaSurface, NIIJIMA_DETAIL_PROVENANCE, ease, noise, type SurfaceBounds } from './niijima-detail.ts';
import { ELEVATION_RASTERS } from './geodata.generated.ts';
export { NIIJIMA_DETAIL_PROVENANCE };

// Edges coincide with complete existing 64m renderer cells. This prevents a crack when
// IslandWorld omits coarse cells whose centres are in bounds. Internal grids divide those cells.
const legacy = ELEVATION_RASTERS.find(raster => raster.id === 'niijima')!;
const coarseDX = (legacy.maxX - legacy.minX) / (legacy.width - 1) * 2;
const coarseDZ = (legacy.maxZ - legacy.minZ) / (legacy.height - 1) * 2;
const BASE_BOUNDS = { minX: legacy.minX + coarseDX * 37, maxX: legacy.minX + coarseDX * 72,
  minZ: legacy.minZ + coarseDZ * 132, maxZ: legacy.minZ + coarseDZ * 189 };
const step = { x: coarseDX / 8, z: coarseDZ / 8 };
const patchBounds = (x: number, z: number, width: number, height: number): SurfaceBounds => ({
  minX: BASE_BOUNDS.minX + x * step.x, maxX: BASE_BOUNDS.minX + (x + width) * step.x,
  minZ: BASE_BOUNDS.minZ + z * step.z, maxZ: BASE_BOUNDS.minZ + (z + height) * step.z,
});
const PATCHES = [
  { bounds: patchBounds(142, 100, 62, 252), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Secret and Shiromama / 2m authored surface' },
  { bounds: patchBounds(160, 38, 42, 62), spacing: { x: step.x / 4, z: step.z / 4 }, name: 'Horikiri entrance coast / 2m authored surface' },
  { bounds: patchBounds(112, 352, 92, 90), spacing: { x: step.x / 2, z: step.z / 2 }, name: 'Southern long strand / 4m authored surface' },
] as const;

/** Niijima's chalk-white pumice and talus, distinct from Tomari's darker jointed rocks. */
function pumiceMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.name = 'Niijima white layered pumice, pale strand and talus';
  material.vertexColors = true; material.color.set(0xffffff); material.roughness = .96; material.metalness = 0;
  material.map = material.normalMap = material.bumpMap = material.roughnessMap = material.metalnessMap = material.aoMap = null;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNiijimaPoint;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNiijimaPoint = position - vec3(5500.0, 0.0, -2000.0);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNiijimaPoint;
      float niiHash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
      float niiNoise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(niiHash(i),niiHash(i+vec3(1,0,0)),f.x),mix(niiHash(i+vec3(0,1,0)),niiHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(niiHash(i+vec3(0,0,1)),niiHash(i+vec3(1,0,1)),f.x),mix(niiHash(i+vec3(0,1,1)),niiHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float niiRelief(vec3 p) {
        float grains=niiNoise(p*42.0)*.0014+niiNoise(p*13.0)*.003;
        float pores=pow(niiNoise(p*5.0),5.0)*.008;
        float layers=sin(p.y*12.0+niiNoise(p*.12)*3.0)*.006;
        return grains-pores+layers*smoothstep(4.0,12.0,p.y);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float niiBand=sin(vNiijimaPoint.y*.77+niiNoise(vNiijimaPoint*.025)*3.0);
      float niiFine=niiNoise(vNiijimaPoint*3.4);
      float niiDry=smoothstep(-.15,1.1,vNiijimaPoint.y);
      diffuseColor.rgb*=.95+niiFine*.07+niiBand*.022*smoothstep(5.0,20.0,vNiijimaPoint.y);
      diffuseColor.rgb*=mix(.80,1.0,niiDry);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float niiBump=niiRelief(vNiijimaPoint);
      vec3 niiQ0=dFdx(-vViewPosition), niiQ1=dFdy(-vViewPosition);
      vec3 niiR0=cross(niiQ1,normal), niiR1=cross(normal,niiQ0);
      float niiDet=dot(niiQ0,niiR0);
      normal=normalize(abs(niiDet)*normal-sign(niiDet)*(dFdx(niiBump)*niiR0+dFdy(niiBump)*niiR1));
    `);
  };
  material.customProgramCacheKey = () => 'niijima-pumice-v1';
  return material;
}

/** One bounded replacement surface with nested fine grids and a matched depth texture. */
export class NiijimaCoast implements GroundSampler {
  readonly group = new THREE.Group();
  readonly bounds: SurfaceBounds = BASE_BOUNDS;
  readonly dem = new NiijimaDEM();
  readonly surfaces: readonly NiijimaSurface[];
  readonly triangleCount: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly baseGround: GroundSampler;
  private map?: { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 };

  constructor(baseGround: GroundSampler, material: THREE.MeshStandardMaterial) {
    this.baseGround = baseGround;
    this.group.name = 'Niijima Horikiri, Shiromama and actual Secret surf region';
    this.group.userData = { source: NIIJIMA_DETAIL_PROVENANCE, measuredMacroshape: 'GSI DEM5A', authoredMicrorelief: true, bathymetry: 'inferred' };
    this.material = pumiceMaterial(material);
    const authored = { heightAt: (x: number, z: number) => this.dem.refinedHeightAt(x, z) };
    const distant = new NiijimaSurface(this.bounds, step, baseGround, authored, 20);
    const fine = PATCHES.map(patch => new NiijimaSurface(patch.bounds, patch.spacing, distant, authored, 16));
    this.surfaces = [distant, ...fine];
    this.buildMesh(distant, fine, 'Niijima measured mountain and distant coast / 8m');
    fine.forEach((surface, i) => this.buildMesh(surface, [], PATCHES[i].name));
    this.triangleCount = this.geometries.reduce((count, geometry) => count + geometry.index!.count / 3, 0);
  }

  contains(x: number, z: number): boolean { const b = this.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  heightAt(x: number, z: number): number {
    if (!this.contains(x, z)) return this.baseGround.heightAt(x, z);
    for (let i = this.surfaces.length - 1; i > 0; i--) if (this.surfaces[i].contains(x, z)) return this.surfaces[i].heightAt(x, z);
    return this.surfaces[0].heightAt(x, z);
  }

  waterMap(): { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2 } {
    if (this.map) return this.map;
    const b = this.bounds, width = (this.surfaces[0].width - 1) * 8 + 1, height = (this.surfaces[0].height - 1) * 8 + 1;
    const dx = (b.maxX - b.minX) / (width - 1), dz = (b.maxZ - b.minZ) / (height - 1);
    const bytes = new Uint16Array(width * height * 4);
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const px = b.minX + x * dx, pz = b.minZ + z * dz, y = this.heightAt(px, pz), i = (z * width + x) * 4;
      bytes[i] = THREE.DataUtils.toHalfFloat(y); bytes[i + 1] = THREE.DataUtils.toHalfFloat(1); // Open Pacific coast: no invented cove shelter.
      bytes[i + 2] = THREE.DataUtils.toHalfFloat((1 - ease(3, 8, Math.abs(y))) * (1 - ease(50, 140, Math.abs(this.dem.shoreAt(px, pz)))));
      bytes[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.name = 'Niijima: R ground metres, G exposure, B sand, A valid; authored seabed';
    texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
    // A texel centre is at each ground sample. Padding half a sample is essential for GPU UV agreement.
    this.map = { texture, origin: new THREE.Vector2(b.minX - dx / 2, b.minZ - dz / 2), size: new THREE.Vector2(width * dx, height * dz) };
    return this.map;
  }

  dispose(): void { this.geometries.forEach(geometry => geometry.dispose()); this.material.dispose(); this.map?.texture.dispose(); this.group.clear(); }

  private buildMesh(surface: NiijimaSurface, holes: readonly NiijimaSurface[], name: string): void {
    const b = surface.bounds, width = surface.width, height = surface.height;
    const positions = new Float32Array(width * height * 3), colors = new Float32Array(width * height * 3), uvs = new Float32Array(width * height * 2), indices: number[] = [];
    const white = new THREE.Color('#e5e1d8'), sand = new THREE.Color('#dedbce'), greenery = new THREE.Color('#506346'), cliffShadow = new THREE.Color('#c8c5b9'), c = new THREE.Color();
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const px = b.minX + x * surface.dx, pz = b.minZ + z * surface.dz, i = z * width + x, y = surface.ground[i];
      const slope = Math.hypot(this.dem.heightAt(px + 3, pz) - this.dem.heightAt(px - 3, pz), this.dem.heightAt(px, pz + 3) - this.dem.heightAt(px, pz - 3)) / 6;
      const shoreline = this.dem.shoreAt(px, pz), beach = (1 - ease(3, 9, y)) * (1 - ease(.3, .85, slope));
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
