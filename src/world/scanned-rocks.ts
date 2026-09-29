import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeInstances, ModelResources, updateInstanceBounds } from './models/procedural.ts';

const rockURL = new URL('../assets/marine/boulder-01-2k.glb', import.meta.url).href;
let cachedBytes: Promise<ArrayBuffer> | undefined;
function scanBytes(): Promise<ArrayBuffer> {
  cachedBytes ??= fetch(rockURL).then((response) => {
    if (!response.ok) throw new Error(`Bundled rock scan unavailable (${response.status})`);
    return response.arrayBuffer();
  }).catch((error: unknown) => { cachedBytes = undefined; throw error; });
  return cachedBytes;
}

interface RockPlacement { matrix: THREE.Matrix4; position: THREE.Vector3; }

/** One cached offline photogrammetry asset, instanced only near the diver. */
export class ScannedRockField {
  readonly ready: Promise<void>;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly placements: RockPlacement[];
  private readonly selected: { rock: RockPlacement; distance: number }[] = [];
  private lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private disposed = false;
  private active = true;
  private readonly capacity = 32;

  constructor(private readonly group: THREE.Group, private readonly resources: ModelResources, matrices: THREE.Matrix4[]) {
    this.placements = matrices.map((matrix) => ({ matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix) }));
    group.userData.scannedRocks = { status: 'loading', asset: 'Poly Haven boulder_01', license: 'CC0-1.0', capacity: this.capacity, trianglesPerInstance: 66122, instances: 0, maxDistance: 29 };
    if (typeof document === 'undefined') group.userData.scannedRocks.status = 'cpu-only';
    this.ready = typeof document === 'undefined' ? Promise.resolve() : this.load().catch((error: unknown) => {
      if (!this.disposed) group.userData.scannedRocks.status = `fallback: ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  private async load(): Promise<void> {
    const gltf = await new GLTFLoader().parseAsync(await scanBytes(), '');
    const loaded = new ModelResources();
    const sources: THREE.Mesh[] = [];
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
    if (this.disposed) { loaded.dispose(); return; }
    const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const unit = 2 / Math.max(size.x, size.z);
    const normalization = new THREE.Matrix4().makeScale(unit, unit, unit).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    for (const source of sources) {
      const geometry = source.geometry.clone(); geometry.applyMatrix4(normalization.clone().multiply(source.matrixWorld));
      this.resources.geometry(geometry);
      const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
      if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) continue;
      const material = sourceMaterial.clone();
      material.name = 'CC0 scanned coastal rock / 2K albedo + OpenGL normal + ARM';
      material.roughness = 0.94; material.metalness = 0; material.aoMapIntensity = 0.72;
      material.normalScale.set(0.9, 0.9); material.color.set('#ffffff');
      material.userData.photorealSource = 'https://polyhaven.com/a/boulder_01';
      material.userData.photorealRole = 'submerged scanned rock';
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
        const texture = material[key];
        if (texture) {
          texture.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.anisotropy = 8; this.resources.texture(texture); loaded.textures.delete(texture);
        }
      }
      this.resources.material(material);
      const mesh = makeInstances(geometry, material, this.capacity, 'nearby photogrammetry coast rocks');
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.meshes.push(mesh); this.group.add(mesh);
    }
    loaded.dispose(); this.group.userData.scannedRocks.status = 'ready';
    this.group.userData.scannedRocks.draws = this.meshes.length;
  }

  update(camera: THREE.Vector3, enabled: boolean): Set<THREE.Matrix4> | null {
    if (this.active !== enabled) {
      this.active = enabled; this.lastCamera.set(Infinity, Infinity, Infinity);
      this.meshes.forEach((mesh) => { mesh.visible = enabled; });
      if (!enabled) { this.group.userData.scannedRocks.instances = 0; return new Set(); }
    }
    if (!enabled) return null;
    if (!this.meshes.length || this.disposed || this.lastCamera.distanceToSquared(camera) < 1.5) return null;
    this.lastCamera.copy(camera); this.selected.length = 0;
    for (const rock of this.placements) {
      const distance = camera.distanceToSquared(rock.position);
      if (distance < 29 * 29) this.selected.push({ rock, distance });
    }
    this.selected.sort((a, b) => a.distance - b.distance); this.selected.length = Math.min(this.capacity, this.selected.length);
    const visible = new Set<THREE.Matrix4>();
    for (const mesh of this.meshes) {
      mesh.count = this.selected.length;
      this.selected.forEach(({ rock }, i) => { mesh.setMatrixAt(i, rock.matrix); visible.add(rock.matrix); });
      updateInstanceBounds(mesh);
    }
    this.group.userData.scannedRocks.instances = this.selected.length;
    return visible;
  }

  dispose(): void { this.disposed = true; this.meshes.forEach((mesh) => mesh.dispose()); this.meshes.length = 0; }
}
