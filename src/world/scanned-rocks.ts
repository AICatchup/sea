import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeInstances, ModelResources, updateInstanceBounds } from './models/procedural.ts';

const scanAssets = [
  { id: 'boulder_01', kind: 'boulder', url: new URL('../assets/marine/boulder-01-2k.glb', import.meta.url).href },
  { id: 'namaqualand_boulder_02', kind: 'boulder', url: new URL('../assets/marine/namaqualand-boulder-02-2k.glb', import.meta.url).href },
  { id: 'namaqualand_boulder_03', kind: 'boulder', url: new URL('../assets/marine/namaqualand-boulder-03-2k.glb', import.meta.url).href },
  { id: 'coast_rocks_01', kind: 'shelf', url: new URL('../assets/marine/coast-rocks-01-2k.glb', import.meta.url).href },
  { id: 'coast_rocks_03', kind: 'shelf', url: new URL('../assets/marine/coast-rocks-03-2k.glb', import.meta.url).href },
];
const cachedBytes = new Map<string, Promise<ArrayBuffer>>();
const seamGeometry:Readonly<Record<string,string>>={
  boulder_01:new URL('../assets/marine/boulder-01-seams-v34.glb',import.meta.url).href,
  namaqualand_boulder_02:new URL('../assets/marine/namaqualand-boulder-02-seams-v34.glb',import.meta.url).href,
  namaqualand_boulder_03:new URL('../assets/marine/namaqualand-boulder-03-seams-v34.glb',import.meta.url).href,
  coast_rocks_01:new URL('../assets/marine/coast-rocks-01-seams-v34.glb',import.meta.url).href,
  coast_rocks_03:new URL('../assets/marine/coast-rocks-03-seams-v34.glb',import.meta.url).href,
};
function scanBytes(url: string): Promise<ArrayBuffer> {
  let cached = cachedBytes.get(url);
  if (!cached) {
    cached = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Bundled rock scan unavailable (${response.status})`);
      return response.arrayBuffer();
    }).catch((error: unknown) => { cachedBytes.delete(url); throw error; });
    cachedBytes.set(url, cached);
  }
  return cached;
}

export interface ScannedRockVariant {
  id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  triangles: number;
  kind: 'boulder' | 'shelf';
  nativeDimensions: THREE.Vector3;
  footprint: number;
}

/** Shared all-angle scan geometry/PBR maps; owner frees them once, never per instance. */
export class ScannedRockLibrary {
  readonly ready: Promise<readonly ScannedRockVariant[]>;
  private readonly resources = new ModelResources();
  private readonly variants: ScannedRockVariant[] = [];
  private disposed = false;

  constructor() { this.ready = typeof document === 'undefined' ? Promise.resolve([]) : this.load(); }

  private async load(): Promise<readonly ScannedRockVariant[]> {
    for (const asset of scanAssets) {
      const gltf = await new GLTFLoader().parseAsync(await scanBytes(asset.url), '');
      const loaded = new ModelResources(), sources: THREE.Mesh[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        loaded.geometry(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          loaded.material(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) loaded.texture(value);
        });
        sources.push(object);
      });
      if(new URLSearchParams(location.search).get('scanseams')!=='0'&&seamGeometry[asset.id]){
        try{
          const corrected=await new GLTFLoader().parseAsync(await scanBytes(seamGeometry[asset.id]),'');
          const meshes:THREE.Mesh[]=[];
          corrected.scene.traverse(object=>{if(object instanceof THREE.Mesh){meshes.push(object);loaded.geometry(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>loaded.material(m));}});
          if(sources.length!==1||meshes.length!==1)throw new Error('Expected one corrected rock mesh');
          sources[0].geometry=meshes[0].geometry;
          sources[0].geometry.userData.scanSeams=corrected.parser.json.asset.extras;
        }catch(error){console.warn('Corrected rock scan unavailable; original geometry retained',error);}
      }
      if (this.disposed) { loaded.dispose(); return []; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      // Coastal sources are whole rocky shelves; keep their broad habitat role.
      const footprint = asset.kind === 'shelf' ? 8 : 2;
      const unit = footprint / Math.max(size.x, size.z);
      const normalization = new THREE.Matrix4().makeScale(unit, unit, unit).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
      for (const source of sources) {
        const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
        if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) continue;
        const geometry = this.resources.geometry(source.geometry.clone());
        geometry.applyMatrix4(normalization.clone().multiply(source.matrixWorld));
        const material = sourceMaterial.clone();
        material.name = `CC0 ${asset.id} scan / 2K albedo + OpenGL normal + ARM`;
        material.roughness = 0.94; material.metalness = 0; material.aoMapIntensity = 0.72;
        material.normalScale.set(0.9, 0.9); material.color.set('#ffffff');
        material.userData.photorealSource = `https://polyhaven.com/a/${asset.id}`;
        material.userData.photorealRole = 'scanned coastal rock';
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
          const texture = material[key];
          if (texture) {
            texture.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            texture.anisotropy = 8; this.resources.texture(texture); loaded.textures.delete(texture);
          }
        }
        this.resources.material(material);
        this.variants.push({ id: asset.id, geometry, material, triangles: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3,
          kind: asset.kind as 'boulder' | 'shelf', nativeDimensions: size.clone(), footprint });
      }
      loaded.dispose();
    }
    return this.variants;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.resources.dispose(); this.variants.length = 0;
  }
}

