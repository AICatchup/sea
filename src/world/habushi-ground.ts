import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HabushiMainGate } from './habushi-main-gate.ts';

/** Photo-informed layout, authored metre scale. Road widths and markings are unmeasured. */
export class HabushiGround {
  readonly group = new THREE.Group();
  readonly solidsGroup = new THREE.Group();
  readonly grading: HabushiMainGate['grading'];
  readonly gradings: readonly HabushiMainGate['grading'][];
  readonly diagnostics = { triangles: 0, drawCalls: 0, maxStep: .14, borrowedResources: 0, disposed: false,
    dimensionStatus: 'photo-informed layout; absolute pavement dimensions unmeasured', groundTop: .02, sidewalkTop: .14 };
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();

  constructor(gate: HabushiMainGate) {
    const level = gate.grading.level;
    if (!Number.isFinite(level)) throw new Error('Habushi pavement requires finite grading level');
    this.group.name = 'Habushi roadfront pavement / authored photo-informed geometry';
    this.group.position.set(gate.grading.center.x, level, gate.grading.center.z);
    this.group.rotation.y = gate.grading.rotation;
    this.solidsGroup.name = 'Habushi pavement opaque support'; this.group.add(this.solidsGroup);
    // local +z is the west-facing roadfront. Never move the geographic landmark.
    const offset = new THREE.Vector3(0, 0, 22).applyAxisAngle(new THREE.Vector3(0, 1, 0), gate.grading.rotation);
    this.grading = { center: { x: gate.grading.center.x + offset.x, z: gate.grading.center.z + offset.z },
      level, halfWidth: 30, halfDepth: 13, feather: 5, rotation: gate.grading.rotation };
    this.gradings = [this.grading];
    const n = 128, data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      const v = 110 + Math.floor((Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) * 22);
      data.set([v, v, v, 255], i * 4);
    }
    const grain = new THREE.DataTexture(data, n, n); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(1, 1); grain.needsUpdate = true; this.textures.add(grain);
    const material = (color: number, bump = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: .96, bumpMap: bump ? grain : null, bumpScale: bump });
      this.materials.add(m); return m;
    };
    const asphalt = material(0x626661, .004), paving = material(0xb1b1a0, .008), curb = material(0xc0bfab, .006);
    const groove = material(0x555b53), joint = material(0x858779), paint = material(0xe4e4d5, .002);
    asphalt.vertexColors = true;
    const parts = new Map<THREE.Material, { geometry: THREE.BufferGeometry; solid: boolean; names: string[] }[]>();
    const box = (w: number, h: number, d: number, x: number, top: number, z: number, m: THREE.Material, name: string, solid = true) => {
      const road = m === asphalt;
      const geometry = new THREE.BoxGeometry(w, h, d, road ? 30 : 1, 1, road ? 12 : 1);
      geometry.translate(x, top - h / 2, z);
      const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
      const colors: number[] = [];
      for (let i = 0; i < position.count; i++) {
        const px = position.getX(i), pz = position.getZ(i), py = position.getY(i);
        uv.setXY(i, (Math.abs(normal.getX(i)) > .5 ? pz : px) / .6,
          (Math.abs(normal.getY(i)) > .5 ? pz : py) / .6);
        if (road) {
          // Bounded metre-scale wear, strongest toward the exposed parking apron.
          // Smooth patches are vertex colour; fine aggregate stays in the existing bump only.
          const weather = .06 * Math.sin(px * .23 + pz * .31) + .035 * Math.cos(px * .61 - pz * .43);
          const apron = .11 * Math.max(0, Math.min(1, (pz - 20) / 10));
          const edge = -.08 * Math.exp(-Math.pow((pz - 12.2) / .8, 2));
          const value = .91 + weather + apron + edge;
          colors.push(value, value, value * .985);
        }
      }
      if (road) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      if (!parts.has(m)) parts.set(m, []); parts.get(m)!.push({ geometry, solid, names: [name] });
    };
    // A thin opaque foundation supports the road; no tall wall/volume conceals ungraded DEM.
    box(60, .18, 23, 0, .02, 23.5, asphalt, 'road foundation: local z 12..35');
    box(60, .18, 2.5, 0, .14, 10.55, paving, 'raised sidewalk: local z 9.3..11.8');
    // Drain channel has actual lower support and raised lips, not a painted black stripe.
    box(60, .10, .20, 0, .025, 11.90, groove, 'recessed drainage channel');
    box(60, .18, .12, 0, .16, 12.06, curb, 'road edge curb');
    // Sidewalk paving joints are narrow authored geometry, elevated by 1 mm.
    for (let x = -27; x <= 27; x += 3) box(.018, .003, 2.46, x, .141, 10.55, joint, 'sidewalk slab joint', false);
    for (let x = -24; x <= 24; x += 8) box(.018, .003, 22.8, x, .021, 23.55, joint, 'road expansion joint', false);
    // Photo has a side crossing and foreground parking paint. Keep central gate axis free.
    for (let z = 14; z <= 21; z += 1.4) box(8, .003, .45, 24, .024, z, paint, 'side zebra crossing', false);
    for (const side of [-1, 1]) {
      box(18, .003, .12, side * 18, .024, 27, paint, 'parking bay end line', false);
      for (let x = 10; x <= 26; x += 8) box(.12, .003, 7.9, side * x, .024, 31, paint, 'parking bay divider', false);
    }
    for (const [m, entries] of parts) {
      const geometry = mergeGeometries(entries.map(e => e.geometry), false);
      for (const e of entries) e.geometry.dispose();
      if (!geometry) throw new Error('Habushi pavement batch failed');
      this.geometries.add(geometry); const mesh = new THREE.Mesh(geometry, m);
      mesh.name = entries.map(e => e.names[0]).join('; '); mesh.userData.parts = entries.flatMap(e => e.names);
      const solid = entries[0].solid; mesh.userData.habushiSolid = solid;
      mesh.receiveShadow = true; mesh.castShadow = solid; (solid ? this.solidsGroup : this.group).add(mesh);
      this.diagnostics.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      this.diagnostics.drawCalls++;
    }
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    if (this.diagnostics.disposed) return;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.group.clear(); this.solidsGroup.clear(); this.diagnostics.disposed = true;
  }
}
