import * as THREE from 'three';
import type { AdventureState } from './contracts.ts';
import { createPlayerSkin } from './player-skin.ts';
import {helmHandPose,HELM_FINGER_CURL} from './helm-contact.ts';
import {boneKey,diverBodyMaterial,isHandKey,makeHumanGeometries,wearFields,type MakeHumanSource} from './makehuman-body.ts';
import {MOCAP_BONES,mocapFootLift,sampleMocapClip,type MocapGaitData} from './mocap-gait.ts';
import {PLAYER_DIMENSIONS} from './contracts.ts';

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
  shoulderRest?:THREE.Vector3;
}
const ACTIONS: Action[] = ['idle', 'walk', 'run', 'swim', 'dive', 'helm', 'climb'];
const SKIN = 0, SUIT = 1, PANEL = 2, SEAM = 3, RUBBER = 4, METAL = 5, NAIL = 6;
const UP = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
/** Heel and toe of the boot sole in the ankle frame. */
const SOLE_POINTS = [new THREE.Vector3(0, -.087, .03), new THREE.Vector3(0, -.07, -.17)];
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
        // Use the exact same angle for the duplicated UV seam. sin(2π) is slightly
        // negative, which otherwise enters one-sided anatomical deformation and
        // leaves millimetre-wide cracks in palms, chest and head.
        const theta = s === segments ? 0 : s / segments * Math.PI * 2, ring = rings[r];
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

