import * as THREE from 'three';
import type { FoliageLevels, FoliageVariant } from './foliage.ts';
import { makeInstances, updateInstanceBounds } from './models/procedural.ts';

interface Plant { matrix: THREE.Matrix4; position: THREE.Vector3; variant: number; level: 'near' | 'mid' | 'far'; }
interface Batch { mesh: THREE.InstancedMesh; variant: number; triangles: number; }
export interface FoliageLodSettings { nearDistance: number; midDistance: number; nearCapacity: number; midCapacity: number; }

/** Exclusive LOD partitions reuse the original placement matrices. No duplicated coverage. */
export class FoliageLodField {
  private readonly group: THREE.Group;
  private readonly name: string;
  private readonly settings: FoliageLodSettings;
  private plants: Plant[] = [];
  private batches: Record<'near' | 'mid' | 'far', Batch[]> = { near: [], mid: [], far: [] };
  private lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private levels: FoliageLevels;
  private disposed = false;
  private fixedCount = 0;

  constructor(group: THREE.Group, name: string, levels: FoliageLevels,
    matrices: THREE.Matrix4[][], settings: FoliageLodSettings) {
    this.group = group; this.name = name; this.settings = settings;
    this.levels = levels;
    matrices.forEach((list, variant) => list.forEach(matrix => this.plants.push({ matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix), variant, level: 'far' })));
    this.fixedCount = this.plants.length; this.build();
    this.update(new THREE.Vector3(-36, 1.72, 27), true);
  }

  /** User-placed pines use the same capped true-3D near pool as the environment. */
  setDynamic(matrices: THREE.Matrix4[][]): void {
    this.plants.length = this.fixedCount;
    matrices.forEach((list, variant) => {
      for (const matrix of list) this.plants.push({ matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix), variant, level: 'far' });
    });
    this.lastPosition.set(Infinity, Infinity, Infinity);
  }

  replaceLevels(levels: FoliageLevels): void {
    if (this.disposed) return;
    this.levels = levels; this.releaseBatches(); this.build(); this.lastPosition.set(Infinity, Infinity, Infinity);
  }

  private build(): void {
    const create = (level: 'near' | 'mid' | 'far', variants: FoliageVariant[], capacity: number) => {
      variants.forEach((variant, index) => variant.parts.forEach((part, partIndex) => {
        const mesh = makeInstances(part.geometry, part.material, capacity, `${this.name} ${level} ${index} part ${partIndex}`);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.castShadow = level === 'near'; mesh.receiveShadow = level !== 'far';
        mesh.userData.foliageLod = level; mesh.userData.source = part.material.userData.source ?? 'Authored distant volume proxy';
        this.group.add(mesh); this.batches[level].push({ mesh, variant: index, triangles: (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3 });
      }));
    };
    create('near', this.levels.near, this.settings.nearCapacity);
    create('mid', this.levels.mid, this.settings.midCapacity);
    create('far', this.levels.far, this.fixedCount + 96);
  }

  update(position: THREE.Vector3, force = false): void {
    if (this.disposed || (!force && this.lastPosition.distanceToSquared(position) < 3.24)) return;
    this.lastPosition.copy(position);
    const near: { plant: Plant; distance: number }[] = [], mid: typeof near = [];
    const near2 = this.settings.nearDistance ** 2, mid2 = this.settings.midDistance ** 2;
    for (const plant of this.plants) {
      // Ground-centre distance includes tree height; switch bands only after meaningful movement.
      const distance = plant.position.distanceToSquared(position);
      plant.level = 'far';
      if (distance < near2) near.push({ plant, distance }); else if (distance < mid2) mid.push({ plant, distance });
    }
    near.sort((a, b) => a.distance - b.distance); mid.sort((a, b) => a.distance - b.distance);
    const selectedNear = near.slice(0, this.settings.nearCapacity);
    selectedNear.forEach(entry => { entry.plant.level = 'near'; });
    // The nearest overflow gets a mid mesh, rather than remaining a distant crown beside the walker.
    const selectedMid = [...near.slice(this.settings.nearCapacity), ...mid].slice(0, this.settings.midCapacity);
    selectedMid.forEach(entry => { entry.plant.level = 'mid'; });
    let draws = 0, triangles = 0;
    const counts = { near: selectedNear.length, mid: selectedMid.length, far: this.plants.length - selectedNear.length - selectedMid.length };
    for (const level of ['near', 'mid', 'far'] as const) for (const batch of this.batches[level]) {
      let count = 0;
      for (const plant of this.plants) if (plant.level === level && plant.variant === batch.variant) batch.mesh.setMatrixAt(count++, plant.matrix);
      batch.mesh.count = count; batch.mesh.visible = count > 0;
      updateInstanceBounds(batch.mesh); if (count) draws++;
      triangles += count * batch.triangles;
    }
    this.group.userData[this.name] = { status: 'ready', placements: this.plants.length, originalPlacements: this.fixedCount,
      instances: counts, thresholds: this.settings, draws, triangles, nearTriangles: selectedNear.reduce((sum, entry) => sum + this.levels.near[entry.plant.variant].triangles, 0),
      exclusiveLod: true, source: 'CC0 all-angle needle/leaf meshes near + middle; authored volumetric distant proxies' };
  }

  private releaseBatches(): void {
    for (const list of Object.values(this.batches)) { list.forEach(batch => { this.group.remove(batch.mesh); batch.mesh.dispose(); }); list.length = 0; }
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.releaseBatches(); this.plants.length = 0; }
}
