import * as THREE from 'three';
import type { GroundSampler } from './contracts';
import { makeInstances, ModelResources, randomSeed, rockGeometry, standard, surfaceTexture, updateInstanceBounds } from './models/procedural.ts';
import { encrustingGeometry, finGeometry, finMaterial, fishEyes, fishGeometry, fishMaterial, seagrassGeometry, seagrassMaterial, tailGeometry } from './models/marine.ts';
import { ScannedRockField, type ScannedRockLibrary, type ScannedRockVariant } from './scanned-rocks.ts';
import { BubbleTrail } from './marine-bubbles.ts';

interface Fish {
  species: number; index: number; eyeIndex: number; center: THREE.Vector3;
  radius: number; aspect: number; phase: number; rate: number; size: number; depthPhase: number;
}

/** Conform every coating vertex to the actual scan, rather than floating disks. */
function rockCoatingGeometry(resources: ModelResources, variant: ScannedRockVariant, seed: number): { geometry: THREE.BufferGeometry; patches: number } | null {
  const random = randomSeed(seed), source = new THREE.Mesh(variant.geometry, variant.material);
  source.updateMatrixWorld(true); variant.geometry.computeBoundingBox();
  const bounds = variant.geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3());
  const ray = new THREE.Raycaster(), vertices: number[] = [], normals: number[] = [], colors: number[] = [], uv: number[] = [];
  const positions = variant.geometry.getAttribute('position'), sourceNormals = variant.geometry.getAttribute('normal');
  const sourceIndices = variant.geometry.index;
  const sourceCount = sourceIndices?.count ?? positions.count;
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, -1, 0), delta = new THREE.Vector3();
  const point = new THREE.Vector3(), surfaceNormal = new THREE.Vector3(), centroid = new THREE.Vector3(), meanNormal = new THREE.Vector3();
  const palette = [new THREE.Color('#786440'), new THREE.Color('#675945'), new THREE.Color('#72576b'), new THREE.Color('#806669')];
  const occupied: { point: THREE.Vector3; radius: number }[] = [];
  let patches = 0;
  for (let attempt = 0; attempt < 48 && patches < 9; attempt++) {
    origin.set(bounds.min.x + size.x * (0.14 + random() * 0.72), bounds.max.y + 0.35,
      bounds.min.z + size.z * (0.14 + random() * 0.72));
    ray.set(origin, direction); ray.far = size.y + 0.8;
    const hit = ray.intersectObject(source, false)[0];
    if (!hit?.face) continue;
    const normal = (hit.normal ?? hit.face.normal).clone().normalize();
    if (normal.y < 0.17) continue;
    const radius = Math.min(size.x, size.z) * (0.043 + random() * 0.058), aspect = 0.55 + random() * 0.43;
    if (occupied.some((patch) => patch.point.distanceTo(hit.point) < (patch.radius + radius) * 0.76)) continue;
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const phase = random() * Math.PI * 2, cosine = Math.cos(phase), sine = Math.sin(phase);
    const patchVertices: number[] = [], patchNormals: number[] = [], patchUV: number[] = [];
    for (let i = 0; i < sourceCount; i += 3) {
      const ids = [sourceIndices?.getX(i) ?? i, sourceIndices?.getX(i + 1) ?? i + 1, sourceIndices?.getX(i + 2) ?? i + 2];
      centroid.set(0, 0, 0); meanNormal.set(0, 0, 0);
      for (const id of ids) { centroid.add(point.fromBufferAttribute(positions, id)); meanNormal.add(surfaceNormal.fromBufferAttribute(sourceNormals, id)); }
      centroid.multiplyScalar(1 / 3); meanNormal.normalize(); delta.copy(centroid).sub(hit.point);
      const x = delta.dot(tangent), y = delta.dot(bitangent);
      const px = (x * cosine + y * sine) / radius, py = (-x * sine + y * cosine) / (radius * aspect);
      if (Math.hypot(px, py) > 1.12 || Math.abs(delta.dot(normal)) > radius * 0.48 || meanNormal.dot(normal) < 0.74) continue;
      for (const id of ids) {
        point.fromBufferAttribute(positions, id); surfaceNormal.fromBufferAttribute(sourceNormals, id).normalize();
        delta.copy(point).sub(hit.point);
        const tx = delta.dot(tangent), ty = delta.dot(bitangent);
        patchUV.push(0.5 + (tx * cosine + ty * sine) / radius * 0.48, 0.5 + (-tx * sine + ty * cosine) / (radius * aspect) * 0.48);
        point.addScaledVector(surfaceNormal, 0.0025);
        patchVertices.push(...point.toArray()); patchNormals.push(...surfaceNormal.toArray());
      }
    }
    if (patchVertices.length < 27 || vertices.length / 9 + patchVertices.length / 9 > 1200) continue;
    vertices.push(...patchVertices); normals.push(...patchNormals); uv.push(...patchUV);
    const color = palette[patches % palette.length];
    for (let i = 0; i < patchVertices.length; i += 3) {
      const shade = 0.91 + Math.sin(patchVertices[i] * 53 + patchVertices[i + 1] * 31 + patchVertices[i + 2] * 61) * 0.055;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
    occupied.push({ point: hit.point.clone(), radius }); patches++;
  }
  if (!patches) return null;
  const geometry = resources.geometry(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingSphere(); geometry.userData.attachment = 'actual source scan triangles, 2.5mm normal offset and small organic masks';
  return { geometry, patches };
}
function coatingMask(resources: ModelResources): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x / size - 0.5) * 2, py = (y / size - 0.5) * 2, angle = Math.atan2(py, px);
    const edge = 0.84 + Math.sin(angle * 7) * 0.06 + Math.sin(angle * 13) * 0.035;
    const alpha = 1 - THREE.MathUtils.smoothstep(Math.hypot(px, py), edge - 0.15, edge);
    const grain = 0.77 + Math.sin(x * 1.9 + Math.sin(y * 0.47)) * Math.sin(y * 1.67) * 0.23;
    const value = Math.round(alpha * grain * 255); pixels.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = resources.texture(new THREE.DataTexture(pixels, size, size));
  texture.colorSpace = THREE.NoColorSpace; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
}