/** Deterministic textile microstructure, generated locally rather than a photograph. */
function microTexture(normal: boolean): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  const field = (x: number, y: number) => Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) * .65 + Math.sin((x + y) * .9) * .14;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, f = field(x, y);
    if (normal) {
      const strength = .13;
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
  texture.name = `original-cloth-${normal ? 'normal' : 'roughness'}`;
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
  private readonly skin = createPlayerSkin();
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
  private readonly helmOrientation=new THREE.Quaternion();
  private readonly helmBodyOrientation=new THREE.Quaternion();
  private phase = 0;
  private wet = 0;
  private lean = 0;
  private boarding = 0;
  private initialized = false;
  private disposed = false;
  /** Gear triangles per material group; kept when the anatomy is swapped for MakeHuman. */
  private readonly gearFaces: number[][];
  /** CMU motion capture gait clips (opt-in); null keeps the procedural gait bit-exact. */
  private readonly mocapReach = new THREE.Quaternion();
  private mocap: { data: MocapGaitData; bones: THREE.Bone[]; land: THREE.Quaternion[]; run: THREE.Quaternion[]; swim: THREE.Quaternion[] } | null = null;
  private makehuman: { meshes: THREE.SkinnedMesh[]; materials: THREE.Material[]; textures: THREE.Texture[]; skin: THREE.MeshStandardMaterial; anatomy: THREE.BufferGeometry } | null = null;

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
    const beforeGear = sculpt.faces.map(faces => faces.length);
    this.sculptGear(sculpt);
    this.gearFaces = sculpt.faces.map((faces, material) => faces.slice(beforeGear[material]));
    const clothNormal = microTexture(true), clothRoughness = microTexture(false);
    this.textures = [...this.skin.textures, clothNormal, clothRoughness];
    const standard = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({
      color, roughness, metalness, side: THREE.FrontSide, });
    this.materials = [
      this.skin.material, standard(0x172a31, .89), standard(0x34474a, .91),
      standard(0x596767, .88), standard(0x12191a, .92), standard(0x6e7674, .44, .73), standard(0xb58c7d, .43),
    ];
    for (const i of [SUIT, PANEL, SEAM]) {
      this.materials[i].normalMap = clothNormal; this.materials[i].normalScale.set(.65, .65); this.materials[i].roughnessMap = clothRoughness;
    }
    this.materials.forEach((material, i) => { material.name = ['sun-exposed skin', 'neoprene', 'reinforced cloth', 'stitched binding', 'boot rubber', 'gear metal', 'natural nails'][i]; });
    const geometry = sculpt.build(), positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3).fill(1);
    const skinIndices = geometry.getAttribute('skinIndex');
    // Palmar skin is warmer and less sun-darkened than the dorsal surface. A
    // geometry-bound tint follows articulation without texture seams or an atlas.
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      if (Math.abs(x) > .19 && y > .64 && y < .87) {
        const palmar = clamp((-.052 - z) / .022, 0, 1);
        colors[i * 3] = 1 + palmar * .07;
        colors[i * 3 + 1] = 1 - palmar * .025;
        colors[i * 3 + 2] = 1 - palmar * .04;
        const bone = this.bones[skinIndices.getX(i)];
        const isFinger = /proximal|middle|distal|metacarpal/.test(bone.name);
        if (isFinger) {
          const rest = bone.userData.restPoint as THREE.Vector3;
          const jointDistance = Math.abs(y - rest.y);
          const knuckle = Math.exp(-((jointDistance / .0065) ** 2));
          const dorsal = clamp((z + .052) / .009, 0, 1);
          const distal = bone.name.includes('distal');
          const pulp = distal ? clamp((rest.y - y) / .016, 0, 1) * palmar : 0;
          const nailBed = distal ? Math.exp(-(((rest.y - y - .009) / .006) ** 2)) * dorsal : 0;
          // Blood-rich joint skin and fingertip pulp, contrasted with the paler
          // broad nail bed. These are anatomical fields, not uncorrelated noise.
          colors[i * 3] += knuckle * .045 + pulp * .045 + nailBed * .025;
          colors[i * 3 + 1] -= knuckle * .085 + pulp * .025 - nailBed * .05;
          colors[i * 3 + 2] -= knuckle * .085 + pulp * .035 - nailBed * .035;
        }
      }
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.skin.material.vertexColors = true;
    this.mesh = new THREE.SkinnedMesh(geometry, this.materials);
    this.mesh.name = 'Continuous volumetric anatomy';
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    // A skinned body is always within the nearby camera capsule; avoid stale rest-pose culling.
    this.mesh.frustumCulled = false;
    this.group.add(this.pelvis, this.mesh); this.group.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones)); this.mesh.normalizeSkinWeights();
    this.group.userData.geometryBudget = { triangles: this.mesh.geometry.index!.count / 3, materialDraws: this.materials.length, bones: this.bones.length };
    this.group.userData.handMorphology = { creaseConstruction: 'concave shell displacement',
      palmCreaseDepthMetres: [.0008, .00115], fingerPulpOffsetMetres: .0022,
      phalanxWaistRatio: [.78, .88], raisedSkinCreaseTubes: 0 };
  }

  /** Replace the sculpted anatomy with the CC0 MakeHuman body bound to the SAME skeleton.
   * Bones, rest pose, eye anchor, IK, helm and fishing contacts are untouched; only the
   * rendered skin changes. The worn gear (vest, cylinder, weights, hose) is kept. */
  useMakeHuman(source: MakeHumanSource): void {
    if (this.disposed || this.makehuman) return;
    const geometries = makeHumanGeometries(source, this.bones), textures = source.textures ?? {};
    const skin = diverBodyMaterial(textures.skin ?? null);
    // The cornea shell samples the texture's transparent corner: cut it so the iris shows.
    const eyes = new THREE.MeshStandardMaterial({ name: 'MakeHuman brown eyes (CC0)', map: textures.eyes ?? null, alphaTest: .5, roughness: .3, envMapIntensity: .5 });
    const hair = (map: THREE.Texture | undefined, name: string) => new THREE.MeshStandardMaterial({ name, map: map ?? null, alphaTest: .35, side: THREE.DoubleSide, roughness: .7, color: 0x2a2018 });
    const body = geometries.get('body')!;
    // Wear fields from the rest position, normal and hand-bone weight of every vertex.
    const position = body.getAttribute('position'), normals = body.getAttribute('normal'), joints = body.getAttribute('skinIndex'), weights = body.getAttribute('skinWeight');
    const face = new Float32Array(position.count), hand = new Float32Array(position.count), boot = new Float32Array(position.count);
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      let handWeight = 0;
      for (let k = 0; k < 4; k++) if (isHandKey(boneKey(this.bones[joints.getComponent(i, k)]))) handWeight += weights.getComponent(i, k);
      const w = wearFields(p.fromBufferAttribute(position, i), n.fromBufferAttribute(normals, i), handWeight);
      face[i] = w.face; hand[i] = w.hand; boot[i] = w.boot;
    }
    body.setAttribute('wearFace', new THREE.BufferAttribute(face, 1)); body.setAttribute('wearHand', new THREE.BufferAttribute(hand, 1)); body.setAttribute('wearBoot', new THREE.BufferAttribute(boot, 1));
    const meshes: THREE.SkinnedMesh[] = [];
    const add = (geometry: THREE.BufferGeometry | undefined, material: THREE.Material | THREE.Material[], name: string, shadow = true) => {
      if (!geometry) return;
      const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = name; mesh.frustumCulled = false;
      mesh.castShadow = shadow; mesh.receiveShadow = true; this.group.add(mesh);
      mesh.bind(this.mesh.skeleton, this.mesh.bindMatrix); meshes.push(mesh);
    };
    add(body, skin, 'MakeHuman diver anatomy (CC0)');
    add(geometries.get('eyes'), eyes, 'MakeHuman eyes (CC0)', false);
    add(geometries.get('eyebrows'), hair(textures.eyebrows, 'MakeHuman eyebrows (CC0)'), 'MakeHuman eyebrows (CC0)', false);
    add(geometries.get('eyelashes'), hair(textures.eyelashes, 'MakeHuman eyelashes (CC0)'), 'MakeHuman eyelashes (CC0)', false);
    // Keep only the worn gear from the sculpt; its vertex buffers are shared, not copied.
    const anatomy = this.mesh.geometry, gear = new THREE.BufferGeometry(), gearIndex: number[] = [];
    for (const name of Object.keys(anatomy.attributes)) gear.setAttribute(name, anatomy.getAttribute(name));
    this.gearFaces.forEach((faces, material) => { gear.addGroup(gearIndex.length, faces.length, material); gearIndex.push(...faces); });
    gear.setIndex(gearIndex); gear.boundingSphere = anatomy.boundingSphere?.clone() ?? null;
    this.mesh.geometry = gear;
    this.makehuman = { meshes, materials: [skin, eyes, ...meshes.slice(2).map(m => m.material as THREE.Material)], textures: Object.values(textures).filter((t): t is THREE.Texture => !!t), skin, anatomy };
    this.group.userData.makehuman = { triangles: body.index!.count / 3, gearTriangles: gearIndex.length / 3, provenance: source.meta.provenance };
  }

  /** Drive walk, run, swim and dive with looping CMU motion capture on the same skeleton.
   * Idle, helm, climb, fishing and surfing stay procedural; the head keeps the camera. */
  useMocap(data: MocapGaitData): void {
    if (this.disposed) return;
    const byKey = new Map(this.bones.map(b => [boneKey(b), b]));
    const quaternions = () => MOCAP_BONES.map(() => new THREE.Quaternion());
    this.mocap = { data, bones: MOCAP_BONES.map(k => { const b = byKey.get(k); if (!b) throw new Error(`mocap bone ${k}`); return b; }), land: quaternions(), run: quaternions(), swim: quaternions() };
    this.group.userData.mocap = { clips: Object.fromEntries(Object.entries(data.clips).map(([k, c]) => [k, { cycleSeconds: c.cycleSeconds, cycles: c.cycles, source: c.source }])), provenance: data.provenance };
  }

  private applyMocap(walk: number, run: number, water: number, lean: number, headOrientation: THREE.Euler): void {
    const m = this.mocap!, clips = m.data.clips, cycle = this.phase / (2 * Math.PI);
    const loco = walk + run + water;
    if (loco < 1e-4) return;
    sampleMocapClip(clips.walk, cycle, m.land); sampleMocapClip(clips.run, cycle, m.run); sampleMocapClip(clips.swim, cycle, m.swim);
    const runShare = walk + run > 1e-6 ? run / (walk + run) : 0, waterShare = water / loco;
    const body = loco * (1 - this.surfBlend), arms = body * (1 - this.fishingBlend);
    // The captured swimmer lies flat; the game swimmer keeps the head up at `lean` from
    // vertical. Lower the arms by the difference so the stroke reaches forward along the
    // surface instead of rising out of the water (80%: the reach stays in the eye's view).
    this.mocapReach.setFromAxisAngle(X_AXIS, -.8 * Math.max(0, Math.PI / 2 - lean) * waterShare);
    for (let k = 0; k < m.bones.length; k++) {
      const q = m.land[k].slerp(m.run[k], runShare).slerp(m.swim[k], waterShare);
      if (k === 3 || k === 6) q.premultiply(this.mocapReach);
      m.bones[k].quaternion.slerp(q, k >= 3 && k < 9 ? arms : body);
    }
    // Mocap trunk twist and sway must not turn the eye: the head stays camera-aligned.
    this.targetQuaternion.setFromEuler(headOrientation);
    this.orientAbsolute(this.head, this.targetQuaternion);
  }

  /** Real gait never straightens the stance knee, so the captured legs end above a floor
   * one standing eye height below the camera. Lower the body until the stance sole meets
   * it; running keeps its flight phase. In third person the drawn eye drops with the body
   * (as a real walker's does); in first person the eye stays on the camera. */
  private plantMocapFeet(walk: number, run: number, state: AdventureState, camera: THREE.PerspectiveCamera): void {
    const land = (walk + run) * (1 - this.surfBlend) * (state.grounded === false ? 0 : 1);
    if (land < 1e-3) return;
    const clips = this.mocap!.data.clips, cycle = this.phase / (2 * Math.PI), runShare = run / (walk + run);
    const lift = THREE.MathUtils.lerp(mocapFootLift(clips.walk, cycle), mocapFootLift(clips.run, cycle), runShare) * (this.legs[0].upperRest.length() + this.legs[0].lowerRest.length());
    const floor = camera.position.y - finite(state.viewOffset?.y) - PLAYER_DIMENSIONS.eyeHeight;
    let sole = Infinity;
    for (const leg of this.legs) for (const point of SOLE_POINTS) sole = Math.min(sole, this.scratch.copy(point).applyMatrix4(leg.end.matrixWorld).y);
    const drop = clamp(sole - floor - lift, 0, .1) * land;
    this.group.position.y -= drop;
    if (!this.relaxedStance) {
      // First person: the eye must stay on the camera, or the lowered head brings the
      // eyes and brows into the near view. Only the neck, unseen from the eye, lengthens.
      this.group.updateMatrixWorld(true); this.head.parent!.getWorldQuaternion(this.parentQuaternion).invert();
      this.head.position.add(this.scratch.set(0, drop, 0).applyQuaternion(this.parentQuaternion));
    }
    this.group.updateMatrixWorld(true);
    this.group.userData.mocapDrop = drop;
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
    return { upper, lower, end, fingers, shoulderRest:upper.position.clone(),upperRest: elbow.clone().sub(shoulder), lowerRest: wrist.clone().sub(elbow) };
  }

  private sculptHand(s: Sculpt, side: number, hand: THREE.Bone, origin: THREE.Vector3): Finger[] {
    const h = this.index(hand), weight = rigid(h);
    const handPoint = (x: number, y: number, z: number) => origin.clone().add(v(x, y, z));
    const palmSections: Ring[] = [
      { p: handPoint(0, .008, 0), a: .025, b: .023, weights: weight },
      { p: handPoint(0, -.018, -.002), a: .030, b: .022, weights: weight },
      { p: handPoint(-side * .003, -.044, -.002), a: .040, b: .020, weights: weight },
      { p: handPoint(0, -.072, .001), a: .046, b: .017, weights: weight },
      { p: handPoint(side * .002, -.093, .002), a: .044, b: .014, weights: weight },
      { p: handPoint(side * .003, -.105, .002), a: .031, b: .010, weights: weight },
    ];
    // Dense sections surround the transverse flexion folds. All detail belongs to
    // the same closed palm shell, including the thenar/hypothenar cushions.
    const palmLevels = [.008, -.004, -.018, -.026, -.036, -.044, -.052, -.061,
      -.066, -.069, -.071, -.073, -.075, -.077, -.081, -.086, -.089, -.091, -.093, -.095, -.099, -.105];
    const palmRings = palmLevels.map(y => {
      let i = 0; while (i < palmSections.length - 2 && y < palmSections[i + 1].p.y - origin.y) i++;
      const a = palmSections[i], b = palmSections[i + 1];
      const t = clamp((y - (a.p.y - origin.y)) / (b.p.y - a.p.y), 0, 1);
      return { p: a.p.clone().lerp(b.p, t), a: THREE.MathUtils.lerp(a.a, b.a, t), b: THREE.MathUtils.lerp(a.b, b.b, t), weights: weight };
    });
    s.loft(palmRings, SKIN, 40, v(1, 0, 0), v(0, 0, 1), (point, _r, theta) => {
      const x = (point.x - origin.x) * side, y = point.y - origin.y;
      const palmar = Math.max(0, -Math.sin(theta)), dorsal = Math.max(0, Math.sin(theta));
      // The fleshy thenar side and metacarpal ridge are asymmetric, never a flat slab.
      const thenar = Math.exp(-(((x + .023) / .023) ** 2 + ((y + .043) / .026) ** 2));
      const hypothenar = Math.exp(-(((x - .026) / .018) ** 2 + ((y + .066) / .030) ** 2));
      point.z -= palmar * palmar * (.012 * thenar + .004 * hypothenar);
      if (y < -.032) {
        for (const x of [-.030, -.009, .014, .034]) point.z += dorsal ** 3 * .0011 * Math.exp(-(((point.x - origin.x - side * x) / .004) ** 2));
      }
      // Actual concave folds: inward displacement towards the palm interior.
      const transverse = Math.exp(-(((y + .073 + x * .10) / .0016) ** 2));
      const distal = Math.exp(-(((y + .091 - x * .12) / .0015) ** 2));
      const lifeX = -.031 + ((y + .047) / .024) ** 2 * .011;
      const life = Math.exp(-(((x - lifeX) / .0015) ** 2)) * Math.exp(-(((y + .047) / .031) ** 6));
      point.z += palmar * palmar * (.00115 * transverse + .00085 * distal + .0008 * life);
    });
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
      const fingerSections = [
        fingerRing(basePoint.clone().add(v(0, .009, 0)), spec.radius * .93, mix(h, a, .35)),
        fingerRing(basePoint.clone().add(v(0, .001, 0)), spec.radius, mix(h, a, .9)),
        fingerRing(basePoint.clone().lerp(joint1, .45), spec.radius * .88, rigid(a)),
        fingerRing(joint1.clone().add(v(0, .006, 0)), spec.radius * .91, mix(a, b, .2)),
        fingerRing(joint1.clone().add(v(0, .0018, 0)), spec.radius * .90, mix(a, b, .43)),
        fingerRing(joint1, spec.radius * .90, mix(a, b, .5)),
        fingerRing(joint1.clone().add(v(0, -.0018, 0)), spec.radius * .89, mix(a, b, .57)),
        fingerRing(joint1.clone().lerp(joint2, .45), spec.radius * .78, rigid(b)),
        fingerRing(joint2.clone().add(v(0, .0015, 0)), spec.radius * .79, mix(b, c, .42)),
        fingerRing(joint2, spec.radius * .785, mix(b, c, .5)),
        fingerRing(joint2.clone().add(v(0, -.0015, 0)), spec.radius * .78, mix(b, c, .58)),
        fingerRing(joint2.clone().lerp(tipPoint, .5), spec.radius * .78, rigid(c)),
        fingerRing(tipPoint.clone().add(v(0, .003, 0)), spec.radius * .61, rigid(c)),
        fingerRing(tipPoint, spec.radius * .23, rigid(c)),
      ];
      // Sample a continuous profile rather than exposing sparse phalange rings.
      // Each interval retains its original bone blend and longitudinal silhouette.
      const fingerRings: Ring[] = [];
      for (let j = 0; j < fingerSections.length - 1; j++) {
        const from = fingerSections[j], to = fingerSections[j + 1];
        for (let k = 0; k < 3; k++) {
          const t = k / 3;
          const radius=(key:'a'|'b')=>{
            const slope=(index:number)=>{
              if(index===0)return (fingerSections[1][key]-fingerSections[0][key])/(fingerSections[1].p.y-fingerSections[0].p.y);
              if(index===fingerSections.length-1)return (fingerSections[index][key]-fingerSections[index-1][key])/(fingerSections[index].p.y-fingerSections[index-1].p.y);
              const left=(fingerSections[index][key]-fingerSections[index-1][key])/(fingerSections[index].p.y-fingerSections[index-1].p.y),right=(fingerSections[index+1][key]-fingerSections[index][key])/(fingerSections[index+1].p.y-fingerSections[index].p.y);
              return left*right<=0?0:2*left*right/(left+right);
            };
            const dy=to.p.y-from.p.y,t2=t*t,t3=t2*t;
            return clamp((2*t3-3*t2+1)*from[key]+(t3-2*t2+t)*dy*slope(j)+(-2*t3+3*t2)*to[key]+(t3-t2)*dy*slope(j+1),Math.min(from[key],to[key]),Math.max(from[key],to[key]));
          };
          const contributions = new Map<number, number>();
          for (const [ring, factor] of [[from, 1 - t], [to, t]] as const) {
            contributions.set(ring.weights[0], (contributions.get(ring.weights[0]) ?? 0) + ring.weights[2] * factor);
            contributions.set(ring.weights[1], (contributions.get(ring.weights[1]) ?? 0) + ring.weights[3] * factor);
          }
          const sorted = [...contributions].sort((a, b) => b[1] - a[1]);
          const first = sorted[0], second = sorted[1] ?? [first[0], 0], total = first[1] + second[1];
          fingerRings.push({ p: from.p.clone().lerp(to.p, t),
            a:radius('a'),b:radius('b'),
            weights: [first[0], second[0], first[1] / total, second[1] / total] });
        }
      }
      fingerRings.push(fingerSections[fingerSections.length - 1]);
      s.loft(fingerRings, SKIN, 24, v(1, 0, 0), v(0, 0, 1), (point, _r, theta) => {
        // Broad volar pulp and flatter dorsal phalanges, with a tapered pad below
        // the nail free edge. This breaks the cylindrical sausage silhouette.
        const dorsal = Math.max(0, Math.sin(theta)), palmar = Math.max(0, -Math.sin(theta));
        const y = point.y;
        const jointField = (joint: THREE.Vector3, width: number) => Math.exp(-(((y - joint.y) / width) ** 2));
        const distal = clamp((joint2.y - y) / (joint2.y - tipPoint.y), 0, 1);
        // Broad pads merge gradually into the phalanx, with narrow flexion folds
        // confined to the volar surface instead of a circumferential bead.
        point.z -= dorsal * dorsal * .0011;
        point.z += dorsal * dorsal * (.0008 * jointField(joint1, .0045) + .0006 * jointField(joint2, .003));
        point.z += palmar ** 4 * (.00055 * jointField(joint1, .0009) + .0004 * jointField(joint2, .0008));
        const pulp = Math.sin(Math.PI * distal * .88) ** 2;
        point.z -= palmar * palmar * .0022 * pulp;
        point.x += Math.cos(theta) * spec.radius * .07 * palmar * pulp;
      });
      this.sculptNail(s, joint2, tipPoint, spec.radius, rigid(c));
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
    this.sculptNail(s, thumbDistal, thumbEnd, .0113, rigid(c), .0017);
    // Webbing under the four finger roots keeps their attachment fleshy and volumetric.
    for (let i = 0; i < specs.length - 1; i++) {
      const x = (specs[i].x + specs[i + 1].x) * .5;
      s.ellipsoid(handPoint(x, -.097, 0), v(.007, .009, .010), weight, SKIN, 14, 8);
    }
    fingers.push({ base, middle, tip, thumb: true });
    return fingers;
  }

  /** A closed 0.5 mm keratin shell follows the nail bed's longitudinal taper and
   * transverse arch. Its proximal edge sits inside the skin; pulp extends beyond it.
   * Unlike a flattened ellipsoid, the free edge never appears as a white disk cap. */
  private sculptNail(s: Sculpt, joint: THREE.Vector3, end: THREE.Vector3, radius: number, weights: SkinWeight, lift = 0): void {
    const sections = [
      [.18, .24, .70], [.24, .47, .70], [.35, .56, .69],
      [.52, .56, .65], [.67, .53, .59], [.78, .43, .51], [.82, .25, .47],
    ];
    const rings = sections.map(([t, width, elevation]) => ({
      p: joint.clone().lerp(end, t).add(v(0, 0, radius * elevation - .0002 + lift)),
      a: radius * width, b: .00026, weights,
    }));
    s.loft(rings, NAIL, 16, v(1, 0, 0), v(0, 0, 1), (point, _r, theta) => {
      point.z -= Math.cos(theta) ** 2 * radius * .13;
    });
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

  private fishingBlend=0;
  private surfBlend=0;
  /** Third-person only. Off (default), every bone matches the first-person pose exactly. */
  relaxedStance=false;
  update(state: AdventureState, camera: THREE.PerspectiveCamera, delta: number, time: number): void {
    if (this.disposed || ![state.yaw, state.pitch, state.speed, time, camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite)) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, .08);
    this.fishingBlend+=((state.activity==='fishing'?1:0)-this.fishingBlend)*(1-Math.exp(-dt*8));
    this.surfBlend+=((state.activity==='surf'?1:0)-this.surfBlend)*(1-Math.exp(-dt*7));
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
    this.skin.setWetness(this.wet);
    if (this.makehuman) { this.makehuman.skin.roughness = .52 - this.wet * .26; (this.makehuman.skin.userData.wear as { suitRoughness: { value: number } }).suitRoughness.value = .89 - this.wet * .28; }
    this.materials[SUIT].roughness = .89 - this.wet * .28; this.materials[PANEL].roughness = .91 - this.wet * .24;
    const leanTarget = swim * 1.03 + dive * 1.16;
    this.lean = this.initialized ? this.lean + clamp(leanTarget - this.lean, -dt * 1.8, dt * 1.8) : leanTarget;
    const lean = this.lean;
    // The seated body shares the vessel frame. Limiting only the body to .13
    // while the seat and wheel continue tilting separates their contact points.
    const boatPitch = finite(state.boatPitch) * helm, boatRoll = finite(state.boatRoll) * helm;
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
    // Relaxed standing (idle only): weight settles on the left leg with a slow drift, the
    // free hip drops and the chest counter-tilts, instead of a symmetric mannequin stance.
    // Fishing and surfing own the hands and stance; seen from the eye nothing changes.
    const relax = this.relaxedStance ? (1 - this.fishingBlend) * (1 - this.surfBlend) : 0;
    const settle = relax * idle * (1 - water) * (.85 + .15 * Math.sin(time * .37));
    this.pelvis.position.x = .022 * settle;
    this.pelvis.rotation.set(gait * moving * .016, gait * moving * .016 + .05 * settle, gait * moving * .014 + .045 * settle);
    this.spine.rotation.set(clamp(state.pitch, -.5, .5) * .08 - run * .035, 0, -gait * moving * .014);
    this.chest.rotation.set(breath + gait * moving * .012, -gait * moving * .018 - .03 * settle, -.05 * settle);
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
      // Seated reaching protracts the shoulders; segment lengths stay anatomical.
      this.arms[i].upper.position.copy(this.arms[i].shoulderRest!);
      this.arms[i].upper.position.z-=.05*helm*(1-this.fishingBlend);
      const swing = Math.sin(phase), stroke = Math.sin(phase * .65), recovery = Math.cos(phase * .65);
      // Target positions are anatomical metres in body space, never a camera overlay.
      this.target.set(side * ((.266 - .044 * relax) * idle + .27 * walk + .265 * run + (.33 + .052 * stroke) * water + .211 * helm + .22 * climb),
        (.843 + .032 * relax) * idle + (.851 + .028 * swing) * walk + (1.007 + .085 * swing) * run
          + (1.43 + .22 * recovery) * water + 1.234 * helm + (1.49 + .08 * side * Math.sin(climbPhase)) * climb,
        (-.052 - .046 * relax) * idle + (-.055 - .17 * swing) * walk + (-.185 - .15 * swing) * run
          + (-.36 - .10 * stroke) * water - .435 * helm - .335 * climb);
      if (helm > .001) {
        // Solve the wrist from the actual wheel and palmar contact, then move
        // both position and orientation with the vessel's complete raw pose.
        helmHandPose(side,this.helmWorld,this.helmOrientation);
        this.helmWorld.applyQuaternion(this.boatQuaternion).add(state.boatPosition);
        this.helmWorld.applyMatrix4(this.inverseGroup);
        this.target.addScaledVector(this.helmWorld.clone().sub(v(side * .211, 1.234, -.435)), helm);
      }
      // A small balancing response to acceleration remains coherent with the shoulder.
      const velocity = state.velocity;
      if (velocity) this.target.z -= clamp(finite(velocity.y), -3, 3) * .009 * moving;
      if(this.fishingBlend>.001){
        const grip=new THREE.Vector3(i===0?.08:.24,i===0?-.36:-.44,i===0?-.58:-.38).applyMatrix4(camera.matrixWorld).applyMatrix4(this.inverseGroup);
        this.target.lerp(grip,this.fishingBlend);
      }
      if(this.surfBlend>.001)this.target.lerp(v(side*.46,1.11,-.18),this.surfBlend);
      this.poseArm(this.arms[i], side, this.target);
      const wrist = this.arms[i].end;
      this.poseEuler.set(water * (.17 + stroke * .13) + helm * 1.19 + climb * .1,
        side * (.99 * idle + .87 * walk + .67 * run + .18 * water + .68 * helm + .18 * climb),
        side * (water * (Math.PI - stroke * .20) + climb * 2.5 + helm * .22), 'XYZ');
      this.targetQuaternion.setFromEuler(this.poseEuler);
      if(helm>.001){
        this.helmBodyOrientation.copy(this.rootQuaternion).invert().multiply(this.boatQuaternion).multiply(this.helmOrientation);
        this.targetQuaternion.slerp(this.helmBodyOrientation,helm);
      }
      if(this.fishingBlend>.001){const grip=new THREE.Quaternion().copy(this.rootQuaternion).invert().multiply(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(1.18,side*.35,side*.16)));this.targetQuaternion.slerp(grip,this.fishingBlend);}
      this.orientAbsolute(wrist,this.targetQuaternion);
      const curl = ((.20 + .22 * relax) * idle + .24 * walk + .43 * run + (.08 + .12 * Math.max(0, -stroke)) * water + .92 * helm + .7 * climb)*(1-this.fishingBlend)+.82*this.fishingBlend;
      const fingers = this.arms[i].fingers!;
      for (let f = 0; f < fingers.length; f++) {
        const finger = fingers[f], difference = f * .022;
        if (finger.thumb) {
          finger.base.rotation.set(THREE.MathUtils.lerp(curl*.29,.1,helm*(1-this.fishingBlend)),
            -side*THREE.MathUtils.lerp(curl*.22,.2,helm*(1-this.fishingBlend)),
            -side*THREE.MathUtils.lerp(curl*.26,-.2,helm*(1-this.fishingBlend)));
          finger.middle.rotation.set(curl * .32, 0, -side * curl * .1); finger.tip.rotation.set(curl * .45, 0, 0);
        } else {
          const contact=helm*(1-this.fishingBlend),grip=THREE.MathUtils.lerp(curl,HELM_FINGER_CURL[f],contact);
          finger.base.rotation.set(grip+difference*(1-contact),0,side*(f-1.5)*.012*water);
          finger.middle.rotation.set(grip*1.05+difference*(1-contact),0,0);finger.tip.rotation.set(grip*.65,0,0);
        }
      }
    }
    for (let i = 0; i < this.legs.length; i++) {
      const phase = this.phase + (i === 0 ? 0 : Math.PI), step = Math.sin(phase), leg = this.legs[i];
      const flutter = Math.sin(time * 4.2 + i * Math.PI), airborne = state.grounded === false ? moving : 0;
      leg.upper.rotation.set(step * (.31 * walk + .49 * run) + flutter * water * .13 + airborne * .12 + climb * (i === 0 ? .53 : .21) + helm * 1.087,
        0, (i === 0 ? -.015 : .015) * (1 - water));
      leg.lower.rotation.set(-Math.max(0, -step) * (.52 * walk + .88 * run) - .12 * water - .36 * airborne - climb * .67 - helm * 1.087, 0, 0);
      leg.end.rotation.set(step * .10 * moving + water * .22 + climb * .12, -(i === 0 ? -1 : 1) * .14 * idle * relax, 0);
      if (i === 1) { leg.upper.rotation.x += .07 * settle; leg.upper.rotation.z += .035 * settle; leg.lower.rotation.x -= .15 * settle; leg.end.rotation.x += .07 * settle; }
      if(this.surfBlend>.001){leg.upper.rotation.x+=this.surfBlend*(i===0?.24:-.12);leg.upper.rotation.z+=this.surfBlend*(i===0?-.15:.15);leg.lower.rotation.x-=this.surfBlend*.28;}
    }
    if (this.mocap) this.applyMocap(walk, run, water, lean, this.poseEuler.set(state.pitch + lean - boatPitch, clamp(bodyYaw - state.yaw, -1.4, 1.4), -boatRoll, 'XYZ'));
    this.anchor(camera);
    if (this.mocap) this.plantMocapFeet(walk, run, state, camera);
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
    if (this.makehuman) {
      for (const mesh of this.makehuman.meshes) mesh.geometry.dispose();
      this.makehuman.materials.forEach(m => m.dispose()); this.makehuman.textures.forEach(t => t.dispose());
      this.makehuman.anatomy.dispose();
      // The gear view shares the sculpt's attributes, which the anatomy dispose already released.
      this.mesh.geometry.setIndex(null);
    }
    this.mesh.geometry.dispose(); this.mesh.skeleton.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.group.clear();
  }
}

