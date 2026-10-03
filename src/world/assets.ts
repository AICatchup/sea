import * as THREE from 'three';
import { crownSupportedPlacements } from './crown-support.ts';
import type { GroundSampler, PlaceableKind } from './contracts';
import { CoastalModels } from './models/props';
import { makeInstances, ModelBatch, randomSeed, rockGeometry, standard, updateInstanceBounds } from './models/procedural';
import { CoastalFoliage } from './foliage.ts';
import { FoliageLodField } from './foliage-lod.ts';
import type { TrunkProxy } from './foliage-lod.ts';
import type { ScannedRockVariant } from './scanned-rocks.ts';

export interface AssetWorldOptions { canopyContinuity?: boolean; crownSupport?: boolean; originalCanopy?:boolean; leafVolumeRefinement?:Parameters<CoastalFoliage['loadDetailed']>[1]; }

interface Placement { kind: PlaceableKind; x: number; y: number; z: number; yaw: number; }
interface PlacementBatch { mesh: THREE.InstancedMesh; local: THREE.Matrix4; variant?: number; }
interface FloatingMarker { object: THREE.Object3D; phase: number; }

/** Foreground authored assets. Cliff shape/elevation and distant vegetation belong to the terrain. */
export class AssetWorld {
  readonly group = new THREE.Group();
  readonly boat: THREE.Group;
  private readonly models = new CoastalModels();
  private readonly foliage = new CoastalFoliage(this.models.resources);
  private readonly pines = this.foliage.pines;
  private pineField!: FoliageLodField;
  private shrubField!: FoliageLodField;
  readonly ready: Promise<void>;
  private readonly placements: Placement[] = [];
  private readonly placementBatches = new Map<PlaceableKind, PlacementBatch[]>();
  private readonly instanceMeshes: THREE.InstancedMesh[] = [];
  private readonly floatingMarkers: FloatingMarker[] = [];
  private readonly lastBoatPosition = new THREE.Vector3();
  private readonly foliagePosition = new THREE.Vector3(-36, 1.72, 27);
  private lastPineSignature = '';
  private previousTime = 0;
  private waterHeightSampler:(x:number,z:number)=>number=()=>0;
  private disposed = false;
  private readonly matrix = new THREE.Matrix4();
  private readonly localMatrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly quaternion = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private static readonly capacity = 96;

  constructor(private readonly ground: GroundSampler, private readonly options: AssetWorldOptions = {}) {
    this.group.name = 'Tomari authored coast assets';
    this.group.userData.provenance = 'Reference-inspired authored pines/stone, with fictional adventure furniture and vessel.';
    this.group.userData.solidObstacles = [];
    this.boat = this.models.boat;
    this.boat.position.set(-116, 0, -90);
    this.group.add(this.boat); this.lastBoatPosition.copy(this.boat.position);
    this.populateHeadlands();
    this.populateBeach();
    this.populateStrand();
    this.preparePlacementBatches();
    this.group.userData.foliage = { status: typeof document === 'undefined' ? 'cpu-proxies' : 'loading', source: 'Poly Haven CC0 island_tree_01/02/03 + shrub_02; coastal evergreens, botanical species unverified', photoPass: false };
    this.ready = this.foliage.loadDetailed(this.options.canopyContinuity===true,this.options.leafVolumeRefinement??false,this.options.originalCanopy??false).then(() => {
      if (this.disposed || typeof document === 'undefined') return;
      if (this.options.crownSupport) this.rebuildCrownSupport();
      else { this.pineField.replaceLevels(this.foliage.pineLevels); this.shrubField.replaceLevels(this.foliage.shrubLevels); }
      this.pineField.update(this.foliagePosition, true); this.shrubField.update(this.foliagePosition, true);
      this.group.userData.foliage.status = 'ready';
    }).catch((error: unknown) => { if (!this.disposed) this.group.userData.foliage.status = `proxy fallback: ${error instanceof Error ? error.message : String(error)}`; });
  }