/** Inferred, artist-authored diving habitat; these organisms are not a local biological survey. */
export class MarineLife {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  readonly rockLibrary: ScannedRockLibrary;
  private readonly resources = new ModelResources();
  private readonly instances: THREE.InstancedMesh[] = [];
  private readonly fish: Fish[] = [];
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly fins: THREE.InstancedMesh[] = [];
  private readonly tails: THREE.InstancedMesh[] = [];
  private readonly scannedRocks: ScannedRockField;
  private readonly rockLods: { mesh: THREE.InstancedMesh; matrices: THREE.Matrix4[] }[] = [];
  private readonly rockMatrices: THREE.Matrix4[] = [];
  private readonly detailedRocks = new Set<THREE.Matrix4>();
  private readonly coatings: { mesh: THREE.InstancedMesh; matrices: THREE.Matrix4[]; patches: number }[] = [];
  private readonly animationTime: THREE.IUniform<number> = { value: 0 };
  private readonly eyes: THREE.InstancedMesh;
  private readonly dust: THREE.Points;
  private readonly bubbleTrail: BubbleTrail;
  private readonly random = randomSeed(0x554e4445);
  private readonly particleSeeds: THREE.Vector3[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly tailMatrix = new THREE.Matrix4();
  private readonly localTail = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly swimmingEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private disposed = false;

  constructor(private readonly ground: GroundSampler) {
    this.group.name = 'authored Tomari diving habitat';
    this.group.userData.provenance = 'Inferred seabed dressing and wrasse/damselfish/silver-shoal inspired fish, not surveyed fauna or coral.';
    this.scannedRocks = this.populateSeabed(); this.rockLibrary = this.scannedRocks.library;
    this.ready = this.scannedRocks.ready.then(async () => {
      if (this.disposed) return;
      try { this.populateRockGrowth(await this.rockLibrary.ready); } catch { /* The scan field already records fallback status. */ }
    });
    this.populateFish();
    const membrane = finMaterial(this.resources, this.animationTime);
    const eyeMaterial = this.resources.material(new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true,
      roughness: 0.16, metalness: 0.03, clearcoat: 0.85, clearcoatRoughness: 0.08 }));
    eyeMaterial.name = 'paired fish iris / pupil / wet cornea'; eyeMaterial.userData.photorealRole = 'fish eyes';
    for (let species = 0; species < 3; species++) {
      const count = this.fish.filter((fish) => fish.species === species).length;
      const body = makeInstances(fishGeometry(this.resources, species), fishMaterial(this.resources, species), count, ['wrasse inspired school', 'small coastal damselfish inspired school', 'silver coastal shoal'][species]);
      const fin = makeInstances(finGeometry(this.resources, species), membrane, count, 'thin dorsal / anal / pectoral fins');
      const tail = makeInstances(tailGeometry(this.resources, species), membrane, count, 'articulated caudal fin with rays');
      body.castShadow = tail.castShadow = fin.castShadow = false;
      for (const mesh of [body, fin, tail]) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.bodies.push(body); this.fins.push(fin); this.tails.push(tail); this.instances.push(body, fin, tail); this.group.add(body, fin, tail);
    }
    this.eyes = makeInstances(fishEyes(this.resources), eyeMaterial, this.fish.length, 'paired fish eyes');
    this.eyes.castShadow = false; this.eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.instances.push(this.eyes); this.group.add(this.eyes);

