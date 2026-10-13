import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import type { FoliageVariant } from './foliage.ts';
import { measurePlant } from './crown-support.ts';

/** One load-time pass over existing low shrub matrices; never reseeds a field. */
export function supportLowShrubs(ground: GroundSampler, variants: FoliageVariant[], matrices: THREE.Matrix4[][], low: ReadonlySet<THREE.Matrix4>) {
  const measured = variants.map(variant => {
    const native = measurePlant(variant);
    // A source-Y-only envelope can miss a higher leaf after tilt. Retain the
    // lowest actual vertex for eight tilted directions in every 35cm cell.
    // Source buffers remain untouched; this work is confined to detailed load.
    const cells = new Map<string, { points: THREE.Vector3[]; scores: number[] }>();
    const tilt = Math.tan(35 * Math.PI / 180);
    for (const part of variant.parts) {
      if (part.material.userData.foliageRole === 'trunk' || part.material.userData.foliageRole === 'branches' || part.material.name.includes('bark')) continue;
      const attribute = part.geometry.getAttribute('position');
      for (let i = 0; i < attribute.count; i++) {
        const x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i);
        if (![x, y, z].every(Number.isFinite)) continue;
        const key = `${Math.floor(x / .35)}:${Math.floor(z / .35)}`;
        let cell = cells.get(key);
        if (!cell) { cell = { points: [], scores: Array(9).fill(Infinity) }; cells.set(key, cell); }
        for (let direction = 0; direction < 9; direction++) {
          const angle = direction * Math.PI / 4;
          const score = y + (direction === 8 ? 0 : tilt * (x * Math.cos(angle) + z * Math.sin(angle)));
          if (score < cell.scores[direction]) { cell.scores[direction] = score; cell.points[direction] = new THREE.Vector3(x, y, z); }
        }
      }
    }
    native.leaves = [...cells.values()].flatMap(cell => cell.points.filter((p, i, all) => all.findIndex(other => other.equals(p)) === i));
    return native;
  });
  const diagnostics = { tested: 0, changed: 0, shrunk: 0, lifted: 0, invalid: 0, unresolved: 0,
    maxLift: 0, maxBurialBefore: 0, maxBurialAfter: 0, minWidthFactor: 1,
    maxRootGap: 0, samples: measured.map(m => m.leaves.length),
    exampleSites: [] as {x:number;z:number;soil:number;before:number;after:number}[] };
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const point = new THREE.Vector3(), foot = new THREE.Vector3(), candidate = new THREE.Matrix4();
  for (let variant = 0; variant < matrices.length; variant++) for (const original of matrices[variant]) {
    if (!low.has(original)) continue;
    diagnostics.tested++;
    const native = measured[variant];
    if (!native || !native.leaves.length || !original.elements.every(Number.isFinite)) { diagnostics.invalid++; continue; }
    original.decompose(position, rotation, scale);
    // Preserve the existing physical root's horizontal coordinates, even for off-centre native roots.
    foot.copy(native.foot).applyMatrix4(original);
    const rootX = foot.x, rootZ = foot.z, soil = ground.heightAt(rootX, rootZ);
    if (!Number.isFinite(soil)) { diagnostics.invalid++; continue; }
    const clearance = (matrix: THREE.Matrix4) => {
      let deficit = 0;
      for (const leaf of native.leaves) {
        point.copy(leaf).applyMatrix4(matrix);
        const height = ground.heightAt(point.x, point.z);
        if (!Number.isFinite(height)) return NaN;
        deficit = Math.max(deficit, height + .02 - point.y);
      }
      return deficit;
    };
    const before = clearance(original);
    if (!Number.isFinite(before)) { diagnostics.invalid++; continue; }
    diagnostics.maxBurialBefore = Math.max(diagnostics.maxBurialBefore, before);
    if (before <= .02) continue;
    let bestDeficit = Infinity, bestFactor = 1, bestLift = 0;
    const best = new THREE.Matrix4();
    // At most 30% horizontal reduction, unchanged height/lean, root gap <= 8cm.
    // Impossible sites remain visible in diagnostics; no deletion or unbounded lifting.
    for (const factor of [1, .9, .8, .7]) {
      candidate.compose(new THREE.Vector3(), rotation, new THREE.Vector3(scale.x * factor, scale.y, scale.z * factor));
      foot.copy(native.foot).applyMatrix4(candidate);
      candidate.setPosition(rootX - foot.x, soil - .015 - foot.y, rootZ - foot.z);
      const deficit = clearance(candidate);
      if (!Number.isFinite(deficit)) continue;
      const lift = Math.min(.095, deficit);
      candidate.elements[13] += lift;
      const residual = Math.max(0, deficit - lift);
      if (residual < bestDeficit) { bestDeficit = residual; best.copy(candidate); bestFactor = factor; bestLift = lift; }
      if (residual <= .02) break;
    }
    // Keep a difficult site's baseline unless the bounded adjustment improves leaf clearance.
    if (Number.isFinite(bestDeficit) && bestDeficit < before) {
      original.copy(best); diagnostics.changed++;
      if (bestFactor < 1) diagnostics.shrunk++;
      if (bestLift > 0) diagnostics.lifted++;
      diagnostics.maxLift = Math.max(diagnostics.maxLift, bestLift);
      diagnostics.minWidthFactor = Math.min(diagnostics.minWidthFactor, bestFactor);
      diagnostics.maxRootGap = Math.max(diagnostics.maxRootGap, bestLift - .015);
      if(diagnostics.exampleSites.length<8&&rootX>-180&&rootX<-60&&rootZ>-40&&rootZ<15&&before-bestDeficit>.1)
        diagnostics.exampleSites.push({x:rootX,z:rootZ,soil,before,after:bestDeficit});
    } else bestDeficit = before;
    diagnostics.maxBurialAfter = Math.max(diagnostics.maxBurialAfter, bestDeficit);
    if (bestDeficit > .02) diagnostics.unresolved++;
  }
  return diagnostics;
}
