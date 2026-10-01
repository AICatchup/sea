import * as THREE from 'three';
import type { AdventureState } from './contracts.ts';

/**
 * Original, metre-scale anatomy; no downloaded model, photographed skin or likeness.
 * The body is render-only: the controller owns its capsule and contact physics.
 * +Y is up and -Z is the anatomical forward axis. All geometry has real thickness.
 */
export const PLAYER_BODY_DIMENSIONS = Object.freeze({
  height: 1.75, standingEyeHeight: 1.64, shoulderWidth: .45,
  controllerRadius: .25, upperArmLength: .302, forearmLength: .274,
  upperLegLength: .43, lowerLegLength: .415,
});

type Action = NonNullable<AdventureState['avatarAction']>;
type SkinWeight = [number, number, number, number];
interface Ring { p: THREE.Vector3; a: number; b: number; weights: SkinWeight; }
interface Finger { base: THREE.Bone; middle: THREE.Bone; tip: THREE.Bone; thumb: boolean; }
interface Limb {
  upper: THREE.Bone; lower: THREE.Bone; end: THREE.Bone;
  upperRest: THREE.Vector3; lowerRest: THREE.Vector3; fingers?: Finger[];
}
const ACTIONS: Action[] = ['idle', 'walk', 'run', 'swim', 'dive', 'helm', 'climb'];
const SKIN = 0, SUIT = 1, PANEL = 2, SEAM = 3, RUBBER = 4, METAL = 5, NAIL = 6;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value! : fallback;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rigid = (index: number): SkinWeight => [index, index, 1, 0];
const mix = (a: number, b: number, t: number): SkinWeight => [a, b, 1 - t, t];

/** One indexed mesh, material-sorted groups: seven body draws, including detail. */
class Sculpt {
  positions: number[] = []; uvs: number[] = []; skinIndices: number[] = []; skinWeights: number[] = [];
  readonly faces: number[][] = Array.from({ length: 7 }, () => []);

  vertex(point: THREE.Vector3, weights: SkinWeight, u = 0, w = 0): number {
    const i = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z); this.uvs.push(u, w);
    this.skinIndices.push(weights[0], weights[1], 0, 0);
    this.skinWeights.push(weights[2], weights[3], 0, 0);
    return i;
  }
  triangle(material: number, a: number, b: number, c: number): void { this.faces[material].push(a, b, c); }

  /** Smooth elliptical sections with closed caps, also used for palms and finger pads. */
  loft(rings: Ring[], material: number | ((r: number, theta: number) => number), segments = 20,
    axisA = v(1, 0, 0), axisB = v(0, 0, 1), deform?: (point: THREE.Vector3, r: number, theta: number) => void): void {
    const start = this.positions.length / 3;
    const circumference = Math.PI * (rings[0].a + rings[0].b);
    let length = 0;
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) length += rings[r].p.distanceTo(rings[r - 1].p);
      for (let s = 0; s <= segments; s++) {
        const theta = s / segments * Math.PI * 2, ring = rings[r];
        const point = ring.p.clone().addScaledVector(axisA, Math.cos(theta) * ring.a)
          .addScaledVector(axisB, Math.sin(theta) * ring.b);
        deform?.(point, r, theta);
        this.vertex(point, ring.weights, s / segments * circumference * 9, length * 9);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < segments; s++) {
      const a = start + r * (segments + 1) + s, b = a + 1, c = a + segments + 1, d = c + 1;
      const m = typeof material === 'number' ? material : material(r, (s + .5) / segments * Math.PI * 2);
      // A x B follows the ring sequence (-Y for vertical anatomy).
      this.triangle(m, a, b, c); this.triangle(m, b, d, c);
    }
    for (const last of [false, true]) {
      const r = last ? rings.length - 1 : 0;
      const middle = this.vertex(rings[r].p, rings[r].weights);
      const m = typeof material === 'number' ? material : material(r, 0);
      for (let s = 0; s < segments; s++) {
        const a = start + r * (segments + 1) + s, b = a + 1;
        if (last) this.triangle(m, middle, a, b); else this.triangle(m, middle, b, a);
      }
    }
  }

  ellipsoid(center: THREE.Vector3, size: THREE.Vector3, weights: SkinWeight, material: number,
    segments = 18, rows = 12, rotation?: THREE.Quaternion): void {
    // Descending rings keep outward winding, with poles capped instead of collapsed triangles.
    const rings: Ring[] = [];
    for (let r = 0; r <= rows; r++) {
      const latitude = .003 + (Math.PI - .006) * r / rows;
      rings.push({ p: center.clone().add(v(0, Math.cos(latitude) * size.y, 0)),
        a: Math.sin(latitude) * size.x, b: Math.sin(latitude) * size.z, weights });
    }
    this.loft(rings, material, segments, v(1, 0, 0), v(0, 0, 1), rotation ? (point) => {
      point.sub(center).applyQuaternion(rotation).add(center);
    } : undefined);
  }

  line(points: THREE.Vector3[], radius: number, weights: SkinWeight, material: number, segments = 6): void {
    if (points.length < 2) return;
    const direction = points[points.length - 1].clone().sub(points[0]).normalize();
    const a = new THREE.Vector3().crossVectors(direction, Math.abs(direction.y) < .9 ? UP : v(0, 0, 1)).normalize();
    const b = new THREE.Vector3().crossVectors(direction, a).normalize();
    this.loft(points.map(p => ({ p, a: radius, b: radius, weights })), material, segments, a, b);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeights, 4));
    const index: number[] = [];
    for (let material = 0; material < this.faces.length; material++) {
      const faces = this.faces[material]; geometry.addGroup(index.length, faces.length, material); index.push(...faces);
    }
    geometry.setIndex(index); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    // Join duplicated UV seam normals; otherwise a close hand acquires a lighting seam.
    const normal = geometry.getAttribute('normal');
    const groups = new Map<string, number[]>();
    for (let i = 0; i < this.positions.length / 3; i++) {
      const key = `${Math.round(this.positions[i * 3] * 1e6)},${Math.round(this.positions[i * 3 + 1] * 1e6)},${Math.round(this.positions[i * 3 + 2] * 1e6)}`;
      const list = groups.get(key); if (list) list.push(i); else groups.set(key, [i]);
    }
    const n = new THREE.Vector3();
    for (const list of groups.values()) if (list.length > 1) {
      n.set(0, 0, 0); for (const i of list) n.add(v(normal.getX(i), normal.getY(i), normal.getZ(i))); n.normalize();
      for (const i of list) normal.setXYZ(i, n.x, n.y, n.z);
    }
    return geometry;
  }
}

