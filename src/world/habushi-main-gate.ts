import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { geoToWorld, type GroundSampler } from './contracts.ts';

export const HABUSHI_GATE_SPEC = {
  lat: 34.3764393, lon: 139.2755897, towerHeight: 10.8, towerWidth: 4.4,
  portalWidth: 6.4, portalHeight: 7.5, towerDepth: 3.2,
  stepRise: .21, stepRun: .44, stepCount: 20, upperDeck: 4.2,
  orientation: -Math.PI / 2, dimensionStatus: 'authored metre scale; absolute dimensions unmeasured',
} as const;

/** Entirely authored surfaces; no photographic pixels or external resources. */
function grain(): THREE.DataTexture {
  const n = 128, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const noise = (Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
    const v = 225 + Math.floor(Math.abs(noise) * 23), i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1); t.needsUpdate = true; return t;
}

export class HabushiMainGate {
  readonly group = new THREE.Group();
  /** Register this group with WorldCollision after updateMatrixWorld(true). */
  readonly solidsGroup = new THREE.Group();
  readonly bounds = new THREE.Box3();
  readonly grading: { center: { x: number; z: number }; level: number; halfWidth: number; halfDepth: number; feather: number; rotation: number };
  readonly diagnostics: { groundMin: number; groundMax: number; baseHeight: number; relief: number; triangles: number; drawCalls: number; windowCount: number; maxStep: number; borrowedResources: number; disposed: boolean };
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();