    const dustGeometry = this.resources.geometry(new THREE.BufferGeometry());
    const dustPositions = new Float32Array(380 * 3);
    for (let i = 0; i < 380; i++) this.particleSeeds.push(new THREE.Vector3((this.random() - 0.5) * 22, (this.random() - 0.5) * 15, (this.random() - 0.5) * 22));
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const dustMaterial = this.resources.material(new THREE.PointsMaterial({ color: '#d6e5df', size: 0.029, transparent: true,
      opacity: 0.19, depthWrite: false, sizeAttenuation: true }));
    this.dust = new THREE.Points(dustGeometry, dustMaterial); this.dust.name = 'subtle suspended water particles'; this.dust.frustumCulled = false; this.dust.visible = false; this.group.add(this.dust);
    this.bubbleTrail = new BubbleTrail(this.resources); this.group.add(this.bubbleTrail.mesh);
    this.update(0, new THREE.Vector3(-36, 3, 27), false);
  }

  private addInstances(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], name: string): THREE.InstancedMesh | null {
    if (!matrices.length) return null;
    const mesh = makeInstances(geometry, material, matrices.length, name); mesh.castShadow = false;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix)); updateInstanceBounds(mesh); this.instances.push(mesh); this.group.add(mesh);
    return mesh;
  }

  private populateSeabed(): ScannedRockField {
    const stone = standard(this.resources, '#babdb3', 0.99); stone.vertexColors = true;
    stone.map = surfaceTexture(this.resources, '#cac8bb', 'stone', 299);
    const grass = seagrassMaterial(this.resources, this.animationTime);
    const coral = standard(this.resources, '#85796f', 0.91);
    const rocks: THREE.Matrix4[][] = [[], [], []], grassMatrices: THREE.Matrix4[] = [], kelpMatrices: THREE.Matrix4[] = [], coralMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 640; i++) {
      const x = -150 + this.random() * 220, z = -120 + this.random() * 130;
      const height = this.ground.heightAt(x, z);
      if (!Number.isFinite(height) || height > -1.1 || height < -42) continue;
      const yaw = this.random() * Math.PI * 2;
      const variant = Math.floor(this.random() * 3);
      if (i % 2 === 0) {
        const size = Math.min(-height * 0.4, 0.18 + this.random() * 1.2);
        this.position.set(x, height - size * 0.1, z); this.rotation.setFromAxisAngle(this.yAxis, yaw); this.scale.set(size, size * (0.56 + this.random() * 0.35), size * (0.85 + this.random() * 0.4));
        rocks[variant].push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
      }
      if (height > -23 && i % 3 !== 0) {
        this.position.set(x + this.random() * 0.5, height - 0.03, z); this.rotation.setFromAxisAngle(this.yAxis, yaw);
        const size = 0.5 + this.random() * 0.9; this.scale.setScalar(size);
        (i % 5 === 0 ? kelpMatrices : grassMatrices).push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
      }
      if (height > -20 && i % 13 === 0) {
        this.position.set(x, height + 0.045, z); this.scale.setScalar(0.65 + this.random());
        coralMatrices.push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
      }
    }
    // Small, irregular shelf clusters give the diver close material and silhouette cues.
    for (const [anchorX, anchorZ] of [[-31, -27], [-54, -43], [-13, -51], [-72, -34], [12, -62]]) {
      for (let i = 0; i < 24; i++) {
        const angle = this.random() * Math.PI * 2, spread = Math.sqrt(this.random()) * 10;
        const x = anchorX + Math.cos(angle) * spread, z = anchorZ + Math.sin(angle) * spread * 0.64;
        const height = this.ground.heightAt(x, z);
        if (!Number.isFinite(height) || height > -1.1 || height < -28) continue;
        const size = 0.23 + Math.pow(this.random(), 1.6) * 1.85;
        this.position.set(x, height - size * 0.12, z); this.rotation.setFromAxisAngle(this.yAxis, angle);
        this.scale.set(size, size * (0.55 + this.random() * 0.34), size * (0.78 + this.random() * 0.45));
        rocks[i % 3].push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
        if (i % 3 !== 0) {
          this.position.set(x + size * 0.6, height - 0.04, z); this.scale.setScalar(0.63 + this.random() * 0.44);
          grassMatrices.push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
        }
      }
    }
    for (let variant = 0; variant < 3; variant++) {
      const geometry = rockGeometry(this.resources, variant + 633, 5); geometry.translate(0, 0.68, 0);
      const mesh = this.addInstances(geometry, stone, rocks[variant], 'distant rounded seabed stones');
      if (mesh) { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.rockLods.push({ mesh, matrices: rocks[variant] }); }
    }
    this.addInstances(seagrassGeometry(this.resources, 41), grass, grassMatrices, 'modest inferred seagrass patches');
    this.addInstances(seagrassGeometry(this.resources, 83, true), grass, kelpMatrices, 'brown coastal algae fronds');
    this.addInstances(encrustingGeometry(this.resources, 20), coral, coralMatrices, 'muted inferred encrusting organisms');
    this.rockMatrices.push(...rocks.flat());
    const lowAlgaeMatrices: THREE.Matrix4[] = [], edgeRandom = randomSeed(0x45444745), edge = new THREE.Vector3();
    for (const matrix of this.rockMatrices) for (let clump = 0; clump < 2; clump++) {
      const angle = edgeRandom() * Math.PI * 2;
      edge.set(Math.cos(angle) * (0.88 + edgeRandom() * 0.24), 0, Math.sin(angle) * (0.78 + edgeRandom() * 0.26)).applyMatrix4(matrix);
      const height = this.ground.heightAt(edge.x, edge.z);
      if (!Number.isFinite(height) || height > -0.65 || height < -24) continue;
      this.position.set(edge.x, height - 0.018, edge.z); this.rotation.setFromAxisAngle(this.yAxis, angle);
      const width = 0.24 + edgeRandom() * 0.29; this.scale.set(width, 0.13 + edgeRandom() * 0.17, width);
      lowAlgaeMatrices.push(new THREE.Matrix4().compose(this.position, this.rotation, this.scale));
    }
    const lowAlgae = seagrassMaterial(this.resources, this.animationTime); lowAlgae.color.set('#a69b81'); lowAlgae.forceSinglePass = true;
    this.addInstances(seagrassGeometry(this.resources, 773, true), lowAlgae, lowAlgaeMatrices, 'short brown algae at irregular rock edges');
    this.group.userData.habitatCounts = { rocks: this.rockMatrices.length, seagrass: grassMatrices.length, algae: kelpMatrices.length,
      lowAlgae: lowAlgaeMatrices.length, encrusting: coralMatrices.length, attachedCoatingPatches: 0 };
    return new ScannedRockField(this.group, this.rockMatrices);
  }

  private populateRockGrowth(variants: readonly ScannedRockVariant[]): void {
    if (this.disposed || !variants.length) return;
    const boulders = variants.filter((variant) => variant.kind === 'boulder');
    const material = standard(this.resources, '#ffffff', 0.96); material.vertexColors = true;
    material.name = 'muted brown / purple thin rock-surface encrustation'; material.alphaMap = coatingMask(this.resources); material.alphaTest = 0.16;
    material.map = surfaceTexture(this.resources, '#cabfa9', 'stone', 850); material.bumpMap = material.map; material.bumpScale = 0.0012;
    material.userData.photorealRole = 'inferred rock-surface coating, not surveyed Tomari coral';
    boulders.forEach((variant, index) => {
      const coating = rockCoatingGeometry(this.resources, variant, 187 + index * 89); if (!coating) return;
      const matrices = this.rockMatrices.filter((_matrix, placement) => placement % boulders.length === index);
      const mesh = this.addInstances(coating.geometry, material, matrices, `attached brown / purple coating on ${variant.id}`); if (!mesh) return;
      mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.coatings.push({ mesh, matrices, patches: coating.patches });
    });
    this.group.userData.rockGrowth = { status: 'attached to scans', patchesPerVariant: this.coatings.map((coating) => coating.patches),
      maxDraws: this.coatings.length, maxCoatedRocks: 32, placement: 'ray-projected thin organic patches' };
    this.updateCoatingInstances();
  }

  private updateCoatingInstances(): void {
    let patches = 0;
    for (const coating of this.coatings) {
      let index = 0;
      for (const matrix of coating.matrices) if (this.detailedRocks.has(matrix)) coating.mesh.setMatrixAt(index++, matrix);
      coating.mesh.count = index; patches += index * coating.patches; updateInstanceBounds(coating.mesh);
    }
    this.group.userData.habitatCounts.attachedCoatingPatches = patches;
  }

  private findWaterCenter(x: number, z: number): THREE.Vector3 | null {
    for (let radius = 0; radius <= 30; radius += 3) for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4;
      const candidateX = x + Math.cos(angle) * radius, candidateZ = z + Math.sin(angle) * radius;
      const height = this.ground.heightAt(candidateX, candidateZ);
      if (height < -1 && height > -40 && Number.isFinite(height)) return new THREE.Vector3(candidateX, Math.min(-0.38, Math.max(height + 0.38, height * 0.64)), candidateZ);
    }
    return null;
  }

  private populateFish(): void {
    const schools = [
      { x: -36, z: -23, species: 1, count: 34 }, { x: -85, z: -45, species: 0, count: 35 },
      { x: 10, z: -56, species: 2, count: 52 }, { x: -119, z: -85, species: 2, count: 48 },
      { x: -43, z: -97, species: 0, count: 33 }, { x: 34, z: -103, species: 1, count: 31 },
      { x: -142, z: -127, species: 1, count: 22 },
    ];
    const counts = [0, 0, 0];
    for (const school of schools) {
      const center = this.findWaterCenter(school.x, school.z); if (!center) continue;
      const rate = school.species === 2 ? 0.13 : 0.075;
      for (let i = 0; i < school.count; i++) {
        this.fish.push({ species: school.species, index: counts[school.species]++, eyeIndex: this.fish.length, center,
          radius: 2.8 + this.random() * 6.3, aspect: 0.38 + this.random() * 0.27, phase: this.random() * 1.3 + school.species * 2,
          rate: rate + this.random() * 0.0012, size: (school.species === 0 ? 0.35 : school.species === 1 ? 0.26 : 0.3) + this.random() * 0.21,
          depthPhase: this.random() * Math.PI * 2 });
      }
    }
    this.group.userData.fishCounts = counts;
  }

  update(time: number, cameraPosition: THREE.Vector3, underwater: boolean): void {
    if (this.disposed) return;
    this.animationTime.value = time;
    const detailed = this.scannedRocks.update(cameraPosition, underwater || cameraPosition.y < 1.2);
    if (detailed) {
      this.detailedRocks.clear(); detailed.forEach((matrix) => this.detailedRocks.add(matrix));
      for (const { mesh, matrices } of this.rockLods) {
        let index = 0;
        for (const matrix of matrices) if (!detailed.has(matrix)) mesh.setMatrixAt(index++, matrix);
        mesh.count = index; updateInstanceBounds(mesh);
      }
      this.updateCoatingInstances();
    }
    for (const fish of this.fish) {
      const phase = time * fish.rate + fish.phase;
      const meander = Math.sin(time * 0.19 + fish.depthPhase) * 0.19;
      let x = fish.center.x + Math.cos(phase) * fish.radius + meander;
      let z = fish.center.z + Math.sin(phase) * fish.radius * fish.aspect + Math.sin(time * 0.13 + fish.depthPhase) * 0.15;
      let bottom = this.ground.heightAt(x, z);
      if (bottom > -0.65 || !Number.isFinite(bottom)) { x = fish.center.x; z = fish.center.z; bottom = this.ground.heightAt(x, z); }
      const y = Math.min(-0.3, Math.max(bottom + fish.size * 0.28 + 0.09, fish.center.y + Math.sin(time * 0.6 + fish.depthPhase) * 0.24));
      this.position.set(x, y, z);
      const yaw = -Math.atan2(Math.cos(phase) * fish.aspect, -Math.sin(phase));
      const tailBeat = Math.sin(time * (6.3 + fish.rate * 10) + fish.depthPhase);
      this.swimmingEuler.set(Math.sin(phase + fish.depthPhase) * 0.035, yaw + tailBeat * 0.011, Math.cos(time * 0.6 + fish.depthPhase) * 0.028);
      this.rotation.setFromEuler(this.swimmingEuler); this.scale.setScalar(fish.size);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.bodies[fish.species].setMatrixAt(fish.index, this.matrix); this.fins[fish.species].setMatrixAt(fish.index, this.matrix); this.eyes.setMatrixAt(fish.eyeIndex, this.matrix);
      this.localTail.makeRotationY(tailBeat * 0.23);
      this.localTail.setPosition(-0.444, 0, 0); this.tailMatrix.multiplyMatrices(this.matrix, this.localTail);
      this.tails[fish.species].setMatrixAt(fish.index, this.tailMatrix);
    }
    for (const mesh of [...this.bodies, ...this.fins, ...this.tails, this.eyes]) updateInstanceBounds(mesh);
    this.dust.visible = underwater; this.bubbleTrail.update(time, cameraPosition, underwater);
    if (!underwater) return;
    const particles = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particleSeeds.length; i++) {
      const seed = this.particleSeeds[i];
      particles.setXYZ(i, cameraPosition.x + seed.x + Math.sin(time * 0.11 + i) * 0.17,
        Math.min(-0.2, cameraPosition.y + seed.y + Math.sin(time * 0.07 + i) * 0.13), cameraPosition.z + seed.z);
    }
    particles.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.bubbleTrail.dispose(); this.scannedRocks.dispose(); this.instances.forEach((mesh) => mesh.dispose()); this.resources.dispose(); this.group.clear(); this.fish.length = 0;
  }
}
