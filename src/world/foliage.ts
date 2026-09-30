import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cylinderBetween, ModelResources, randomSeed, surfaceTexture } from './models/procedural.ts';
import { coarseFoliage, preserveLeafCoverage } from './foliage-coarse.ts';

const sourceAssets = [
  { kind: 'pine', id: 'island_tree_01', prefix: 'canopy0', variant: 0, count: 1, url: new URL('../assets/foliage/cc0/canopy/canopy0-lod-1k.glb', import.meta.url).href },
  { kind: 'pine', id: 'island_tree_02', prefix: 'canopy1', variant: 1, count: 1, url: new URL('../assets/foliage/cc0/canopy/canopy1-lod-1k.glb', import.meta.url).href },
  { kind: 'pine', id: 'island_tree_03', prefix: 'canopy2', variant: 2, count: 1, url: new URL('../assets/foliage/cc0/canopy/canopy2-lod-1k.glb', import.meta.url).href },
  { kind: 'shrub', id: 'shrub_02', prefix: 'shrub', variant: 0, count: 3, url: new URL('../assets/foliage/cc0/shrub-lod-1k.glb', import.meta.url).href },
] as const;
const canopyAlpha = [
  new URL('../assets/foliage/cc0/canopy/canopy0-leaf-alpha-1k.png', import.meta.url).href,
  new URL('../assets/foliage/cc0/canopy/canopy1-leaf-alpha-1k.png', import.meta.url).href,
  new URL('../assets/foliage/cc0/canopy/canopy2-leaf-alpha-1k.png', import.meta.url).href,
];
export interface FoliageGeometry { bark: THREE.BufferGeometry; needles: THREE.BufferGeometry; }
export interface FoliagePart { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; }
export interface FoliageVariant { parts: readonly FoliagePart[]; triangles: number; }
export interface FoliageLevels { near: FoliageVariant[]; mid: FoliageVariant[]; far: FoliageVariant[]; }

/** All ready distance bands use the same original CC0 branch/needle/leaf topology. */
export class CoastalFoliage {
  readonly resources: ModelResources;
  readonly bark: THREE.MeshStandardMaterial;
  readonly leaves: THREE.MeshStandardMaterial;
  // Backward-compatible cheap geometry for terrain's static island forest.
  readonly pines: FoliageGeometry[];
  readonly shrubs: FoliageGeometry[];
  readonly pineLevels: FoliageLevels;
  readonly shrubLevels: FoliageLevels;
  private disposed = false;

  constructor(resources: ModelResources) {
    this.resources = resources;
    this.leaves = resources.material(new THREE.MeshStandardMaterial({ color: '#32492b', roughness: .9,
      metalness: 0, vertexColors: true, dithering: true }));
    this.leaves.name = 'Distant shaded 3D evergreen crown proxy';
    this.bark = resources.material(new THREE.MeshStandardMaterial({ color: '#999384', roughness: .98,
      map: surfaceTexture(resources, '#777163', 'bark', 1707) }));
    this.pines = [13, 41, 79].map(seed => this.pine(seed));
    this.shrubs = [19, 53, 83].map(seed => this.shrub(seed));
    const variants = (sources: FoliageGeometry[]) => sources.map(g => ({ parts: [{ geometry: g.bark, material: this.bark }, { geometry: g.needles, material: this.leaves }], triangles: this.triangles(g.bark) + this.triangles(g.needles) }));
    const pines = variants(this.pines), shrubs = variants(this.shrubs);
    this.pineLevels = { near: pines, mid: pines, far: pines };
    this.shrubLevels = { near: shrubs, mid: shrubs, far: shrubs };
  }

  private triangles(geometry: THREE.BufferGeometry): number { return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3; }