/** Deterministic microstructure, generated locally rather than a painted photograph. */
function microTexture(kind: 'skin' | 'cloth', normal: boolean): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  const field = (x: number, y: number) => kind === 'cloth'
    ? Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) * .65 + Math.sin((x + y) * .9) * .14
    : Math.sin(x * Math.PI * 30 / size + Math.sin(y * Math.PI * 14 / size) * 1.6)
      * Math.sin(y * Math.PI * 54 / size) * .27 + Math.sin(x * Math.PI * 86 / size + y * Math.PI * 110 / size) * .11;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, f = field(x, y);
    if (normal) {
      const strength = kind === 'cloth' ? .13 : .11;
      const dx = (field(x + 1, y) - field(x - 1, y)) * strength;
      const dy = (field(x, y + 1) - field(x, y - 1)) * strength;
      const n = v(-dx, -dy, 1).normalize();
      data[i] = Math.round((n.x * .5 + .5) * 255); data[i + 1] = Math.round((n.y * .5 + .5) * 255); data[i + 2] = Math.round((n.z * .5 + .5) * 255);
    } else {
      const value = clamp(Math.round(238 + f * 15), 0, 255);
      data[i] = value; data[i + 1] = value; data[i + 2] = value;
    }
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = `original-${kind}-${normal ? 'normal' : 'roughness'}`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

export class FirstPersonBody {
  readonly group = new THREE.Group();
  private readonly bones: THREE.Bone[] = [];
  private readonly boneIndex = new Map<THREE.Bone, number>();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly textures: THREE.Texture[];
  private readonly pelvis: THREE.Bone;
  private readonly spine: THREE.Bone;
  private readonly chest: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly arms: Limb[] = [];
  private readonly legs: Limb[] = [];
  private readonly weights:number[] = ACTIONS.map(a => a === 'idle' ? 1 : 0);
  private readonly eye = new THREE.Vector3();
  private readonly localEye = new THREE.Vector3();
  private readonly inverseGroup = new THREE.Matrix4();
  private readonly rootQuaternion = new THREE.Quaternion();
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly bend = new THREE.Vector3();
  private readonly poseEuler = new THREE.Euler();
  private readonly boatQuaternion = new THREE.Quaternion();
  private readonly helmWorld = new THREE.Vector3();
  private phase = 0;
  private wet = 0;
  private lean = 0;
  private boarding = 0;
  private initialized = false;
  private disposed = false;