  private rebuildCrownSupport(): void {
    const supported = crownSupportedPlacements(this.ground, this.foliage.pineLevels.near, this.foliage.shrubLevels.near);
    this.pineField.dispose(); this.shrubField.dispose();
    this.pineField = new FoliageLodField(this.group, 'coastalPineLod', this.foliage.pineLevels, supported.trees,
      { nearDistance: 35, midDistance: 210, nearCapacity: 24, midCapacity: 180, triangleBudget: 3_600_000, viewAware: true,...(this.options.originalCanopy?{nearPixels:48,midPixels:24,farPixels:12}:{}) });
    this.shrubField = new FoliageLodField(this.group, 'coastalShrubLod', this.foliage.shrubLevels, supported.shrubs,
      { nearDistance: 26, midDistance: 210, nearCapacity: 48, midCapacity: 180, triangleBudget: 1_350_000, viewAware: true });
    this.lastPineSignature = '!native-rebuild'; this.rebuildPlacements(0);
    this.group.userData.crownSupport = { ...supported.diagnostics, trees: supported.trees.flat().length, shrubs: supported.shrubs.flat().length,
      coverageMeaning: 'sum of crown footprint areas; overlaps included, not measured canopy coverage', photoPass: false };
  }

  get placedCount(): number { return this.placements.length; }
  getTrunkProxies(): readonly TrunkProxy[] { return this.pineField.getTrunkProxies(); }

  private addInstances(geometry: THREE.BufferGeometry, material: THREE.Material, positions: THREE.Matrix4[], name: string): void {
    if (!positions.length) return;
    const mesh = makeInstances(geometry, material, positions.length, name);
    positions.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    updateInstanceBounds(mesh); this.instanceMeshes.push(mesh); this.group.add(mesh);
  }

