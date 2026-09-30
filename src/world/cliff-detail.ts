import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { sandAt } from './geodata.ts';

const noise = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 27.11) * 43758.5453;
  return n - Math.floor(n);
};

/** Angular, joint-split rock volumes embedded in nonwalkable cliff faces; the height sampler is untouched. */
export function cliffOutcrops(ground: GroundSampler, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), vertical = new THREE.Vector3();
  const familyCounts = { plates: 0, columns: 0, wedges: 0 }, regions = { west: 0, centre: 0, east: 0 };
  let count = 0, pieces = 0, eligible = 0, maxProtrusion = 0, maxFaceWidth = 0, rejectedStrand = 0, minVisibleY = Infinity;
  let sampledCliffArea = 0, authoredFaceArea = 0;
  const stride = 2.6, triangleLimit = 210000;
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade: number) => {
    for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); colors.push(shade, shade * .995, shade * 1.02); uvs.push(p.x * .2, p.y * .2); }
  };
  const slopeAt = (x: number, z: number, radius = 2.2) => {
    const gx = (ground.heightAt(x + radius, z) - ground.heightAt(x - radius, z)) / (radius * 2);
    const gz = (ground.heightAt(x, z + radius) - ground.heightAt(x, z - radius)) / (radius * 2);
    return { gx, gz, magnitude: Math.hypot(gx, gz) };
  };
  for (let z = bounds.minZ + 12; z < bounds.maxZ - 12; z += stride) for (let x = bounds.minX + 12; x < bounds.maxX - 12; x += stride) {
    if (positions.length / 9 + 120 > triangleLimit) break;
    const px = x + (noise(x, z, 13) - .5) * 2.9, pz = z + (noise(x, z, 17) - .5) * 2.9;
    const y = ground.heightAt(px, pz);
    if (y < 3.4 || y > 67 || sandAt(px, pz) > .55) continue;
    const gradient = slopeAt(px, pz);
    if (gradient.magnitude < 1.12) continue;
    eligible++; sampledCliffArea += stride * stride * Math.hypot(1, gradient.magnitude);
    if (noise(x, z, 31) < .035) continue;
    normal.set(-gradient.gx, 1, -gradient.gz).normalize(); tangent.set(-gradient.gz, 0, gradient.gx).normalize();
    vertical.crossVectors(normal, tangent).normalize(); // T × V = outward N, preserving face winding.
    if (vertical.y < 0) { vertical.negate(); tangent.negate(); }
    const dip = Math.sin(px * .025 + pz * .019) * .12;
    tangent.applyAxisAngle(normal, dip); vertical.applyAxisAngle(normal, dip);
    const family = noise(Math.floor(px / 13), Math.floor(pz / 11), 37);
    const familyName = family < .46 ? 'plates' : family < .73 ? 'columns' : 'wedges';
    const width = familyName === 'plates' ? 1.9 + noise(x, z, 41) * 2.1 : familyName === 'columns' ? .85 + noise(x, z, 41) * 1.05 : 1.35 + noise(x, z, 41) * 1.65;
    const height = familyName === 'plates' ? .55 + noise(x, z, 43) * .88 : familyName === 'columns' ? 1.45 + noise(x, z, 43) * 1.75 : .85 + noise(x, z, 43) * 1.5;
    const depth = .65 + noise(x, z, 47) * 1.85;
    const centre = new THREE.Vector3(px, y, pz).addScaledVector(normal, .04);
    const split = familyName === 'plates' ? 2 + (noise(x, z, 51) > .68 ? 1 : 0) : 1 + (noise(x, z, 51) > .45 ? 1 : 0);
    const gap = .13 + noise(x, z, 53) * .29;
    const shade = .57 + noise(x, z, 81) * .21;
    let emitted = 0, minTangent = Infinity, maxTangent = -Infinity;
    for (let part = 0; part < split; part++) {
      const halfWidth = (width * 2 - gap * (split - 1)) / (split * 2);
      const partOffset = -width + halfWidth + part * (halfWidth * 2 + gap);
      const partCentre = centre.clone().addScaledVector(tangent, partOffset).addScaledVector(normal, (part % 2 ? -.14 : .11) * depth);
      const ring = familyName === 'columns'
        ? [[-1, -.7], [-.65, -1], [.52, -.91], [1, -.5], [.86, .74], [.44, 1], [-.56, .87], [-1, .52]]
        : familyName === 'wedges'
          ? [[-1, -.54], [-.53, -1], [.48, -.86], [1, -.46], [.83, .52], [.34, 1], [-.66, .78], [-1, .37]]
          : [[-1, -.68], [-.7, -1], [.65, -.91], [1, -.61], [.94, .59], [.54, 1], [-.71, .91], [-1, .52]];
      const rings: THREE.Vector3[][] = [[], [], []];
      for (let layer = 0; layer < 3; layer++) for (let i = 0; i < ring.length; i++) {
        const edge = layer === 2 ? .77 : 1, asymmetry = .85 + noise(px + i, pz + part, 59) * .26;
        const u = ring[i][0] * halfWidth * edge * asymmetry, v = ring[i][1] * height * edge * asymmetry;
        const depthAt = layer === 0 ? -Math.max(1.2, depth * 1.1) : depth * (layer === 1 ? .68 : 1.0)
          + (u / Math.max(halfWidth, .1)) * depth * .10 + (v / height) * depth * .07;
        const p = partCentre.clone().addScaledVector(tangent, u).addScaledVector(vertical, v).addScaledVector(normal, depthAt);
        if (layer === 0) p.y = Math.min(p.y, ground.heightAt(p.x, p.z) - .24); // No detached floating back edge.
        rings[layer].push(p);
      }
      // Protrusions stay above low banks. Fine low-sand geometry is owned by the shared strand surface.
      if (rings[1].some(p => p.y < 2.1 || (sandAt(p.x, p.z) > .6 && ground.heightAt(p.x, p.z) < 5))) { rejectedStrand++; continue; }
      const front = partCentre.clone().addScaledVector(normal, depth * 1.035);
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        triangle(front, rings[2][i], rings[2][j], shade + .06);
        for (let layer = 0; layer < 2; layer++) {
          triangle(rings[layer][i], rings[layer][j], rings[layer + 1][j], shade - (layer ? .025 : .10));
          triangle(rings[layer][i], rings[layer + 1][j], rings[layer + 1][i], shade - (layer ? .025 : .10));
        }
      }
      authoredFaceArea += halfWidth * height * 4 * .81;
      for (const p of [...rings[1], ...rings[2], front]) {
        const delta = p.clone().sub(centre);
        minTangent = Math.min(minTangent, delta.dot(tangent)); maxTangent = Math.max(maxTangent, delta.dot(tangent));
        maxProtrusion = Math.max(maxProtrusion, delta.dot(normal) + .04);
        minVisibleY = Math.min(minVisibleY, p.y);
      }
      pieces++; emitted++;
    }
    if (emitted) {
      maxFaceWidth = Math.max(maxFaceWidth, maxTangent - minTangent);
      familyCounts[familyName]++; regions[px < -90 ? 'west' : px > 90 ? 'east' : 'centre']++;
      count++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData = {
    outcropCount: count, rockPieces: pieces, triangleCount: positions.length / 9, triangleLimit,
    familyCounts, regions, eligibleSteepFaceSamples: eligible, rejectedStrandPieces: rejectedStrand,
    sampledCliffAreaM2: sampledCliffArea, authoredFaceAreaM2: authoredFaceArea,
    maxNormalProtrusionM: maxProtrusion, maxFaceWidthM: maxFaceWidth, minExposedVertexHeightM: Number.isFinite(minVisibleY) ? minVisibleY : null,
    provenance: 'Authored joint-split cliff volumes, open clefts and overhangs; not surveyed geometry',
  };
  return geometry;
}