  constructor(ground: GroundSampler) {
    const s = HABUSHI_GATE_SPEC, p = geoToWorld(s.lat, s.lon);
    const samples: number[] = [];
    for (let a = -18; a <= 18; a += 6) for (let b = -5; b <= 10; b += 5) {
      const h = ground.heightAt(p.x - b, p.z + a); if (Number.isFinite(h)) samples.push(h);
    }
    if (!samples.length) throw new Error('Habushi gate requires finite ground heights');
    samples.sort((a, b) => a - b);
    const base = samples[Math.floor(samples.length / 2)];
    this.group.name = 'Habushiura main gate / authored 3D from official gallery';
    this.group.position.set(p.x, base, p.z); this.group.rotation.y = s.orientation;
    this.solidsGroup.name = 'Habushi opaque walkable solids'; this.group.add(this.solidsGroup);
    this.grading = { center: p, level: base, halfWidth: 20, halfDepth: 11, feather: 5, rotation: s.orientation };
    const texture = grain(); this.textures.add(texture);
    const white = this.material({ color: 0xf5f3ea, roughness: .83, bumpMap: texture, bumpScale: .025 });
    const tread = this.material({ color: 0xb8b7a4, roughness: .93, bumpMap: texture, bumpScale: .008 });
    const joint = this.material({ color: 0x888876, roughness: .98 });
    const metal = this.material({ color: 0xa58a50, metalness: .68, roughness: .43 });
    const blueTile = this.material({ color: 0x547d88, roughness: .82, bumpMap: texture, bumpScale: .006 });
    const salt = this.material({ color: 0xb5b5a0, roughness: 1 });
    const damp = this.material({ color: 0xa2a795, roughness: .98 });
    // The two window holes go through the tower mass: open geometry, never dark decals.
    for (const side of [-1, 1]) {
      const x = side * (s.portalWidth / 2 + s.towerWidth / 2);
      const shape = new THREE.Shape(); shape.moveTo(-2.2, 0); shape.lineTo(2.2, 0);
      shape.lineTo(2.2, s.towerHeight); shape.lineTo(-2.2, s.towerHeight); shape.closePath();
      for (const h of [4.7, 8.7]) {
        const hole = new THREE.Path(); hole.moveTo(-.42, h - .45); hole.lineTo(-.42, h + .45);
        hole.lineTo(.42, h + .45); hole.lineTo(.42, h - .45); hole.closePath(); shape.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: s.towerDepth, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 1, steps: 1, curveSegments: 1 });
      this.mesh(geo, white, x, 0, -s.towerDepth / 2, 'tower with two physical window apertures');
      this.box(4.42, .12, .055, x, 6.5, 1.63, salt, 'horizontal weather joint', false);
      // Moisture bands are limited to feet and ledges that can retain water.
      this.box(4.42, .22, .035, x, .13, 1.635, damp, 'tower foot damp band', false);
      for (const h of [4.7, 8.7]) this.box(.94, .075, .15, x, h - .48, 1.66, salt, 'window sill salt accumulation', false);
      for (let i = 0; i < s.stepCount; i++) {
        const top = (i + 1) * s.stepRise, z = 9 - i * s.stepRun;
        const width = 15 - i * .39, inner = s.portalWidth / 2 + .42;
        const cx = side * (inner + width / 2);
        this.box(width, top, s.stepRun + .015, cx, top / 2, z, white, 'opaque stair riser');
        this.box(width, .028, s.stepRun, cx, top + .014, z, tread, 'walkable tiled tread');
        this.box(width, .018, .028, cx, top + .031, z + s.stepRun / 2 - .02, joint, 'tread nosing joint', false);
        // Repeated tile joints on each horizontal tread are real narrow grooves in the finish.
        for (let tile = .5; tile < width; tile += .5) this.box(.012, .006, s.stepRun - .04, side * (inner + tile), top + .031, z, joint, 'tread tile joint', false);
        this.box(.32, top + .65, s.stepRun + .025, side * (inner - .16), (top + .65) / 2, z, white, 'stepped central parapet');
        this.box(.32, top + .65, s.stepRun + .025, side * (inner + width + .16), (top + .65) / 2, z, white, 'stepped outer parapet');
      }
      this.box(7.8, .24, 4.5, side * 8.3, s.upperDeck - .12, -1.8, blueTile, 'upper landing blue tile');
      for (let tx = -3.5; tx <= 3.5; tx += .5) this.box(.012, .004, 4.5, side * 8.3 + tx, s.upperDeck + .002, -1.8, joint, 'landing tile seam', false);
      for (let tz = -3.8; tz < .4; tz += .5) this.box(7.8, .004, .012, side * 8.3, s.upperDeck + .002, tz, joint, 'landing tile seam', false);
      this.box(7.8, .7, .32, side * 8.3, s.upperDeck + .35, -3.65, white, 'rear landing parapet');
      for (let i = 0; i < 5; i++) {
        this.box(.06, 1.05, .06, side * (6.1 + i * 1.15), s.upperDeck + .525, -3.35, metal, 'landing rail upright');
      }
      this.box(5.8, .055, .055, side * 8.4, s.upperDeck + 1.05, -3.35, metal, 'landing handrail');
    }
    this.box(s.portalWidth, .36, 2.8, 0, s.portalHeight + .18, 0, white, 'rectangular bridge lintel');
    this.box(s.portalWidth, .022, 2.76, 0, s.portalHeight + .371, 0, blueTile, 'bridge blue tiled walking surface');
    for (const z of [-1.23, 1.23]) {
      for (let i = 0; i <= 4; i++) this.box(.055, 1.05, .055, -3.2 + i * 1.6, 8.385, z, metal, 'bridge rail upright');
      for (const y of [7.99, 8.42, 8.91]) this.box(6.4, .05, .055, 0, y, z, metal, 'bridge horizontal rail');
    }
    this.batch(this.solidsGroup); this.batch(this.group);
    this.group.updateMatrixWorld(true); this.bounds.setFromObject(this.group);
    let triangles = 0, drawCalls = 0;
    this.group.traverse(o => { if (o instanceof THREE.Mesh) { triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; drawCalls++; } });
    this.diagnostics = { groundMin: samples[0], groundMax: samples.at(-1)!, baseHeight: base, relief: samples.at(-1)! - samples[0], triangles, drawCalls, windowCount: 4, maxStep: s.stepRise + .034, borrowedResources: 0, disposed: false };
  }

  private material(parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(parameters); this.materials.add(m); return m;
  }
  /** One draw per finish, retaining separate opaque collision and decorative groups. */
  private batch(parent: THREE.Group): void {
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) if (child instanceof THREE.Mesh) {
      const m = child.material as THREE.Material;
      if (!batches.has(m)) batches.set(m, []); batches.get(m)!.push(child);
    }
    for (const [material, meshes] of batches) {
      const parts = meshes.map(mesh => { mesh.updateMatrix(); const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.applyMatrix4(mesh.matrix); return g; });
      const combined = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!combined) throw new Error('Habushi finish batch failed');
      for (const mesh of meshes) { parent.remove(mesh); mesh.geometry.dispose(); this.geometries.delete(mesh.geometry); }
      this.geometries.add(combined);
      const mesh = new THREE.Mesh(combined, material); mesh.name = 'Habushi finish batch';
      mesh.userData.parts = meshes.map(m => m.name); mesh.userData.habushiSolid = parent === this.solidsGroup;
      mesh.castShadow = parent === this.solidsGroup; mesh.receiveShadow = true; parent.add(mesh);
    }
  }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, name: string, solid = true): void {
    // Finish grain occupies .5 m in object space, independent of each box dimensions.
    const position = g.attributes.position, normal = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
      uv.setXY(i, (nx > .5 ? position.getZ(i) + z : position.getX(i) + x) / .5,
        (ny > .5 ? position.getZ(i) + z : position.getY(i) + y) / .5);
    }
    this.geometries.add(g); const mesh = new THREE.Mesh(g, m); mesh.name = name;
    mesh.position.set(x, y, z); mesh.castShadow = solid; mesh.receiveShadow = true;
    mesh.userData.habushiSolid = solid; (solid ? this.solidsGroup : this.group).add(mesh);
  }
  private box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, name: string, solid = true): void {
    this.mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, name, solid);
  }
  dispose(): void {
    if (this.diagnostics.disposed) return;
    for (const g of this.geometries) g.dispose(); for (const m of this.materials) m.dispose(); for (const t of this.textures) t.dispose();
    this.group.clear(); this.diagnostics.disposed = true;
  }
}