  private transform(x: number, y: number, z: number, scale: number, yaw: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(this.yAxis, yaw), new THREE.Vector3(scale * sx, scale * sy, scale * sz));
  }

  private populateHeadlands(): void {
    const random = randomSeed(0x544f4d41);
    const trees: THREE.Matrix4[][] = [[], [], []];
    const shrubs: THREE.Matrix4[][] = [[], [], []];
    let treeCount = 0, shrubCount = 0, groundCoverCount = 0;
    // Independent cover strata: a pine never suppresses the shrub layer below it.
    for (let gz = -300; gz < 290; gz += 3.6) for (let gx = -355; gx < 320; gx += 3.6) {
      const x = gx + (random() - .5) * 2.5, z = gz + (random() - .5) * 2.5;
      if ((x + 36) ** 2 + (z - 27) ** 2 > 320 ** 2) continue;
      const height = this.ground.heightAt(x, z);
      if (!Number.isFinite(height)) continue;
      if (Math.hypot(x + 25, z - 36) < 6) continue;
      const variant = Math.floor(random() * 3), yaw = random() * Math.PI * 2;
      const gradientX = (this.ground.heightAt(x + 1.5, z) - this.ground.heightAt(x - 1.5, z)) / 3;
      const gradientZ = (this.ground.heightAt(x, z + 1.5) - this.ground.heightAt(x, z - 1.5)) / 3;
      const slope = Math.hypot(gradientX, gradientZ);
      const isHeadland = height > 3 || x < -72 || x > 74 || z > 95;
      // Wind-shaped cover follows crests and soil pockets, leaving lower vertical rock exposed.
      // Keep crown proportions close to the native three-dimensional source.
      // Flattening a 12m-wide crown to 2m high buried most leaves on hillside soil.
      const cluster = THREE.MathUtils.clamp(.55 + Math.sin(x * .034 + Math.sin(z * .021) * 1.9) * .27 + Math.cos(z * .039 - x * .012) * .22, 0, 1);
      if (height > 6 && height < 68 && slope < (height > 14 ? 1.65 : 1.12) && isHeadland && random() < (.14 + cluster * .22)) {
        const size = .74 + random() * .38;
        trees[variant].push(this.transform(x, height - .07, z, size, yaw, 1.35 + random() * .3, .9 + random() * .18, 1.35)); treeCount++;
      }
      if (height > 3.1 && height < 68 && isHeadland && slope < 1.75 && random() < (.67 + cluster * .3)) {
        const low = random() < .43, size = .88 + random() * .46;
        const matrix = this.transform(x, height - .015, z, size, yaw, low ? 3.35 : 2.32, low ? .27 + random() * .12 : .69 + random() * .35, low ? 2.85 : 1.98);
        if (low && this.options.canopyContinuity) {
          // Keep the same soil pockets and random sequence, but restore understory
          // thickness. The old 3.35/.27 ratio buried most leaves into the slope.
          const scale = new THREE.Vector3().setFromMatrixScale(matrix);
          scale.x *= 2.4 / 3.35; scale.z *= 2.2 / 2.85; scale.y *= 2.25;
          matrix.compose(new THREE.Vector3(x, height - .015, z), new THREE.Quaternion().setFromAxisAngle(this.yAxis, yaw), scale);
        }
        if (low) {
          // Low native leaf clusters follow soil support instead of cutting a horizontal
          // plane through slopes. Limit lean to 35 degrees; woody shrubs remain upright.
          const lean = Math.min(1, Math.tan(35 * Math.PI / 180) / Math.max(.001, slope));
          const support = new THREE.Vector3(-gradientX * lean, 1, -gradientZ * lean).normalize();
          const orientation = new THREE.Quaternion().setFromUnitVectors(this.yAxis, support)
            .multiply(new THREE.Quaternion().setFromAxisAngle(this.yAxis, yaw));
          const scale = new THREE.Vector3().setFromMatrixScale(matrix);
          let supportY = height - .015;
          if (this.options.canopyContinuity) {
            // A bounded support correction closes burial where the 35-degree lean
            // cannot follow steeper soil. Never place foliage atop the lower cliff.
            let residual = 0;
            for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
              const sample = this.ground.heightAt(x + dx, z + dz);
              if (Number.isFinite(sample)) residual = Math.max(residual, sample - height - (gradientX * dx + gradientZ * dz) * lean);
            }
            supportY += Math.min(.35, residual);
          }
          matrix.compose(new THREE.Vector3(x, supportY, z), orientation, scale);
        }
        shrubs[variant].push(matrix);
        shrubCount++; if (low) groundCoverCount++;
      }
    }
    // Same deterministic transforms, now partitioned into mutually exclusive distance bands.
    this.pineField = new FoliageLodField(this.group, 'coastalPineLod', this.foliage.pineLevels, trees,
      { nearDistance: 35, midDistance: 210, nearCapacity: 24, midCapacity: 180, triangleBudget: 3_600_000,viewAware:this.options.canopyContinuity===true||this.options.originalCanopy===true,...(this.options.originalCanopy?{nearPixels:48,midPixels:24,farPixels:12}:{}) });
    this.shrubField = new FoliageLodField(this.group, 'coastalShrubLod', this.foliage.shrubLevels, shrubs,
      { nearDistance: 26, midDistance: this.options.canopyContinuity ? 210 : 110, nearCapacity: 48, midCapacity: 180, triangleBudget: 1_350_000,viewAware:this.options.canopyContinuity===true });
    this.group.userData.canopyContinuity = this.options.canopyContinuity === true;
    this.group.userData.environmentCounts = { trees: treeCount, shrubs: shrubCount, groundCover: groundCoverCount,
      strata: 'low wide nonuniform coastal crowns / overlapping shrubs / low true-3D leaf cover; lower steep rock faces exposed',
      canopyScale: { horizontal: [1.35, 1.65], vertical: [.9, 1.08] }, groundCoverScale: this.options.canopyContinuity
        ? { horizontal: [2.2, 2.4], vertical: [.6075, .8775] }
        : { horizontal: [2.85, 3.35], vertical: [.27, .39] } };
  }

  /** Small strand debris is clustered and varied, rather than an evenly tiled gravel carpet. */
  private populateStrand(): void {
    const random=randomSeed(0x50454242), matrices:THREE.Matrix4[][]=[[],[],[]];
    for(let i=0;i<4200;i++){
      const x=-110+random()*150,z=-32+random()*72,h=this.ground.heightAt(x,z);
      const slope=Math.hypot(this.ground.heightAt(x+.3,z)-this.ground.heightAt(x-.3,z),this.ground.heightAt(x,z+.3)-this.ground.heightAt(x,z-.3))/.6;
      if(h<-.9||h>2.6||slope>.45)continue;
      const density=.4+.3*Math.sin(x*.15+Math.sin(z*.25)*2)+.2*Math.sin(z*.5);
      if(random()>density)continue;
      const size=.014+Math.pow(random(),3)*.15;
      matrices[i%3].push(this.transform(x,h+size*.18,z,size,random()*Math.PI*2,.8+random()*.6,.36+random()*.35,.8+random()*.7));
    }
    for(let variant=0;variant<3;variant++){
      const material=standard(this.models.resources,['#a39a84','#6c7265','#bcbaa4'][variant],.9);
      material.vertexColors=true;
      this.addInstances(rockGeometry(this.models.resources,713+variant*81,2),material,matrices[variant],'irregular strand pebbles '+variant);
    }
  }

  private findBeachPoint(targetX: number, targetZ: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    for (let z = 15; z <= 80; z += 3) for (let x = -80; x <= 60; x += 3) {
      const height = this.ground.heightAt(x, z);
      if (height < 0.25 || height > 2.8 || !Number.isFinite(height)) continue;
      const gradient = Math.hypot(this.ground.heightAt(x + 0.75, z) - height, this.ground.heightAt(x, z + 0.75) - height);
      if (gradient > 0.18) continue;
      const score = Math.hypot(x - targetX, z - targetZ) + Math.abs(height - 1.2) * 3;
      if (score < bestScore) { bestScore = score; best = new THREE.Vector3(x, height, z); }
    }
    return best;
  }

  private populateBeach(): void {
    const staticProps: THREE.Group[] = [];
    const add = (template: THREE.Group, targetX: number, targetZ: number, yaw: number, radius: number) => {
      const point = this.findBeachPoint(targetX, targetZ); if (!point) return;
      const object = template.clone(); object.position.copy(point); object.rotation.y = yaw;
      object.userData.provenance = 'Fictional authored adventure prop; not a surveyed Tomari beach fixture.';
      staticProps.push(object);
      if (radius > 0) (this.group.userData.solidObstacles as { x: number; z: number; radius: number; height: number }[])
        .push({ x: point.x, z: point.z, radius, height: point.y + 1 });
    };
    // The main walking approach around (-36, 27) stays open.
    add(this.models.chair, -13, 41, -0.15, 0.45);
    add(this.models.chair, -10, 41, 0.16, 0.45);
    add(this.models.umbrella, -11.5, 43, 0.1, 0.05);
    add(this.models.tank, -8, 42, 0.2, 0.27);
    add(this.models.boarding, -61, 19, 0.14, 0);

    const driftwood = new ModelBatch();
    driftwood.rod(this.models.wood, new THREE.Vector3(-1.6, 0.12, 0), new THREE.Vector3(1.1, 0.17, 0.08), 0.095, 0.14);
    driftwood.rod(this.models.wood, new THREE.Vector3(0.6, 0.15, 0.06), new THREE.Vector3(1.4, 0.28, 0.35), 0.06, 0.025);
    const drift = driftwood.finish(this.models.resources, 'salt bleached driftwood');
    add(drift, 25, 31, -0.4, 0);

    // Bake the scattered static furniture down to one draw per shared material.
    const batch = new ModelBatch();
    for (const object of staticProps) {
      object.updateMatrixWorld(true);
      object.traverse((child) => {
        if (child instanceof THREE.Mesh && !Array.isArray(child.material)) batch.add(child.geometry.clone().applyMatrix4(child.matrixWorld), child.material);
      });
    }
    this.group.add(batch.finish(this.models.resources, 'authored beach adventure fixtures'));
    const random = randomSeed(8504);
    for (let i = 0; i < 7; i++) {
      const x = -111 + i * 24, z = -20 - Math.sin(i * 0.7) * 7;
      if (this.ground.heightAt(x, z) > -0.75) continue;
      const buoy = this.models.buoy.clone(); buoy.position.set(x, 0.06, z);
      this.floatingMarkers.push({ object: buoy, phase: random() * Math.PI * 2 }); this.group.add(buoy);
    }
  }

  private pineTemplate(): THREE.Group {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.pines[0].bark, this.foliage.bark), new THREE.Mesh(this.pines[0].needles, this.foliage.leaves)); return group;
  }

  private rockTemplate(): THREE.Group {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.models.rocks[0], this.models.stone); mesh.scale.set(0.9, 0.75, 0.9); mesh.position.y = 0.51; group.add(mesh); return group;
  }

  private preparePlacementBatches(): void {
    const templates: Record<PlaceableKind, THREE.Group> = { chair: this.models.chair, umbrella: this.models.umbrella,
      buoy: this.models.buoy, tank: this.models.tank, rock: this.rockTemplate(), pine: this.pineTemplate() };
    for (const kind of Object.keys(templates) as PlaceableKind[]) {
      const template = templates[kind]; template.updateMatrixWorld(true);
      const batches: PlacementBatch[] = [];
      template.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) return;
        const mesh = makeInstances(child.geometry, child.material, AssetWorld.capacity, `placed ${kind}`); mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        batches.push({ mesh, local: child.matrixWorld.clone() }); this.instanceMeshes.push(mesh); this.group.add(mesh);
      });
      this.placementBatches.set(kind, batches);
    }
  }

  /** Scan resources stay owned by MarineLife; this class owns only instance buffers. */
  hydrateRockPlacements(variants:readonly ScannedRockVariant[]):void {
    const boulders=variants.filter(variant=>variant.kind==='boulder').slice(0,3);
    if(this.disposed||!boulders.length)return;
    for(const batch of this.placementBatches.get('rock')??[]){
      this.group.remove(batch.mesh);batch.mesh.dispose();
      const index=this.instanceMeshes.indexOf(batch.mesh);if(index>=0)this.instanceMeshes.splice(index,1);
    }
    const batches=boulders.map((variant,index)=>{
      const mesh=makeInstances(variant.geometry,variant.material,AssetWorld.capacity,'placed scanned '+variant.id);
      mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);this.instanceMeshes.push(mesh);
      return {mesh,local:new THREE.Matrix4().makeScale(.8,.8,.8),variant:index};
    });
    this.placementBatches.set('rock',batches);this.rebuildPlacements(0);
  }

  place(kind: PlaceableKind, x: number, z: number, yaw: number): void {
    if (this.disposed || this.placements.length >= AssetWorld.capacity || !this.placementBatches.has(kind)
      || ![x, z, yaw].every(Number.isFinite)) return;
    const radii:Record<PlaceableKind,number>={chair:.8,umbrella:1.55,buoy:.55,tank:.35,rock:1,pine:2.2};
    for(let attempt=0;attempt<48;attempt++){
      const angle=attempt*2.399963+yaw,radius=attempt===0?0:Math.sqrt(attempt)*.95;
      const px=x+Math.sin(angle)*radius,pz=z+Math.cos(angle)*radius,height=this.ground.heightAt(px,pz);
      if(!Number.isFinite(height)||(kind==='buoy'&&height>=-.25)||(kind==='pine'&&height<0))continue;
      if(this.placements.some(placement=>Math.hypot(placement.x-px,placement.z-pz)<radii[kind]+radii[placement.kind]+.15))continue;
      this.placements.push({kind,x:px,z:pz,y:kind==='buoy'?.06:height,yaw});this.rebuildPlacements(0);return;
    }
  }

  undoPlacement(): void {
    if (this.disposed || !this.placements.length) return;
    this.placements.pop(); this.rebuildPlacements(0);
  }

  setWaterHeightSampler(sample:(x:number,z:number)=>number):void{this.waterHeightSampler=sample;}
  private waterAt(x:number,z:number):number{const y=this.waterHeightSampler(x,z);return Number.isFinite(y)?THREE.MathUtils.clamp(y,-4,4):0;}
  private rebuildPlacements(time: number): void {
    const placedPines: THREE.Matrix4[][] = [[], [], []];
    const pineSignature = this.placements.map((p, index) => p.kind === 'pine' ? `${index}:${p.x}:${p.y}:${p.z}:${p.yaw}` : '').join('|');
    const updatePines = pineSignature !== this.lastPineSignature;
    const indices = new Map<PlacementBatch, number>();
    for (const batches of this.placementBatches.values())for(const batch of batches)indices.set(batch,0);
    for (let index = 0; index < this.placements.length; index++) {
      const placement = this.placements[index];
      const bob = placement.kind === 'buoy' ? Math.sin(time * 1.6 + index * 2.7) * 0.055 : 0;
      const surface=placement.kind==='buoy'?this.waterAt(placement.x,placement.z):0;
      this.position.set(placement.x, placement.y + surface + bob, placement.z);
      this.quaternion.setFromAxisAngle(this.yAxis, placement.yaw); this.matrix.compose(this.position, this.quaternion, this.scale);
      if (placement.kind === 'pine') { if (updatePines) placedPines[index % 3].push(this.matrix.clone()); continue; }
      for (const batch of this.placementBatches.get(placement.kind)!) {
        if(batch.variant!==undefined&&batch.variant!==index%3)continue;
        const instanceIndex=indices.get(batch)!;
        this.localMatrix.multiplyMatrices(this.matrix, batch.local); batch.mesh.setMatrixAt(instanceIndex, this.localMatrix);
        indices.set(batch,instanceIndex+1);
      }
    }
    for (const batches of this.placementBatches.values()) for (const batch of batches) {
      batch.mesh.count = indices.get(batch)!; updateInstanceBounds(batch.mesh);
    }
    if (updatePines) { this.lastPineSignature = pineSignature; this.pineField.setDynamic(placedPines); this.pineField.update(this.foliagePosition, true); }
  }

  update(time: number, position: THREE.Vector3, underwater: boolean,forward?:THREE.Vector3,projectionScale=0): void {
    if (this.disposed) return;
    this.foliagePosition.copy(position);
    this.pineField.update(position,false,forward,projectionScale); this.shrubField.update(position,false,forward,projectionScale);
    for (const marker of this.floatingMarkers) {
      marker.object.position.y = this.waterAt(marker.object.position.x,marker.object.position.z)+0.06+Math.sin(time*1.55+marker.phase)*0.052;
      marker.object.rotation.z = Math.sin(time * 1.05 + marker.phase) * 0.04;
    }
    if (this.placements.some((placement) => placement.kind === 'buoy')) this.rebuildPlacements(time);
    const dt = Math.min(0.1, Math.max(0.001, time - this.previousTime));
    const speed = this.boat.position.distanceTo(this.lastBoatPosition) / dt;
    this.models.propeller.rotation.z += dt * Math.min(85, speed * 14);
    this.models.outboard.rotation.y = Math.sin(time * 0.63) * Math.min(0.035, speed * 0.012);
    this.lastBoatPosition.copy(this.boat.position); this.previousTime = time;
    // The controller exclusively owns the vessel transform and wave-following attitude.
    this.boat.visible = !underwater || position.distanceTo(this.boat.position) < 160;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.instanceMeshes.forEach((mesh) => mesh.dispose());
    this.foliage.dispose(); this.pineField.dispose(); this.shrubField.dispose();
    this.models.resources.dispose(); this.group.clear(); this.placements.length = 0; this.placementBatches.clear();
  }
}
