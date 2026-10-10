// Exact update body from dd2f5eb:src/world/marine-life.ts; only signature adapted.
import * as THREE from 'three';
import { updateInstanceBounds } from '../../src/world/models/procedural.ts';
import { advanceFishMotion, createFishMotion } from './fish-motion-v62-legacy.ts';
export function legacyMarineUpdate(this: any, time: number, cameraPosition: THREE.Vector3, underwater: boolean): void {
    if (this.disposed || !Number.isFinite(time)) return;
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
      const x = fish.center.x + Math.cos(phase) * fish.radius + meander;
      const z = fish.center.z + Math.sin(phase) * fish.radius * fish.aspect + Math.sin(time * 0.13 + fish.depthPhase) * 0.15;
      const clearance = fish.size * 0.28 + 0.09;
      const target = { x, z, y: fish.center.y + Math.sin(time * 0.6 + fish.depthPhase) * 0.24,
        heading: Math.atan2(Math.cos(phase) * fish.aspect, -Math.sin(phase)) };
      if (!fish.motion) {
        const bottom = this.ground.heightAt(x, z);
        const valid = Number.isFinite(bottom) && bottom <= -0.65 && bottom + clearance <= -0.3;
        const initialX = valid ? x : fish.center.x, initialZ = valid ? z : fish.center.z;
        const initialBottom = this.ground.heightAt(initialX, initialZ);
        fish.motion = createFishMotion({ x: initialX, z: initialZ,
          y: Math.min(-0.3, Math.max(initialBottom + clearance, target.y)), heading: target.heading }, time);
      } else advanceFishMotion(fish.motion, target, time, clearance, (px, pz) => this.ground.heightAt(px, pz));
      this.position.set(fish.motion.x, fish.motion.y, fish.motion.z);
      const yaw = -fish.motion.heading;
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

