import * as THREE from 'three';
import { makeInstances, ModelResources, randomSeed, updateInstanceBounds } from './models/procedural.ts';

interface Bubble {
  origin: THREE.Vector3;
  born: number;
  life: number;
  size: number;
  rise: number;
  phase: number;
}

/** Air reflects at its boundary; the center is not a pale diffuse particle. */
export function bubbleRimMaterial(resources: ModelResources): THREE.MeshPhysicalMaterial {
  const material = resources.material(new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.018,
    metalness: 0, ior: 1.333, specularIntensity: 1.15, clearcoat: 0.45, clearcoatRoughness: 0.035,
    transparent: true, opacity: 1, depthWrite: false, side: THREE.FrontSide }));
  material.name = 'air bubble / clear interior / reflected thin rim';
  material.userData.photorealRole = 'air bubble boundary';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBubbleLife;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING_COLOR
        vBubbleLife = instanceColor.r;
      #else
        vBubbleLife = 1.0;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBubbleLife;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
      float bubbleFacing = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      float bubbleRim = pow(1.0 - bubbleFacing, 5.5);
      gl_FragColor.a = vBubbleLife * (.002 + .38 * bubbleRim);
      gl_FragColor.rgb += vec3(.012, .025, .024) * bubbleRim;
      #include <dithering_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'marine-clear-bubble-rim-v4';
  return material;
}

/** A bounded world-space trail: emitted bubbles keep their origin as the diver moves. */
export class BubbleTrail {
  readonly mesh: THREE.InstancedMesh;
  private readonly active: Bubble[] = [];
  private readonly random = randomSeed(0x4255424c);
  private readonly previousCamera = new THREE.Vector3();
  private readonly travel = new THREE.Vector3(0, 0, -1);
  private readonly delta = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly fade = new THREE.Color();
  private nextEmission = 0;
  private previousTime = 0;
  private swimming = false;
  private disposed = false;
  private readonly capacity = 28;

  constructor(resources: ModelResources) {
    this.mesh = makeInstances(resources.geometry(new THREE.SphereGeometry(1, 24, 16)), bubbleRimMaterial(resources), this.capacity, 'small world-space exhalation bubbles');
    this.mesh.castShadow = this.mesh.receiveShadow = false; this.mesh.visible = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.capacity; i++) this.mesh.setColorAt(i, this.fade.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.userData.trail = { capacity: this.capacity, active: 0, maxRadius: 0.028, placement: 'world-space emission, not a camera shell' };
  }

  update(time: number, camera: THREE.Vector3, underwater: boolean): void {
    if (this.disposed) return;
    this.mesh.visible = underwater;
    if (!underwater) {
      this.active.length = 0; this.mesh.count = 0; this.mesh.userData.trail.active = 0; this.swimming = false;
      return;
    }
    if (!this.swimming || time < this.previousTime || time - this.previousTime > 2 || this.previousCamera.distanceToSquared(camera) > 16) {
      this.active.length = 0; this.nextEmission = time + 0.22; this.previousCamera.copy(camera); this.swimming = true;
    }
    this.delta.copy(camera).sub(this.previousCamera); this.delta.y = 0;
    if (this.delta.lengthSq() > 0.0004) this.travel.lerp(this.delta.normalize(), 0.32).normalize();
    if (time >= this.nextEmission) {
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count && this.active.length < this.capacity; i++) {
        const side = (this.random() - 0.5) * 0.18;
        this.active.push({ origin: new THREE.Vector3(camera.x - this.travel.x * 0.35 + this.travel.z * side,
          camera.y - 0.19 - this.random() * 0.055, camera.z - this.travel.z * 0.35 - this.travel.x * side),
          born: time + i * 0.034, life: 4.3 + this.random() * 1.7, size: 0.004 + Math.pow(this.random(), 2) * 0.02,
          rise: 0.23 + this.random() * 0.22, phase: this.random() * Math.PI * 2 });
      }
      this.nextEmission = time + 1.15 + this.random() * 0.95;
    }
    let index = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const bubble = this.active[i], age = Math.max(0, time - bubble.born);
      const y = bubble.origin.y + bubble.rise * age;
      if (age > bubble.life || y > -0.055) { this.active.splice(i, 1); continue; }
      this.position.set(bubble.origin.x + age * 0.024 + Math.sin(age * 2.4 + bubble.phase) * age * 0.012,
        y, bubble.origin.z - age * 0.019 + Math.cos(age * 1.7 + bubble.phase) * age * 0.012);
      const radius = bubble.size * (1 + age * 0.026);
      this.scale.set(radius * (1 + Math.sin(age * 3 + bubble.phase) * 0.035), radius * 0.97, radius);
      this.matrix.compose(this.position, this.rotation, this.scale); this.mesh.setMatrixAt(index, this.matrix);
      const opacity = THREE.MathUtils.smoothstep(age, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(age, bubble.life - 0.65, bubble.life))
        * THREE.MathUtils.smoothstep(-y, 0.055, 0.22);
      this.mesh.setColorAt(index++, this.fade.setRGB(opacity, opacity, opacity));
    }
    this.mesh.count = index; this.mesh.userData.trail.active = index;
    this.mesh.instanceColor!.needsUpdate = true; updateInstanceBounds(this.mesh);
    this.previousTime = time; this.previousCamera.copy(camera);
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.active.length = 0; this.mesh.dispose(); }
}
