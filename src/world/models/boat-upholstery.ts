import * as THREE from 'three';
import { ModelBatch, ModelResources, smoothNormalsByPosition, standard, surfaceTexture } from './procedural.ts';
import { boatClothUV } from './boat-cloth.ts';

/** Authored woven marine upholstery. No downloaded photograph or location claim. */
export function boatUpholsteryMaterial(resources: ModelResources): THREE.MeshStandardMaterial {
  const material = standard(resources, '#d6d4c5', 0.86);
  material.map = surfaceTexture(resources, '#e7e3d2', 'cloth', 824);
  material.map.repeat.set(14, 10);
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Alternating warp and weft, deliberately shallow so it reads as fabric, not gravel.
    const warp = Math.sin(x * Math.PI / 2), weft = Math.sin(y * Math.PI / 2);
    const value = Math.round(128 + warp * 18 + weft * 11);
    const offset = (y * size + x) * 4;
    pixels.set([value, value, value, 255], offset);
  }
  const bump = resources.texture(new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat));
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(20, 14); bump.generateMipmaps = true;
  bump.minFilter = THREE.LinearMipmapLinearFilter; bump.needsUpdate = true;
  material.bumpMap = bump; material.bumpScale = 0.0012;
  return material;
}

/** Solid six-sided cushion with a softly stuffed crown and compressed perimeter seam.
 * All deformation remains inside the previous box extent, preserving passenger clearances.
 * Backrests use the same shape rotated into the vertical plane, including the rear upholstery.
 */
export function addBoatCushion(
  batch: ModelBatch, fabric: THREE.Material, piping: THREE.Material,
  position: THREE.Vector3, width: number, thickness: number, depth: number,
  rotation = new THREE.Euler(), seed = 0,
): void {
  const radius = Math.min(thickness * 0.38, 0.045);
  const geometry = new THREE.BoxGeometry(width, thickness, depth, 16, 4, 10);
  if (fabric.userData.physicalBoatCloth) boatClothUV(geometry);
  const vertices = geometry.getAttribute('position');
  const core = new THREE.Vector3(width / 2 - radius, thickness / 2 - radius, depth / 2 - radius);
  const p = new THREE.Vector3(), nearest = new THREE.Vector3(), delta = new THREE.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    p.fromBufferAttribute(vertices, i);
    nearest.set(THREE.MathUtils.clamp(p.x, -core.x, core.x), THREE.MathUtils.clamp(p.y, -core.y, core.y), THREE.MathUtils.clamp(p.z, -core.z, core.z));
    delta.copy(p).sub(nearest).normalize().multiplyScalar(radius);
    p.copy(nearest).add(delta);
    const u = p.x / (width / 2), v = p.z / (depth / 2);
    const faceWeight = Math.pow(Math.abs(p.y) / (thickness / 2), 8);
    const edge = Math.max(Math.abs(u), Math.abs(v));
    const seam = Math.exp(-Math.pow((edge - 0.78) / 0.09, 2));
    const tension = (1 - u * u) * (1 - v * v);
    // Broad contact hollow and irregular low-amplitude tension folds; never inflate above the box.
    const pressed = thickness * (0.085 * seam + 0.045 * tension * (1 + 0.35 * Math.sin(u * 5 + v * 4 + seed)));
    p.y -= Math.sign(p.y) * faceWeight * pressed;
    vertices.setXYZ(i, p.x, p.y, p.z);
  }
  smoothNormalsByPosition(geometry);
  batch.add(geometry, fabric, position, undefined, rotation);
  // A closed sewn welt at mid-thickness: real curved geometry on every side, not a face stripe.
  const points: THREE.Vector3[] = [];
  const corner = Math.min(0.06, depth * 0.12, width * 0.12);
  for (let c = 0; c < 4; c++) {
    const angle = c * Math.PI / 2;
    const cx = Math.cos(angle + Math.PI / 4) > 0 ? width / 2 - corner - 0.004 : -width / 2 + corner + 0.004;
    const cz = Math.sin(angle + Math.PI / 4) > 0 ? depth / 2 - corner - 0.004 : -depth / 2 + corner + 0.004;
    for (let j = 0; j <= 4; j++) {
      const a = angle + j / 4 * Math.PI / 2;
      points.push(new THREE.Vector3(cx + Math.cos(a) * corner, thickness * 0.08, cz + Math.sin(a) * corner));
    }
  }
  // Rounded corners joined by straight runs keep the piping within the former cushion silhouette.
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length; i++) path.add(new THREE.LineCurve3(points[i], points[(i + 1) % points.length]));
  batch.add(new THREE.TubeGeometry(path, 48, 0.0035, 5, true), piping, position, undefined, rotation);
}
