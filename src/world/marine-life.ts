import * as THREE from 'three';
import type { GroundSampler } from './contracts';
import { makeInstances, ModelResources, randomSeed, rockGeometry, standard, surfaceTexture, updateInstanceBounds } from './models/procedural';
import { encrustingGeometry, fishEyes, fishGeometry, seagrassGeometry, tailGeometry } from './models/marine';

interface Fish {
  species: number; index: number; eyeIndex: number; center: THREE.Vector3;
  radius: number; aspect: number; phase: number; rate: number; size: number; depthPhase: number;
}

/** Inferred, artist-authored diving habitat; these organisms are not a local biological survey. */
export class MarineLife {
  readonly group = new THREE.Group();
  private readonly resources = new ModelResources();
  private readonly instances: THREE.InstancedMesh[] = [];
  private readonly fish: Fish[] = [];
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly tails: THREE.InstancedMesh[] = [];
  private readonly eyes: THREE.InstancedMesh;
  private readonly dust: THREE.Points;
  private readonly bubbles: THREE.InstancedMesh;
  private readonly random = randomSeed(0x554e4445);
  private readonly particleSeeds: THREE.Vector3[] = [];
  private readonly bubbleSeeds: { phase: number; angle: number; radius: number; size: number }[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly tailMatrix = new THREE.Matrix4();
  private readonly localTail = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private disposed = false;

  constructor(private readonly ground: GroundSampler) {
    this.group.name = 'authored Tomari diving habitat';
    this.group.userData.provenance = 'Inferred seabed dressing and wrasse/damselfish/silver-shoal inspired fish, not surveyed fauna or coral.';
    this.populateSeabed();
    this.populateFish();
    const fishMaterial = standard(this.resources, '#ffffff', 0.43, 0.1); fishMaterial.vertexColors = true; fishMaterial.side = THREE.DoubleSide;
    const eyeMaterial = standard(this.resources, '#111719', 0.18);
    for (let species = 0; species < 3; species++) {
      const count = this.fish.filter((fish) => fish.species === species).length;
      const body = makeInstances(fishGeometry(this.resources, species), fishMaterial, count, ['wrasse inspired school', 'small coastal damselfish inspired school', 'silver coastal shoal'][species]);
      const tail = makeInstances(tailGeometry(this.resources, species), fishMaterial, count, 'articulated swimming tail');
      body.castShadow = tail.castShadow = false;
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.bodies.push(body); this.tails.push(tail); this.instances.push(body, tail); this.group.add(body, tail);
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
    const bubbleMaterial = this.resources.material(new THREE.MeshPhysicalMaterial({ color: '#d5edf0', roughness: 0.05, metalness: 0.12,
      transparent: true, opacity: 0.19, clearcoat: 1, clearcoatRoughness: 0, depthWrite: false }));
    this.bubbles = makeInstances(this.resources.geometry(new THREE.SphereGeometry(1, 8, 6)), bubbleMaterial, 36, 'small rising scuba bubbles');
    this.bubbles.castShadow = this.bubbles.receiveShadow = false; this.bubbles.frustumCulled = false; this.bubbles.visible = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.instances.push(this.bubbles); this.group.add(this.bubbles);
    for (let i = 0; i < 36; i++) this.bubbleSeeds.push({ phase: this.random(), angle: this.random() * Math.PI * 2, radius: 0.45 + this.random() * 1.3, size: 0.018 + this.random() * 0.036 });
    this.update(0, new THREE.Vector3(-36, 3, 27), false);
  }

  private addInstances(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], name: string): void {
    if (!matrices.length) return;
    const mesh = makeInstances(geometry, material, matrices.length, name); mesh.castShadow = false;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix)); updateInstanceBounds(mesh); this.instances.push(mesh); this.group.add(mesh);
  }

  private populateSeabed(): void {
    const stone = standard(this.resources, '#babdb3', 0.99); stone.vertexColors = true;
    stone.map = surfaceTexture(this.resources, '#cac8bb', 'stone', 299);
    const grass = standard(this.resources, '#d3ddbd', 0.95); grass.vertexColors = true; grass.side = THREE.DoubleSide;
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
        this.position.set(x, height + size * 0.46, z); this.rotation.setFromAxisAngle(this.yAxis, yaw); this.scale.set(size, size * 0.85, size * 1.2);
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
    for (let variant = 0; variant < 3; variant++) this.addInstances(rockGeometry(this.resources, variant + 633), stone, rocks[variant], 'submerged eroded coast stones');
    this.addInstances(seagrassGeometry(this.resources, 41), grass, grassMatrices, 'modest inferred seagrass patches');
    this.addInstances(seagrassGeometry(this.resources, 83, true), grass, kelpMatrices, 'brown coastal algae fronds');
    this.addInstances(encrustingGeometry(this.resources, 20), coral, coralMatrices, 'muted inferred encrusting organisms');
    this.group.userData.habitatCounts = { rocks: rocks.flat().length, seagrass: grassMatrices.length, algae: kelpMatrices.length, encrusting: coralMatrices.length };
  }

  private findWaterCenter(x: number, z: number): THREE.Vector3 | null {
    for (let radius = 0; radius <= 18; radius += 3) for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4;
      const candidateX = x + Math.cos(angle) * radius, candidateZ = z + Math.sin(angle) * radius;
      const height = this.ground.heightAt(candidateX, candidateZ);
      if (height < -2 && height > -40 && Number.isFinite(height)) return new THREE.Vector3(candidateX, Math.max(height + 0.95, height * 0.42), candidateZ);
    }
    return null;
  }

  private populateFish(): void {
    const schools = [
      { x: -36, z: -23, species: 1, count: 34 }, { x: -85, z: -45, species: 0, count: 35 },
      { x: 10, z: -56, species: 2, count: 52 }, { x: -119, z: -85, species: 2, count: 48 },
      { x: -43, z: -97, species: 0, count: 33 }, { x: 34, z: -103, species: 1, count: 31 },
    ];
    const counts = [0, 0, 0];
    for (const school of schools) {
      const center = this.findWaterCenter(school.x, school.z); if (!center) continue;
      const rate = school.species === 2 ? 0.13 : 0.075;
      for (let i = 0; i < school.count; i++) {
        this.fish.push({ species: school.species, index: counts[school.species]++, eyeIndex: this.fish.length, center,
          radius: 2.8 + this.random() * 6.3, aspect: 0.38 + this.random() * 0.27, phase: this.random() * 1.3 + school.species * 2,
          rate: rate + this.random() * 0.012, size: (school.species === 0 ? 0.48 : school.species === 1 ? 0.34 : 0.33) + this.random() * 0.27,
          depthPhase: this.random() * Math.PI * 2 });
      }
    }
    this.group.userData.fishCounts = counts;
  }

  update(time: number, cameraPosition: THREE.Vector3, underwater: boolean): void {
    if (this.disposed) return;
    for (const fish of this.fish) {
      const phase = time * fish.rate + fish.phase;
      let x = fish.center.x + Math.cos(phase) * fish.radius;
      let z = fish.center.z + Math.sin(phase) * fish.radius * fish.aspect;
      let bottom = this.ground.heightAt(x, z);
      if (bottom > -1 || !Number.isFinite(bottom)) { x = fish.center.x; z = fish.center.z; bottom = this.ground.heightAt(x, z); }
      const y = Math.min(-0.55, Math.max(bottom + 0.55, fish.center.y + Math.sin(time * 0.6 + fish.depthPhase) * 0.55));
      this.position.set(x, y, z);
      const yaw = -Math.atan2(Math.cos(phase) * fish.aspect, -Math.sin(phase));
      this.rotation.setFromAxisAngle(this.yAxis, yaw); this.scale.setScalar(fish.size);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.bodies[fish.species].setMatrixAt(fish.index, this.matrix); this.eyes.setMatrixAt(fish.eyeIndex, this.matrix);
      this.localTail.makeRotationY(Math.sin(time * (6.3 + fish.rate * 10) + fish.depthPhase) * 0.35);
      this.localTail.setPosition(-0.415, 0, 0); this.tailMatrix.multiplyMatrices(this.matrix, this.localTail);
      this.tails[fish.species].setMatrixAt(fish.index, this.tailMatrix);
    }
    for (const mesh of [...this.bodies, ...this.tails, this.eyes]) updateInstanceBounds(mesh);
    this.dust.visible = this.bubbles.visible = underwater;
    if (!underwater) return;
    const particles = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particleSeeds.length; i++) {
      const seed = this.particleSeeds[i];
      particles.setXYZ(i, cameraPosition.x + seed.x + Math.sin(time * 0.11 + i) * 0.17,
        Math.min(-0.2, cameraPosition.y + seed.y + Math.sin(time * 0.07 + i) * 0.13), cameraPosition.z + seed.z);
    }
    particles.needsUpdate = true;
    for (let i = 0; i < this.bubbleSeeds.length; i++) {
      const seed = this.bubbleSeeds[i], rise = (seed.phase + time * 0.19) % 1;
      this.position.set(cameraPosition.x + Math.cos(seed.angle) * seed.radius + Math.sin(time * 0.5 + i) * rise * 0.12,
        Math.min(-0.14, cameraPosition.y - 0.8 + rise * 4), cameraPosition.z + Math.sin(seed.angle) * seed.radius);
      this.rotation.identity(); this.scale.set(seed.size * (0.75 + rise * 0.5), seed.size * 1.14, seed.size);
      this.matrix.compose(this.position, this.rotation, this.scale); this.bubbles.setMatrixAt(i, this.matrix);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.instances.forEach((mesh) => mesh.dispose()); this.resources.dispose(); this.group.clear(); this.fish.length = 0;
  }
}