interface RockPlacement { matrix: THREE.Matrix4; position: THREE.Vector3; variant: number; }

/** Three distinct physical scans, with a shared cap of 32 near the diver. */
export class ScannedRockField {
  readonly ready: Promise<void>;
  readonly library = new ScannedRockLibrary();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly placements: RockPlacement[];
  private readonly selected: { rock: RockPlacement; distance: number }[] = [];
  private lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private disposed = false;
  private active = true;
  private readonly capacity = 32;

  constructor(private readonly group: THREE.Group, matrices: THREE.Matrix4[]) {
    this.placements = matrices.map((matrix, index) => ({ matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix), variant: index % 3 }));
    group.userData.scannedRocks = { status: typeof document === 'undefined' ? 'cpu-only' : 'loading', assets: scanAssets.filter((asset) => asset.kind === 'boulder').map((asset) => asset.id),
      license: 'CC0-1.0', capacity: this.capacity, uniqueVariants: 3, instances: 0, maxDistance: 29, instancesPerVariant: [0, 0, 0] };
    this.ready = this.library.ready.then((variants) => {
      if (this.disposed || !variants.length) return;
      const boulders = variants.filter((variant) => variant.kind === 'boulder');
      for (const variant of boulders) {
        const mesh = makeInstances(variant.geometry, variant.material, this.capacity, `nearby ${variant.id} photogrammetry rocks`);
        mesh.castShadow = false; mesh.receiveShadow = true; mesh.count = 0; mesh.visible = this.active;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.meshes.push(mesh); this.group.add(mesh);
      }
      group.userData.scannedRocks.status = 'ready'; group.userData.scannedRocks.draws = this.meshes.length;
      group.userData.scannedRocks.trianglesPerVariant = boulders.map((variant) => variant.triangles);
    }).catch((error: unknown) => {
      if (!this.disposed) group.userData.scannedRocks.status = `fallback: ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  update(camera: THREE.Vector3, enabled: boolean): Set<THREE.Matrix4> | null {
    if (this.active !== enabled) {
      this.active = enabled; this.lastCamera.set(Infinity, Infinity, Infinity);
      this.meshes.forEach((mesh) => { mesh.visible = enabled; });
      if (!enabled) { this.group.userData.scannedRocks.instances = 0; this.group.userData.scannedRocks.instancesPerVariant = [0, 0, 0]; return new Set(); }
    }
    if (!enabled || !this.meshes.length || this.disposed || this.lastCamera.distanceToSquared(camera) < 1.5) return null;
    this.lastCamera.copy(camera); this.selected.length = 0;
    for (const rock of this.placements) {
      const distance = camera.distanceToSquared(rock.position);
      if (distance < 29 * 29) this.selected.push({ rock, distance });
    }
    this.selected.sort((a, b) => a.distance - b.distance); this.selected.length = Math.min(this.capacity, this.selected.length);
    const visible = new Set<THREE.Matrix4>(), counts: number[] = [];
    this.meshes.forEach((mesh, variant) => {
      let index = 0;
      for (const { rock } of this.selected) if (rock.variant === variant) { mesh.setMatrixAt(index++, rock.matrix); visible.add(rock.matrix); }
      mesh.count = index; counts.push(index); updateInstanceBounds(mesh);
    });
    this.group.userData.scannedRocks.instances = this.selected.length;
    this.group.userData.scannedRocks.instancesPerVariant = counts;
    return visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.meshes.forEach((mesh) => mesh.dispose()); this.meshes.length = 0; this.library.dispose();
  }
}
