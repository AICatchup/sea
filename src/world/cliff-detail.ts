import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { sandAt } from './geodata.ts';

const noise = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 27.11) * 43758.5453;
  return n - Math.floor(n);
};

/** Joint-bounded ledges embedded in steep rock, never on the walkable strand or navigable water. */
export function cliffOutcrops(ground: GroundSampler, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), vertical = new THREE.Vector3();
  const ring = [[-1, -.55], [-.6, -1], [.64, -1], [1, -.5], [1, .55], [.63, 1], [-.65, 1], [-1, .48]];
  let count = 0;
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade: number) => {
    for (const p of [a, c, b]) { positions.push(p.x, p.y, p.z); colors.push(shade, shade * .995, shade * 1.02); uvs.push(p.x * .2, p.y * .2); }
  };
  for (let z = bounds.minZ + 12; z < bounds.maxZ - 12; z += 2.45) for (let x = bounds.minX + 12; x < bounds.maxX - 12; x += 2.45) {
    if (count >= 8500) break;
    const px = x + (noise(x, z, 13) - .5) * 1.9, pz = z + (noise(x, z, 17) - .5) * 1.9;
    const y = ground.heightAt(px, pz);
    if (y < 2.2 || y > 67 || sandAt(px, pz) > .6) continue;
    const gx = (ground.heightAt(px + 1.3, pz) - ground.heightAt(px - 1.3, pz)) / 2.6;
    const gz = (ground.heightAt(px, pz + 1.3) - ground.heightAt(px, pz - 1.3)) / 2.6;
    if (Math.hypot(gx, gz) < 1.05 || noise(x, z, 31) < .12) continue;
    normal.set(-gx, 1, -gz).normalize(); tangent.set(-gz, 0, gx).normalize(); vertical.crossVectors(tangent, normal).normalize();
    if (vertical.y < 0) vertical.negate();
    const centre = new THREE.Vector3(px, y, pz).addScaledVector(normal, .12);
    const width = .48 + noise(x, z, 41) * 1.28, height = .18 + noise(x, z, 43) * .57;
    const depth = .26 + noise(x, z, 47) * .72;
    const corners: THREE.Vector3[][] = [[], []];
    for (let side = 0; side < 2; side++) for (let i = 0; i < ring.length; i++) {
      const jitter = .83 + noise(px + i, pz, 59 + side) * .3;
      const p = centre.clone().addScaledVector(tangent, ring[i][0] * width * jitter)
        .addScaledVector(vertical, ring[i][1] * height * jitter)
        .addScaledVector(normal, side ? depth * (.8 + noise(px, pz + i, 67) * .32) : -depth * .9);
      corners[side].push(p);
    }
    const front = centre.clone().addScaledVector(normal, depth * 1.02);
    const shade = .58 + noise(x, z, 81) * .23;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      triangle(front, corners[1][i], corners[1][j], shade + .08);
      triangle(corners[0][i], corners[0][j], corners[1][j], shade);
      triangle(corners[0][i], corners[1][j], corners[1][i], shade);
    }
    count++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData = { outcropCount: count, triangleCount: positions.length / 9, provenance: 'Authored metre-scale cliff bedding; not surveyed rock geometry' };
  return geometry;
}
