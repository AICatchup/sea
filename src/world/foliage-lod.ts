import * as THREE from 'three';
import type { FoliageLevels, FoliageVariant } from './foliage.ts';
import { makeInstances, updateInstanceBounds } from './models/procedural.ts';

interface Plant { matrix: THREE.Matrix4; position: THREE.Vector3; variant: number; level: 'near' | 'mid' | 'far'; height: number; }
interface Batch { mesh: THREE.InstancedMesh; variant: number; triangles: number; }
export interface FoliageLodSettings { nearDistance: number; midDistance: number; nearCapacity: number; midCapacity: number; triangleBudget?: number; }
export interface TrunkProxy { readonly x: number; readonly y: number; readonly z: number; readonly radius: number; readonly height: number; }

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
  private trunkProxies: readonly TrunkProxy[] | null = null;
  private readonly crownBounds=new Map<number,THREE.Box3>();

  constructor(group: THREE.Group, name: string, levels: FoliageLevels,
    matrices: THREE.Matrix4[][], settings: FoliageLodSettings) {
    this.group = group; this.name = name; this.settings = settings;
    this.levels = levels;
    matrices.forEach((list, variant) => list.forEach(matrix => this.plants.push(this.plant(matrix, variant))));
    this.fixedCount = this.plants.length; this.build();
    this.update(new THREE.Vector3(-36, 1.72, 27), true);
  }

  /** User-placed pines use the same capped true-3D near pool as the environment. */
  setDynamic(matrices: THREE.Matrix4[][]): void {
    this.plants.length = this.fixedCount;
    matrices.forEach((list, variant) => {
      for (const matrix of list) this.plants.push(this.plant(matrix, variant));
    });
    this.lastPosition.set(Infinity, Infinity, Infinity);
    this.trunkProxies = null;
  }

  replaceLevels(levels: FoliageLevels): void {
    if (this.disposed) return;
    this.levels = levels; this.releaseBatches(); this.build(); this.lastPosition.set(Infinity, Infinity, Infinity);
    this.crownBounds.clear();
    this.plants.forEach(plant=>{const measured=this.plant(plant.matrix,plant.variant);plant.position.copy(measured.position);plant.height=measured.height;});
    this.trunkProxies = null;
  }

  private plant(matrix: THREE.Matrix4, variant: number): Plant {
    let local=this.crownBounds.get(variant);
    if(!local){
      local=new THREE.Box3();
      for(const part of this.levels.near[variant].parts){
        const box=part.geometry.boundingBox?.clone()??new THREE.Box3().setFromBufferAttribute(part.geometry.getAttribute('position') as THREE.BufferAttribute);
        local.union(box);
      }
      this.crownBounds.set(variant,local);
    }
    const bounds=local.clone().applyMatrix4(matrix),size=bounds.getSize(new THREE.Vector3());
    return { matrix, position: bounds.getCenter(new THREE.Vector3()), variant, level: 'far', height: Math.max(size.x,size.y,size.z) };
  }

  /** Read-only world coordinates; render LOD selection never moves these physical trunks. */
  getTrunkProxies(): readonly TrunkProxy[] {
    if (this.trunkProxies) return this.trunkProxies;
    const bases = this.levels.far.map(variant => {
      const bark = variant.parts.find(part => part.material.userData.foliageRole === 'trunk' || part.material.name.includes('bark'))?.geometry;
      if (!bark) return { center: new THREE.Vector3(), radius: .18, height: 6.3 };
      bark.computeBoundingBox(); const minY = bark.boundingBox!.min.y, points = bark.getAttribute('position');
      const feet: THREE.Vector3[] = [];
      for (let i = 0; i < points.count; i++) if (points.getY(i) < minY + .16) feet.push(new THREE.Vector3(points.getX(i), minY, points.getZ(i)));
      const center = feet.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, feet.length));
      return { center, radius: Math.max(.12, ...feet.map(p => Math.hypot(p.x - center.x, p.z - center.z))), height: bark.boundingBox!.max.y - minY };
    });
    const point = new THREE.Vector3();
    this.trunkProxies = Object.freeze(this.plants.map(p => {
      const base = bases[p.variant]; point.copy(base.center).applyMatrix4(p.matrix);
      return Object.freeze({ x: point.x, y: point.y, z: point.z,
        radius: base.radius * Math.max(Math.hypot(p.matrix.elements[0], p.matrix.elements[2]), Math.hypot(p.matrix.elements[8], p.matrix.elements[10])),
        height: base.height * Math.abs(p.matrix.elements[5]) });
    }));
    return this.trunkProxies;
  }

  private build(): void {
    const create = (level: 'near' | 'mid' | 'far', variants: FoliageVariant[], capacity: number) => {
      variants.forEach((variant, index) => variant.parts.forEach((part, partIndex) => {
        const mesh = makeInstances(part.geometry, part.material, capacity, `${this.name} ${level} ${index} part ${partIndex}`);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
        mesh.castShadow = level === 'near'; mesh.receiveShadow = true;
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
    const near: { plant: Plant; distance: number; score: number }[] = [], mid: typeof near = [];
    const near2 = this.settings.nearDistance ** 2, mid2 = this.settings.midDistance ** 2;
    for (const plant of this.plants) {
      // Distance to the transformed crown, including its real horizontal span.
      const distance = plant.position.distanceToSquared(position);
      plant.level = 'far';
      const score = plant.height * plant.height / Math.max(1, distance);
      if (distance < near2) near.push({ plant, distance, score }); else if (distance < mid2) mid.push({ plant, distance, score });
    }
    // Angular height gives large visible silhouettes priority rather than allocating all detail
    // to small near seedlings. Far remains the same original model with connected bark.
    near.sort((a, b) => b.score - a.score); mid.sort((a, b) => b.score - a.score);
    let budgetUsed = this.plants.reduce((sum, p) => sum + this.levels.far[p.variant].triangles, 0);
    const budget = this.settings.triangleBudget ?? Infinity;
    const selectedNear: typeof near = [], selectedMid: typeof near = [];
    const select = (list: typeof near, level: 'near' | 'mid', capacity: number, output: typeof near) => {
      for (const entry of list) {
        if (output.length >= capacity) break;
        const extra = this.levels[level][entry.plant.variant].triangles - this.levels.far[entry.plant.variant].triangles;
        if (budgetUsed + extra > budget) continue;
        budgetUsed += extra; entry.plant.level = level; output.push(entry);
      }
    };
    select(near, 'near', this.settings.nearCapacity, selectedNear);
    const middleCandidates = [...near.filter(e => e.plant.level === 'far'), ...mid].sort((a, b) => b.score - a.score);
    select(middleCandidates, 'mid', this.settings.midCapacity, selectedMid);
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
      exclusiveLod: true, selection: 'actual transformed crown angular span within distance / triangle caps', source: 'CC0 all-angle branch/needle/leaf models in every ready band' };
  }

  private releaseBatches(): void {
    for (const list of Object.values(this.batches)) { list.forEach(batch => { this.group.remove(batch.mesh); batch.mesh.dispose(); }); list.length = 0; }
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.releaseBatches(); this.plants.length = 0; this.trunkProxies = null; }
}