  /** AssetWorld alone owns and loads the original photographic maps and 3D LODs. */
  async loadDetailed(): Promise<void> {
    if (typeof document === 'undefined') return;
    for (const source of sourceAssets) {
      const gltf = await new GLTFLoader().loadAsync(source.url);
      if (this.disposed) {
        const abandoned = new ModelResources();
        gltf.scene.traverse(child => { if (child instanceof THREE.Mesh) {
          abandoned.geometry(child.geometry);
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            abandoned.material(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) abandoned.texture(value);
          }
        } }); abandoned.dispose(); return;
      }
      const nativeAlpha = source.kind === 'pine' ? await new THREE.TextureLoader().loadAsync(canopyAlpha[source.variant]) : null;
      if (this.disposed) {
        nativeAlpha?.dispose(); const abandoned = new ModelResources();
        gltf.scene.traverse(child => { if (child instanceof THREE.Mesh) {
          abandoned.geometry(child.geometry);
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            abandoned.material(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) abandoned.texture(value);
          }
        } }); abandoned.dispose(); return;
      }
      if (nativeAlpha) { nativeAlpha.colorSpace = THREE.NoColorSpace; nativeAlpha.flipY = false; nativeAlpha.anisotropy = 8; this.resources.texture(nativeAlpha); }
      // One parse creates all LODs; each shared map and material is registered once.
      const variants: Record<'near' | 'mid' | 'far', FoliageVariant[]> = { near: [], mid: [], far: [] };
      const loadLevels: ('near' | 'mid' | 'far')[] = source.kind === 'pine' ? ['near', 'mid', 'far'] : ['near', 'mid'];
      for (const level of loadLevels) for (let variant = 0; variant < source.count; variant++) {
        const object = gltf.scene.getObjectByName(`${source.prefix}_${level}_${variant}`);
        if (!object) throw new Error(`Missing ${source.kind} ${level} ${variant}`);
        const parts: FoliagePart[] = [];
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const material = (Array.isArray(child.material) ? child.material[0] : child.material) as THREE.MeshStandardMaterial;
          material.color.set('#ffffff'); material.roughness = .92; material.metalness = 0;
          const leafy = source.kind === 'shrub' || material.name.includes('leaves');
          if (leafy && nativeAlpha) material.alphaMap = nativeAlpha;
          material.alphaTest = leafy ? .38 : 0; // Individual curved leaf geometry retains native photo alpha.
          material.alphaToCoverage = leafy;
          material.transparent = false; material.depthWrite = true; material.dithering = true;
          material.shadowSide = THREE.DoubleSide; material.side = THREE.DoubleSide;
          material.normalScale.set(.55, .55); material.aoMapIntensity = .42;
          material.userData.source = `https://polyhaven.com/a/${source.id}`;
          material.userData.foliageRole = leafy ? 'leaves' : material.name.includes('branches') ? 'branches' : 'trunk';
          material.userData.license = 'CC0-1.0'; material.userData.geometry = 'Actual windswept coastal canopy / individually modeled small leaves; no tree billboards';
          if (leafy) {
            // Thin leaves scatter a small amount of sunlight from behind. Keep rough diffuse
            // response and shadow attenuation; no emissive/baked-light foliage or refraction pass.
            material.onBeforeCompile = shader => {
              shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
              shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
              #if NUM_DIR_LIGHTS > 0
                float leafBacklight = pow(max(0.0, -dot(geometryNormal, directionalLights[0].direction)), 2.0);
                reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * leafBacklight * 0.045 * getShadowMask();
              #endif`);
            };
            material.customProgramCacheKey = () => 'coastal-thin-leaves-v1';
          }
          for (const [key, value] of Object.entries(material)) if (value instanceof THREE.Texture) {
            value.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            value.anisotropy = 8; this.resources.texture(value);
          }
          this.resources.material(material);
          const geometry = this.resources.geometry(child.geometry);
          if (source.kind === 'pine' && level !== 'near' && leafy) {
            const points = new Float32Array(geometry.getAttribute('position').array);
            geometry.userData.coverage = preserveLeafCoverage(points, new Uint32Array(geometry.index!.array), level === 'far' ? .18 : .025);
            geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
          }
          geometry.computeBoundingBox(); geometry.computeBoundingSphere();
          parts.push({ geometry, material });
        });
        variants[level].push({ parts, triangles: parts.reduce((sum, p) => sum + this.triangles(p.geometry), 0) });
      }
      const levels = source.kind === 'pine' ? this.pineLevels : this.shrubLevels;
      if (source.kind === 'shrub') variants.far = await Promise.all(variants.mid.map(variant => coarseFoliage(variant, this.resources, source.kind, () => this.disposed)));
      for (const level of ['near', 'mid', 'far'] as const) variants[level].forEach((variant, index) => { levels[level][source.variant + index] = variant; });
      if (this.disposed) return;
    }
  }

  dispose(): void { this.disposed = true; }

  private volume(point: THREE.Vector3, scale: THREE.Vector3, seed: number): THREE.BufferGeometry {
    // Far-only asymmetric sprays have actual thickness and never face the camera.
    const g = new THREE.TetrahedronGeometry(1, 0), p = g.getAttribute('position'), colors = new Float32Array(p.count * 3);
    const random = randomSeed(seed);
    for (let i = 0; i < p.count; i++) { const shade = .68 + random() * .42; colors.set([shade * .91, shade, shade * .82], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.scale(scale.x, scale.y, scale.z); g.rotateY(seed * .71); g.translate(point.x, point.y, point.z); return g;
  }

  private finish(bark: THREE.BufferGeometry[], leaves: THREE.BufferGeometry[]): FoliageGeometry {
    const merge = (parts: THREE.BufferGeometry[]) => {
      const expanded = parts.map(g => g.index ? g.toNonIndexed() : g);
      const joined = mergeGeometries(expanded, false)!;
      parts.forEach(g => g.dispose()); expanded.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
      joined.computeBoundingBox(); joined.computeBoundingSphere(); return this.resources.geometry(joined);
    };
    return { bark: merge(bark), needles: merge(leaves) };
  }

  private pine(seed: number): FoliageGeometry {
    const random = randomSeed(seed), bark: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    const height = 5.75 + random() * .6, lean = .35 + random() * .7;
    const shoulder = new THREE.Vector3(lean * .45, 3.35, -.15), top = new THREE.Vector3(lean, height, .1);
    bark.push(cylinderBetween(new THREE.Vector3(), shoulder, .16, .08, 3), cylinderBetween(shoulder, top, .08, .015, 3));
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.39996 + random() * .7, spread = 1.35 + random() * 1.1;
      const origin = shoulder.clone().lerp(top, random() * .8);
      const tip = new THREE.Vector3(Math.cos(angle) * spread + lean, height - .9 + random() * .8, Math.sin(angle) * spread * .85);
      bark.push(cylinderBetween(origin, tip, .045, .005, 3));
      for (let j = 0; j < 3; j++) {
        const point = tip.clone().lerp(origin, j * .12); point.y += j * .13;
        leaves.push(this.volume(point, new THREE.Vector3(.72 + random() * .34, .39 + random() * .15, .52 + random() * .27), seed + i * 7 + j));
      }
    }
    return this.finish(bark, leaves);
  }

  private shrub(seed: number): FoliageGeometry {
    const random = randomSeed(seed), bark: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = i * 2.39996, tip = new THREE.Vector3(Math.cos(angle) * .48, .6 + random() * .3, Math.sin(angle) * .48);
      bark.push(cylinderBetween(new THREE.Vector3(0, .02, 0), tip, .018, .002, 3));
      leaves.push(this.volume(tip, new THREE.Vector3(.58, .4, .49), seed + i));
      leaves.push(this.volume(tip.clone().multiplyScalar(.7), new THREE.Vector3(.5, .37, .51), seed + i + 71));
    }
    return this.finish(bark, leaves);
  }
}