  constructor() {
    this.group.name = 'First-person diver';
    this.group.userData.bodyDimensions = PLAYER_BODY_DIMENSIONS;
    this.group.userData.collision = 'render-only; controller owns capsule';
    this.pelvis = this.bone('pelvis', v(0, .94, .035));
    this.spine = this.bone('lumbar', v(0, 1.10, .03), this.pelvis);
    this.chest = this.bone('chest', v(0, 1.36, .015), this.spine);
    const neck = this.bone('neck', v(0, 1.505, .014), this.chest);
    // Rotate the head around its eye, as a first-person camera does. The blended
    // neck follows below it, keeping the feet planted when the player looks down.
    this.head = this.bone('head', v(0, 1.64, -.056), neck);
    const sculpt = new Sculpt();
    this.sculptTorso(sculpt, neck);
    this.sculptHead(sculpt);
    for (const side of [-1, 1]) {
      this.arms.push(this.sculptArm(sculpt, side));
      this.legs.push(this.sculptLeg(sculpt, side));
    }
    this.sculptGear(sculpt);
    const skinNormal = microTexture('skin', true), skinRoughness = microTexture('skin', false);
    const clothNormal = microTexture('cloth', true), clothRoughness = microTexture('cloth', false);
    this.textures = [skinNormal, skinRoughness, clothNormal, clothRoughness];
    const standard = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({
      color, roughness, metalness, side: THREE.FrontSide, });
    this.materials = [
      standard(0xae8063, .74), standard(0x172a31, .89), standard(0x34474a, .91),
      standard(0x596767, .88), standard(0x12191a, .92), standard(0x6e7674, .44, .73), standard(0xcda89b, .53),
    ];
    this.materials[SKIN].normalMap = skinNormal; this.materials[SKIN].normalScale.set(.55, .55); this.materials[SKIN].roughnessMap = skinRoughness;
    for (const i of [SUIT, PANEL, SEAM]) {
      this.materials[i].normalMap = clothNormal; this.materials[i].normalScale.set(.65, .65); this.materials[i].roughnessMap = clothRoughness;
    }
    this.materials.forEach((material, i) => { material.name = ['sun-exposed skin', 'neoprene', 'reinforced cloth', 'stitched binding', 'boot rubber', 'gear metal', 'natural nails'][i]; });
    this.mesh = new THREE.SkinnedMesh(sculpt.build(), this.materials);
    this.mesh.name = 'Continuous volumetric anatomy';
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    // A skinned body is always within the nearby camera capsule; avoid stale rest-pose culling.
    this.mesh.frustumCulled = false;
    this.group.add(this.pelvis, this.mesh); this.group.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones)); this.mesh.normalizeSkinWeights();
    this.group.userData.geometryBudget = { triangles: this.mesh.geometry.index!.count / 3, materialDraws: this.materials.length, bones: this.bones.length };
  }

  private bone(name: string, point: THREE.Vector3, parent?: THREE.Bone): THREE.Bone {
    const bone = new THREE.Bone(); bone.name = name; bone.position.copy(point);
    if (parent) {
      // Rest bone rotations are identity. Store global rest point before attaching.
      const p = parent.userData.restPoint as THREE.Vector3; bone.position.sub(p); parent.add(bone);
    }
    bone.userData.restPoint = point.clone(); this.boneIndex.set(bone, this.bones.length); this.bones.push(bone);
    return bone;
  }
  private index(bone: THREE.Bone): number { return this.boneIndex.get(bone)!; }
  private ring(x: number, y: number, z: number, a: number, b: number, weights: SkinWeight): Ring {
    return { p: v(x, y, z), a, b, weights };
  }

  private sculptTorso(s: Sculpt, neck: THREE.Bone): void {
    const hip = this.index(this.pelvis), lumbar = this.index(this.spine), chest = this.index(this.chest), n = this.index(neck);
    s.loft([
      this.ring(0, 1.51, .012, .060, .055, mix(chest, n, .7)),
      this.ring(0, 1.465, .013, .106, .068, rigid(chest)),
      this.ring(0, 1.425, .016, .177, .089, rigid(chest)),
      this.ring(0, 1.365, .019, .181, .106, rigid(chest)),
      this.ring(0, 1.285, .026, .172, .111, mix(lumbar, chest, .67)),
      this.ring(0, 1.19, .03, .158, .100, mix(lumbar, chest, .2)),
      this.ring(0, 1.10, .031, .143, .088, rigid(lumbar)),
      this.ring(0, 1.00, .034, .159, .107, mix(hip, lumbar, .3)),
      this.ring(0, .93, .035, .159, .116, rigid(hip)),
      this.ring(0, .85, .032, .095, .084, rigid(hip)),
    ], (r, angle) => r < 2 || Math.sin(angle) > .25 || Math.abs(Math.cos(angle)) > .87 ? SUIT : PANEL, 40,
    v(1, 0, 0), v(0, 0, 1), (point, r, theta) => {
      // Subtle chest/abdomen shaping and two pectoral volumes under close-fitting cloth.
      if (r >= 2 && r <= 5 && Math.sin(theta) < 0) point.z -= Math.pow(Math.abs(Math.cos(theta)), 2) * .011;
    });
    // The hood neck overlaps the collar and chin: no detached head or open neck gap.
    s.loft([
      this.ring(0, 1.566, .013, .048, .048, mix(n, this.index(this.head), .7)),
      this.ring(0, 1.535, .013, .047, .048, mix(n, this.index(this.head), .3)),
      this.ring(0, 1.496, .013, .058, .054, rigid(n)),
    ], SUIT, 28);
    // Centre zipper and its flat stitched surround follow the sternum, not a floating plaque.
    s.line([v(0, 1.463, -.054), v(0, 1.4, -.090), v(0, 1.30, -.09), v(0, 1.17, -.068)], .003, rigid(chest), RUBBER, 7);
    s.ellipsoid(v(.0, 1.434, -.073), v(.005, .013, .0025), rigid(chest), METAL, 10, 6);
    for (const side of [-1, 1]) {
      s.line([v(side * .058, 1.453, -.047), v(side * .12, 1.41, -.065), v(side * .162, 1.37, -.054)], .0012, rigid(chest), SEAM);
      // Shoulder straps for a compact coastal diving harness.
      s.line([v(side * .131, 1.452, -.023), v(side * .129, 1.38, -.073), v(side * .116, 1.275, -.082)], .012, rigid(chest), RUBBER, 10);
      s.ellipsoid(v(side * .12, 1.286, -.092), v(.014, .023, .009), rigid(chest), METAL, 12, 8);
      s.line([v(side * .149, 1.11, -.008), v(side * .157, .99, -.015), v(side * .15, .93, -.023)], .0015, mix(hip, lumbar, .4), SEAM);
    }
  }

  private sculptHead(s: Sculpt): void {
    const weight = rigid(this.index(this.head));
    s.loft([
      this.ring(0, 1.748, .015, .012, .018, weight), this.ring(0, 1.729, .015, .051, .050, weight),
      this.ring(0, 1.699, .015, .073, .069, weight), this.ring(0, 1.668, .012, .081, .078, weight),
      this.ring(0, 1.633, .006, .081, .079, weight), this.ring(0, 1.600, .002, .072, .074, weight),
      this.ring(0, 1.568, -.002, .061, .063, weight), this.ring(0, 1.546, -.010, .049, .050, weight),
      this.ring(0, 1.529, .005, .040, .043, weight),
    ], (r, angle) => Math.sin(angle) < -.49 && r > 1 && r < 8 ? SKIN : SUIT, 36,
    v(1, 0, 0), v(0, 0, 1), (point, r, theta) => {
      if (Math.sin(theta) < 0 && r >= 3 && r <= 6) {
        const cheek = Math.exp(-Math.pow((Math.abs(point.x) - .041) / .02, 2)); point.z -= cheek * .006;
      }
    });
    // Nose bridge, alar wings and mouth belong to the same head bone and closed volume.
    s.ellipsoid(v(0, 1.623, -.078), v(.012, .029, .014), weight, SKIN, 16, 12);
    s.ellipsoid(v(0, 1.607, -.087), v(.014, .010, .015), weight, SKIN, 16, 10);
    for (const side of [-1, 1]) {
      s.ellipsoid(v(side * .012, 1.603, -.082), v(.008, .007, .008), weight, SKIN, 12, 8);
      s.line([v(side * .016, 1.658, -.071), v(side * .03, 1.661, -.077), v(side * .046, 1.656, -.071)], .0024, weight, RUBBER);
    }
    s.ellipsoid(v(0, 1.582, -.067), v(.024, .0035, .003), weight, SKIN, 20, 6);
    // A fitted hood avoids hair cards, transparent overlaps and floating head geometry.
    s.line([v(-.064, 1.699, -.035), v(-.068, 1.645, -.039), v(-.059, 1.588, -.034), v(-.035, 1.55, -.039)], .0022, weight, SEAM);
    s.line([v(.064, 1.699, -.035), v(.068, 1.645, -.039), v(.059, 1.588, -.034), v(.035, 1.55, -.039)], .0022, weight, SEAM);
  }

  private sculptArm(s: Sculpt, side: number): Limb {
    const prefix = side < 0 ? 'left' : 'right';
    const shoulder = v(side * .185, 1.407, .012), elbow = v(side * .257, 1.115, -.014), wrist = v(side * .266, .844, -.052);
    const upper = this.bone(`${prefix} shoulder`, shoulder, this.chest);
    const lower = this.bone(`${prefix} elbow`, elbow, upper);
    const end = this.bone(`${prefix} wrist`, wrist, lower);
    const u = this.index(upper), l = this.index(lower), w = this.index(end);
    s.loft([
      this.ring(side * .170, 1.444, .015, .058, .067, mix(this.index(this.chest), u, .7)),
      this.ring(side * .195, 1.378, .01, .052, .060, rigid(u)),
      this.ring(side * .230, 1.298, .005, .055, .058, rigid(u)),
      this.ring(side * .247, 1.22, -.005, .047, .051, mix(u, l, .13)),
      this.ring(side * .257, 1.115, -.014, .041, .045, mix(u, l, .5)),
      this.ring(side * .263, 1.051, -.024, .046, .049, rigid(l)),
      this.ring(side * .267, .976, -.035, .040, .043, rigid(l)),
      this.ring(side * .267, .901, -.043, .028, .032, rigid(l)),
      this.ring(side * .266, .850, -.051, .026, .026, mix(l, w, .3)),
    ], (r, angle) => r >= 3 && r <= 5 && Math.sin(angle) > 0 ? PANEL : SUIT, 24);
    s.loft([
      this.ring(side * .267, .866, -.049, .0275, .028, rigid(l)),
      this.ring(side * .266, .843, -.052, .027, .025, mix(l, w, .5)),
    ], RUBBER, 24);
    s.line([v(side * .281, 1.08, -.063), v(side * .283, 1.0, -.071), v(side * .282, .91, -.070)], .0011, rigid(l), SEAM);
    const fingers = this.sculptHand(s, side, end, wrist);
    // A real watch only on the left wrist, scaled to a 37 mm case.
    if (side < 0) {
      s.loft([this.ring(wrist.x, .91, -.043, .03, .035, rigid(l)), this.ring(wrist.x, .888, -.046, .029, .034, rigid(l))], RUBBER, 24);
      s.ellipsoid(v(wrist.x, .900, -.076), v(.019, .019, .006), rigid(l), METAL, 20, 10);
      s.ellipsoid(v(wrist.x, .900, -.082), v(.0155, .0155, .0015), rigid(l), RUBBER, 20, 8);
      s.line([v(wrist.x, .900, -.084), v(wrist.x + .009, .905, -.084)], .0007, rigid(l), SEAM);
    }
    return { upper, lower, end, fingers, upperRest: elbow.clone().sub(shoulder), lowerRest: wrist.clone().sub(elbow) };
  }

  private sculptHand(s: Sculpt, side: number, hand: THREE.Bone, origin: THREE.Vector3): Finger[] {
    const h = this.index(hand), weight = rigid(h);
    const handPoint = (x: number, y: number, z: number) => origin.clone().add(v(x, y, z));
    s.loft([
      { p: handPoint(0, .008, 0), a: .025, b: .023, weights: weight },
      { p: handPoint(0, -.018, -.002), a: .030, b: .022, weights: weight },
      { p: handPoint(-side * .003, -.044, -.002), a: .040, b: .020, weights: weight },
      { p: handPoint(0, -.072, .001), a: .046, b: .017, weights: weight },
      { p: handPoint(side * .002, -.093, .002), a: .044, b: .014, weights: weight },
      { p: handPoint(side * .003, -.105, .002), a: .031, b: .010, weights: weight },
    ], SKIN, 32, v(1, 0, 0), v(0, 0, 1), (point, r, theta) => {
      // The fleshy thenar side and metacarpal ridge are asymmetric, never a flat slab.
      if (r >= 1 && r <= 3 && Math.cos(theta) * side < 0 && Math.sin(theta) < 0) point.z -= .007;
    });
    s.ellipsoid(handPoint(-side * .023, -.043, -.013), v(.024, .027, .012), weight, SKIN, 20, 14);
    s.ellipsoid(handPoint(side * .025, -.067, -.007), v(.018, .027, .010), weight, SKIN, 20, 12);
    const fingers: Finger[] = [];
    const specs = [
      { name: 'index', x: -side * .030, y: -.096, lengths: [.035, .024, .018], radius: .0102, spread: -side * .065 },
      { name: 'middle', x: -side * .009, y: -.100, lengths: [.039, .026, .019], radius: .0108, spread: -side * .008 },
      { name: 'ring', x: side * .014, y: -.099, lengths: [.035, .025, .018], radius: .0102, spread: side * .039 },
      { name: 'little', x: side * .034, y: -.091, lengths: [.027, .019, .016], radius: .0082, spread: side * .115 },
    ];
    for (const spec of specs) {
      const basePoint = handPoint(spec.x, spec.y, .001);
      const joint1 = basePoint.clone().add(v(spec.spread * spec.lengths[0], -spec.lengths[0], 0));
      const joint2 = joint1.clone().add(v(spec.spread * spec.lengths[1], -spec.lengths[1], 0));
      const tipPoint = joint2.clone().add(v(spec.spread * spec.lengths[2], -spec.lengths[2], -.001));
      const base = this.bone(`${side < 0 ? 'left' : 'right'} ${spec.name} proximal`, basePoint, hand);
      const middle = this.bone(`${spec.name} middle`, joint1, base), tip = this.bone(`${spec.name} distal`, joint2, middle);
      const a = this.index(base), b = this.index(middle), c = this.index(tip);
      const fingerRing = (point: THREE.Vector3, radius: number, weights: SkinWeight) => ({ p: point, a: radius, b: radius * .85, weights });
      s.loft([
        fingerRing(basePoint.clone().add(v(0, .009, 0)), spec.radius * .93, mix(h, a, .35)),
        fingerRing(basePoint.clone().add(v(0, .001, 0)), spec.radius, mix(h, a, .9)),
        fingerRing(basePoint.clone().lerp(joint1, .45), spec.radius * .98, rigid(a)),
        fingerRing(joint1.clone().add(v(0, .006, 0)), spec.radius * .96, mix(a, b, .2)),
        fingerRing(joint1, spec.radius * 1.02, mix(a, b, .5)),
        fingerRing(joint1.clone().lerp(joint2, .45), spec.radius * .85, rigid(b)),
        fingerRing(joint2, spec.radius * .84, mix(b, c, .5)),
        fingerRing(joint2.clone().lerp(tipPoint, .5), spec.radius * .78, rigid(c)),
        fingerRing(tipPoint.clone().add(v(0, .003, 0)), spec.radius * .61, rigid(c)),
        fingerRing(tipPoint, spec.radius * .23, rigid(c)),
      ], SKIN, 18);
      // Rounded keratin plate on the dorsal side, with exposed fingertip below it.
      const nailCenter = joint2.clone().lerp(tipPoint, .58); nailCenter.z += spec.radius * .72;
      s.ellipsoid(nailCenter, v(spec.radius * .59, spec.lengths[2] * .37, .0011), rigid(c), NAIL, 16, 8);
      for (const [joint, index] of [[joint1, b], [joint2, c]] as [THREE.Vector3, number][]) {
        // Fine shallow dorsal folds: narrower than a millimetre, not black ring bands.
        s.line([joint.clone().add(v(-spec.radius * .65, .001, spec.radius * .76)),
          joint.clone().add(v(0, .002, spec.radius * .88)), joint.clone().add(v(spec.radius * .65, .001, spec.radius * .76))], .00035, rigid(index), SKIN, 5);
      }
      s.ellipsoid(basePoint.clone().add(v(0, .005, .007)), v(spec.radius * .83, .009, .004), mix(h, a, .4), SKIN, 14, 8);
      fingers.push({ base, middle, tip, thumb: false });
    }
    // The thumb has its own saddle/metacarpal rotation and opposed palmar pad.
    const thumbRoot = handPoint(-side * .028, -.029, -.006);
    const thumbJoint = handPoint(-side * .055, -.051, -.008);
    const thumbDistal = handPoint(-side * .064, -.077, -.005);
    const thumbEnd = handPoint(-side * .065, -.100, -.005);
    const base = this.bone('thumb metacarpal', thumbRoot, hand);
    const middle = this.bone('thumb proximal', thumbJoint, base), tip = this.bone('thumb distal', thumbDistal, middle);
    const a = this.index(base), b = this.index(middle), c = this.index(tip);
    s.loft([
      { p: thumbRoot.clone().add(v(side * .004, .008, 0)), a: .017, b: .015, weights: mix(h, a, .4) },
      { p: thumbRoot, a: .016, b: .014, weights: rigid(a) },
      { p: thumbRoot.clone().lerp(thumbJoint, .6), a: .013, b: .011, weights: rigid(a) },
      { p: thumbJoint, a: .012, b: .011, weights: mix(a, b, .5) },
      { p: thumbJoint.clone().lerp(thumbDistal, .6), a: .011, b: .010, weights: rigid(b) },
      { p: thumbDistal, a: .0105, b: .0095, weights: mix(b, c, .5) },
      { p: thumbDistal.clone().lerp(thumbEnd, .7), a: .0092, b: .0085, weights: rigid(c) },
      { p: thumbEnd, a: .003, b: .003, weights: rigid(c) },
    ], SKIN, 20);
    s.ellipsoid(thumbDistal.clone().lerp(thumbEnd, .57).add(v(0, 0, .008)), v(.007, .008, .0012), rigid(c), NAIL, 18, 8);
    // Webbing under the four finger roots keeps their attachment fleshy and volumetric.
    for (let i = 0; i < specs.length - 1; i++) {
      const x = (specs[i].x + specs[i + 1].x) * .5;
      s.ellipsoid(handPoint(x, -.097, 0), v(.007, .009, .010), weight, SKIN, 14, 8);
    }
    fingers.push({ base, middle, tip, thumb: true });
    // Palm lines are small shallow folds with the skin material, visible only nearby.
    const crease = (points: [number, number, number][]) => s.line(points.map(p => handPoint(p[0], p[1], p[2])), .00045, weight, SKIN, 5);
    crease([[-side * .020, -.026, -.021], [-side * .032, -.046, -.023], [-side * .024, -.066, -.025]]);
    crease([[-side * .030, -.068, -.020], [0, -.073, -.019], [side * .033, -.069, -.017]]);
    crease([[-side * .026, -.089, -.011], [0, -.092, -.013], [side * .031, -.086, -.013]]);
    return fingers;
  }

  private sculptLeg(s: Sculpt, side: number): Limb {
    const prefix = side < 0 ? 'left' : 'right';
    const hip = v(side * .095, .925, .030), knee = v(side * .099, .501, .004), ankle = v(side * .103, .087, .022);
    const upper = this.bone(`${prefix} hip`, hip, this.pelvis), lower = this.bone(`${prefix} knee`, knee, upper), end = this.bone(`${prefix} ankle`, ankle, lower);
    const u = this.index(upper), l = this.index(lower), a = this.index(end);
    s.loft([
      this.ring(side * .092, .956, .035, .087, .097, mix(this.index(this.pelvis), u, .5)),
      this.ring(side * .092, .849, .029, .090, .088, rigid(u)),
      this.ring(side * .094, .754, .021, .081, .084, rigid(u)),
      this.ring(side * .098, .641, .010, .068, .072, rigid(u)),
      this.ring(side * .099, .554, .004, .055, .060, mix(u, l, .15)),
      this.ring(side * .099, .501, .004, .051, .056, mix(u, l, .5)),
      this.ring(side * .1, .454, .012, .052, .060, mix(u, l, .9)),
      this.ring(side * .102, .353, .026, .059, .064, rigid(l)),
      this.ring(side * .103, .25, .028, .045, .050, rigid(l)),
      this.ring(side * .103, .16, .025, .032, .038, rigid(l)),
      this.ring(side * .103, .087, .022, .032, .039, mix(l, a, .6)),
    ], (r, angle) => r >= 3 && r <= 7 && Math.sin(angle) < -.2 ? PANEL : SUIT, 26);
    // Reinforced kneecap has its own rounded volume, no square pads pasted to the leg.
    s.ellipsoid(v(side * .099, .509, -.045), v(.044, .068, .013), mix(u, l, .5), PANEL, 22, 16);
    s.line([v(side * .137, .588, -.009), v(side * .148, .517, -.017), v(side * .144, .448, -.008)], .0013, mix(u, l, .5), SEAM);
    // Closed 25 cm boot with an anatomical instep, heel cup and broad toe box.
    const boot = [
      this.ring(side * .103, .153, .021, .035, .039, mix(l, a, .9)),
      this.ring(side * .103, .112, .007, .042, .056, rigid(a)),
      this.ring(side * .103, .073, -.038, .048, .097, rigid(a)),
      this.ring(side * .103, .039, -.058, .052, .117, rigid(a)),
      this.ring(side * .103, .018, -.055, .052, .119, rigid(a)),
    ];
    s.loft(boot, RUBBER, 30, v(1, 0, 0), v(0, 0, 1), (point, r, theta) => {
      if (r >= 2 && Math.sin(theta) < -.35) point.x += side * .004 * -Math.sin(theta);
    });
    for (const y of [.024, .034]) s.line([v(side * .054, y, -.072), v(side * .059, y, -.13), v(side * .102, y, -.171), v(side * .145, y, -.132), v(side * .152, y, -.068)], .0014, rigid(a), SEAM);
    return { upper, lower, end, upperRest: knee.clone().sub(hip), lowerRest: ankle.clone().sub(knee) };
  }

  private sculptGear(s: Sculpt): void {
    const chest = rigid(this.index(this.chest)), hip = rigid(this.index(this.pelvis));
    // Buoyancy vest and a compact 7 litre cylinder are worn, rather than floating props.
    s.ellipsoid(v(0, 1.279, .115), v(.139, .190, .060), chest, RUBBER, 28, 22);
    s.ellipsoid(v(0, 1.236, .194), v(.086, .280, .085), chest, METAL, 24, 24);
    s.ellipsoid(v(0, .995, .194), v(.088, .042, .087), chest, RUBBER, 20, 10);
    s.line([v(0, 1.51, .194), v(0, 1.543, .194)], .012, chest, METAL, 10);
    for (const y of [1.13, 1.37]) s.loft([
      this.ring(0, y + .012, .194, .088, .087, chest), this.ring(0, y - .012, .194, .088, .087, chest),
    ], RUBBER, 24);
    s.loft([this.ring(0, 1.035, .033, .163, .109, hip), this.ring(0, .999, .033, .166, .112, hip)], RUBBER, 36);
    s.ellipsoid(v(0, 1.018, -.084), v(.022, .018, .006), hip, METAL, 16, 8);
    // One short inflator hose secured to the left shoulder rather than loose floating gear.
    s.line([v(-.134, 1.435, .054), v(-.173, 1.396, .015), v(-.181, 1.321, -.054), v(-.158, 1.246, -.071)], .006, chest, RUBBER, 10);
  }

  update(state: AdventureState, camera: THREE.PerspectiveCamera, delta: number, time: number): void {
    if (this.disposed || ![state.yaw, state.pitch, state.speed, time, camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite)) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, .08);
    const action: Action = state.avatarAction ?? (state.mode === 'boat' ? 'helm' : state.mode === 'dive' ? 'dive' : state.mode === 'swim' ? 'swim' : Math.abs(state.speed) > 3.5 ? 'run' : Math.abs(state.speed) > .1 ? 'walk' : 'idle');
    const damping = this.initialized ? 1 - Math.exp(-dt * 7.5) : 1;
    const seated=Number.isFinite(state.seatingBlend)&&state.seatingBlend!>0?clamp(state.seatingBlend!,0,1):null;
    for(let i=0;i<ACTIONS.length;i++){
      const target=seated===null?(ACTIONS[i]===action?1:0):ACTIONS[i]==='helm'?seated:ACTIONS[i]==='climb'?1-seated:0;
      this.weights[i]+=(target-this.weights[i])*damping;
    }
    const [idle, walk, run, swim, dive, helm, climb] = this.weights;
    const speed = clamp(Math.abs(state.speed), 0, 7), moving = walk + run;
    this.phase = Number.isFinite(state.gaitPhase) ? state.gaitPhase! : this.phase + dt * (speed * 2.2 + (swim + dive) * 3.4);
    const gait = Math.sin(this.phase), water = swim + dive;
    this.wet += (clamp(finite(state.immersion, water), 0, 1) - this.wet) * (1 - Math.exp(-dt * 3));
    this.materials[SKIN].roughness = .74 - this.wet * .18;
    this.materials[SUIT].roughness = .89 - this.wet * .28; this.materials[PANEL].roughness = .91 - this.wet * .24;
    const leanTarget = swim * 1.03 + dive * 1.16;
    this.lean = this.initialized ? this.lean + clamp(leanTarget - this.lean, -dt * 1.8, dt * 1.8) : leanTarget;
    const lean = this.lean;
    const boatPitch = clamp(finite(state.boatPitch), -.13, .13) * helm, boatRoll = clamp(finite(state.boatRoll), -.13, .13) * helm;
    const boatYaw = Number.isFinite(state.boatYaw) ? state.boatYaw : state.yaw;
    const yawDifference = Math.atan2(Math.sin(boatYaw - state.yaw), Math.cos(boatYaw - state.yaw));
    const bodyYaw = state.yaw + yawDifference * helm;
    this.group.quaternion.setFromEuler(this.poseEuler.set(-lean + boatPitch, -bodyYaw, boatRoll, 'YXZ'));
    const fatigue = 1 - clamp(finite(state.stamina, 1), 0, 1);
    const breath = Math.sin(time * (1.68 + fatigue * .75)) * (.0035 + fatigue * .0017) * (1 - water * .5);
    if (action === 'climb') this.boarding += (clamp(finite(state.boardingProgress, this.boarding), 0, 1) - this.boarding) * damping;
    const climbPhase = time * 3.4 + this.boarding * Math.PI;
    // Seat contact compresses the lumbar chain slightly while leaving the eye fixed.
    this.pelvis.position.y = .94 + helm * .035; this.spine.position.y = .16 - helm * .035;
    this.pelvis.rotation.set(gait * moving * .016, gait * moving * .016, gait * moving * .014);
    this.spine.rotation.set(clamp(state.pitch, -.5, .5) * .08 - run * .035, 0, -gait * moving * .014);
    this.chest.rotation.set(breath + gait * moving * .012, -gait * moving * .018, 0);
    this.head.position.set(0, .135, -.070);
    if (state.viewOffset && [state.viewOffset.x, state.viewOffset.y, state.viewOffset.z].every(Number.isFinite)) {
      // Camera gait bob belongs at the head; moving the entire render body would
      // lift both planted feet off the terrain on every step.
      this.head.parent!.getWorldQuaternion(this.parentQuaternion).invert();
      this.scratch.copy(state.viewOffset).applyQuaternion(this.parentQuaternion); this.head.position.add(this.scratch);
    }
    // The closed head tracks pitch while the eye stays inside it. Front-side surfaces
    // disappear from the interior POV, but retain a complete shadow/reflection silhouette.
    this.head.rotation.set(state.pitch + lean - boatPitch - this.spine.rotation.x - this.chest.rotation.x,
      clamp(bodyYaw - state.yaw, -1.4, 1.4), -boatRoll);
    this.anchor(camera); this.group.getWorldQuaternion(this.rootQuaternion);
    this.boatQuaternion.setFromEuler(this.poseEuler.set(finite(state.boatPitch), -boatYaw, finite(state.boatRoll), 'YXZ'));

    for (let i = 0; i < this.arms.length; i++) {
      const side = i === 0 ? -1 : 1, phase = this.phase + (i === 0 ? 0 : Math.PI);
      const swing = Math.sin(phase), stroke = Math.sin(phase * .65), recovery = Math.cos(phase * .65);
      // Target positions are anatomical metres in body space, never a camera overlay.
      this.target.set(side * (.266 * idle + .27 * walk + .265 * run + (.33 + .052 * stroke) * water + .211 * helm + .22 * climb),
        .843 * idle + (.851 + .028 * swing) * walk + (1.007 + .085 * swing) * run
          + (1.43 + .22 * recovery) * water + 1.234 * helm + (1.49 + .08 * side * Math.sin(climbPhase)) * climb,
        -.052 * idle + (-.055 - .17 * swing) * walk + (-.185 - .15 * swing) * run
          + (-.36 - .10 * stroke) * water - .435 * helm - .335 * climb);
      if (helm > .001) {
        // Wheel centre is boat-local (.26,1.065,.23), radius .15 m. The wrist
        // stays aft of the rim by one articulated finger length, with palms inwards.
        this.helmWorld.set(.26 + side * .195, 1.126, .374).applyQuaternion(this.boatQuaternion).add(state.boatPosition);
        this.helmWorld.applyMatrix4(this.inverseGroup);
        this.target.addScaledVector(this.helmWorld.clone().sub(v(side * .211, 1.234, -.435)), helm);
      }
      // A small balancing response to acceleration remains coherent with the shoulder.
      const velocity = state.velocity;
      if (velocity) this.target.z -= clamp(finite(velocity.y), -3, 3) * .009 * moving;
      this.poseArm(this.arms[i], side, this.target);
      const wrist = this.arms[i].end;
      this.poseEuler.set(water * (.17 + stroke * .13) + helm * 1.19 + climb * .1,
        side * (.99 * idle + .87 * walk + .67 * run + .18 * water + .68 * helm + .18 * climb),
        side * (water * (Math.PI - stroke * .20) + climb * 2.5 + helm * .22), 'XYZ');
      this.orientAbsolute(wrist, this.targetQuaternion.setFromEuler(this.poseEuler));
      const curl = .20 * idle + .24 * walk + .43 * run + (.08 + .12 * Math.max(0, -stroke)) * water + .92 * helm + .7 * climb;
      const fingers = this.arms[i].fingers!;
      for (let f = 0; f < fingers.length; f++) {
        const finger = fingers[f], difference = f * .022;
        if (finger.thumb) {
          finger.base.rotation.set(curl * .29, -side * curl * .22, -side * curl * .26);
          finger.middle.rotation.set(curl * .32, 0, -side * curl * .1); finger.tip.rotation.set(curl * .45, 0, 0);
        } else {
          finger.base.rotation.set(curl + difference, 0, side * (f - 1.5) * .012 * water);
          finger.middle.rotation.set(curl * 1.05 + difference, 0, 0); finger.tip.rotation.set(curl * .65, 0, 0);
        }
      }
    }
    for (let i = 0; i < this.legs.length; i++) {
      const phase = this.phase + (i === 0 ? 0 : Math.PI), step = Math.sin(phase), leg = this.legs[i];
      const flutter = Math.sin(time * 4.2 + i * Math.PI), airborne = state.grounded === false ? moving : 0;
      leg.upper.rotation.set(step * (.31 * walk + .49 * run) + flutter * water * .13 + airborne * .12 + climb * (i === 0 ? .53 : .21) + helm * 1.087,
        0, (i === 0 ? -.015 : .015) * (1 - water));
      leg.lower.rotation.set(-Math.max(0, -step) * (.52 * walk + .88 * run) - .12 * water - .36 * airborne - climb * .67 - helm * 1.087, 0, 0);
      leg.end.rotation.set(step * .10 * moving + water * .22 + climb * .12, 0, 0);
    }
    this.anchor(camera);
    this.group.updateMatrixWorld(true); this.mesh.skeleton.update();
    this.initialized = true;
  }

  private anchor(camera: THREE.PerspectiveCamera): void {
    // Anchor to the actual camera eye, including the controller's viewOffset. Bone
    // bending changes the eye point; compensation keeps the camera inside the head.
    this.group.updateMatrixWorld(true); this.inverseGroup.copy(this.group.matrixWorld).invert();
    this.localEye.copy(this.eye).applyMatrix4(this.head.matrixWorld).applyMatrix4(this.inverseGroup);
    this.scratch.copy(this.localEye).applyQuaternion(this.group.quaternion);
    this.group.position.copy(camera.position).sub(this.scratch);
    this.group.updateMatrixWorld(true); this.inverseGroup.copy(this.group.matrixWorld).invert();
  }

  private poseArm(arm: Limb, side: number, wristTarget: THREE.Vector3): void {
    this.group.updateMatrixWorld(true); this.inverseGroup.copy(this.group.matrixWorld).invert();
    this.shoulder.setFromMatrixPosition(arm.upper.matrixWorld).applyMatrix4(this.inverseGroup);
    this.direction.copy(wristTarget).sub(this.shoulder);
    const upperLength = arm.upperRest.length(), lowerLength = arm.lowerRest.length();
    const distance = clamp(this.direction.length(), Math.abs(upperLength - lowerLength) + .025, upperLength + lowerLength - .012);
    this.direction.normalize();
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    this.bend.set(side * .9, -.10, .44).addScaledVector(this.direction, -this.bend.dot(this.direction));
    if (this.bend.lengthSq() < 1e-8) this.bend.set(side, 0, 0); this.bend.normalize();
    this.elbow.copy(this.shoulder).addScaledVector(this.direction, along).addScaledVector(this.bend, height);
    this.target.copy(this.shoulder).addScaledVector(this.direction, distance);
    this.scratch.copy(this.elbow).sub(this.shoulder).normalize();
    this.targetQuaternion.setFromUnitVectors(arm.upperRest.clone().normalize(), this.scratch);
    this.orientAbsolute(arm.upper, this.targetQuaternion);
    arm.upper.updateWorldMatrix(true, true);
    this.scratch.copy(this.target).sub(this.elbow).normalize();
    this.targetQuaternion.setFromUnitVectors(arm.lowerRest.clone().normalize(), this.scratch);
    this.orientAbsolute(arm.lower, this.targetQuaternion);
  }

  /** Desired orientation in unrotated body coordinates, accounting for posed parents. */
  private orientAbsolute(bone: THREE.Bone, bodyOrientation: THREE.Quaternion): void {
    bone.parent!.updateWorldMatrix(true, false); bone.parent!.getWorldQuaternion(this.parentQuaternion);
    this.parentQuaternion.invert();
    bone.quaternion.copy(this.parentQuaternion).multiply(this.rootQuaternion).multiply(bodyOrientation);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent();
    this.mesh.geometry.dispose(); this.mesh.skeleton.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
  }
}
