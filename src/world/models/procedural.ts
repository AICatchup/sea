import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function randomSeed(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Owns each shared resource once; instances and undo operations never free it. */
export class ModelResources {
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly materials = new Set<THREE.Material>();
  readonly textures = new Set<THREE.Texture>();
  geometry<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
  material<T extends THREE.Material>(material: T): T { this.materials.add(material); return material; }
  texture<T extends THREE.Texture>(texture: T): T { this.textures.add(texture); return texture; }
  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}

/** Small authored, tileable textures; no image download or canvas dependency. */
export function surfaceTexture(
  resources: ModelResources, base: THREE.ColorRepresentation, style: 'stone' | 'bark' | 'cloth' | 'paint', seed: number,
): THREE.DataTexture {
  const size = 128;
  const color = new THREE.Color(base);
  const random = randomSeed(seed);
  const pixels = new Uint8Array(size * size * 4);
  const srgb = color.clone().convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = random() - 0.5;
    const vein = Math.sin(x * 0.18 + Math.sin(y * 0.13) * 1.3);
    const grain = style === 'stone' ? 0.12 * noise + 0.028 * vein
      : style === 'bark' ? 0.16 * noise + 0.13 * Math.sin(x * 0.47 + Math.sin(y * 0.035) * 2)
        : style === 'cloth' ? 0.026 * noise + (x % 2 + y % 2 - 1) * 0.025 : noise * 0.016;
    const offset = (y * size + x) * 4;
    pixels[offset] = THREE.MathUtils.clamp((srgb.r + grain) * 255, 0, 255);
    pixels[offset + 1] = THREE.MathUtils.clamp((srgb.g + grain) * 255, 0, 255);
    pixels[offset + 2] = THREE.MathUtils.clamp((srgb.b + grain) * 255, 0, 255);
    pixels[offset + 3] = 255;
  }
  const texture = resources.texture(new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function standard(
  resources: ModelResources, color: THREE.ColorRepresentation, roughness = 0.85, metalness = 0,
): THREE.MeshStandardMaterial {
  return resources.material(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

/** Weld shading across duplicated primitive/UV vertices without welding the UVs. */
export function smoothNormalsByPosition(geometry: THREE.BufferGeometry): void {
  geometry.computeVertexNormals();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${Math.round(positions.getX(i) * 1e5)},${Math.round(positions.getY(i) * 1e5)},${Math.round(positions.getZ(i) * 1e5)}`;
  for (let i = 0; i < positions.count; i++) {
    const id = key(i), sum = sums.get(id) ?? new THREE.Vector3();
    sum.x += normals.getX(i); sum.y += normals.getY(i); sum.z += normals.getZ(i); sums.set(id, sum);
  }
  sums.forEach((sum) => sum.normalize());
  for (let i = 0; i < positions.count; i++) {
    const sum = sums.get(key(i))!; normals.setXYZ(i, sum.x, sum.y, sum.z);
  }
  normals.needsUpdate = true;
}

export function rockGeometry(resources: ModelResources, seed: number, detail = 2): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute('position');
  const color = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    // Position-derived noise keeps duplicate vertices joined, including UV seams.
    const fissure = Math.sin(x * 8.4 + seed) * Math.sin(z * 6.7 + y * 4.3);
    const layer = 0.83 + Math.sin(y * 11 + x * 2 + seed) * 0.045 + fissure * 0.075;
    const erosion = Math.sin(x * 2.9 + z * 3.4 + seed * 0.7) * 0.075;
    position.setXYZ(i, x * (layer + erosion), Math.max(-0.68, y * layer), z * (layer - erosion) * 0.86);
    const shade = 0.72 + fissure * 0.13 + y * 0.06;
    color.set([shade, shade * 0.986, shade * 0.936], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  smoothNormalsByPosition(geometry);
  geometry.computeBoundingSphere();
  return resources.geometry(geometry);
}

export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2 = r1, sides = 7): THREE.BufferGeometry {
  const direction = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(r2, r1, direction.length(), sides, 1);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

/** Bake a detailed model down to one draw per material. Input geometries are temporary. */
export class ModelBatch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, position?: THREE.Vector3, scale?: THREE.Vector3, rotation?: THREE.Euler): void {
    if (scale) geometry.scale(scale.x, scale.y, scale.z);
    if (rotation) geometry.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation));
    if (position) geometry.translate(position.x, position.y, position.z);
    const list = this.parts.get(material) ?? [];
    // Standardize the attribute layout, so primitives with different UV layouts merge.
    if (geometry.index) {
      const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded;
    }
    for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') geometry.deleteAttribute(key);
    if (!geometry.hasAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    list.push(geometry); this.parts.set(material, list);
  }
  box(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), material, new THREE.Vector3(x, y, z), undefined, new THREE.Euler(rx, ry, rz));
  }
  tube(material: THREE.Material, points: THREE.Vector3[], radius: number, segments = 36): void {
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), material);
  }
  rod(material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, endRadius = radius): void {
    this.add(cylinderBetween(a, b, radius, endRadius), material);
  }
  finish(resources: ModelResources, name: string): THREE.Group {
    const group = new THREE.Group(); group.name = name;
    this.parts.forEach((parts, material) => {
      const merged = mergeGeometries(parts, false);
      parts.forEach((part) => part.dispose());
      if (!merged) throw new Error(`Cannot merge authored ${name} geometry`);
      const mesh = new THREE.Mesh(resources.geometry(merged), material);
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    });
    this.parts.clear(); return group;
  }
}

export function makeInstances(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function updateInstanceBounds(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
}

export function pineGeometries(resources: ModelResources, seed: number): { bark: THREE.BufferGeometry; needles: THREE.BufferGeometry } {
  const random = randomSeed(seed);
  const barkParts: THREE.BufferGeometry[] = [];
  const needleParts: THREE.BufferGeometry[] = [];
  const trunk = [new THREE.Vector3(), new THREE.Vector3(0.12, 1.5, -0.08), new THREE.Vector3(-0.08, 2.9, 0.12), new THREE.Vector3(0.34, 4.4, 0.14)];
  for (let i = 1; i < trunk.length; i++) barkParts.push(cylinderBetween(trunk[i - 1], trunk[i], 0.16 - i * 0.028, 0.135 - i * 0.026, 8));
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.39996 + random() * 0.4;
    const level = 2.55 + random() * 2.25;
    const spread = 1.0 + random() * 1.0 - (level - 2.5) * 0.12;
    const origin = new THREE.Vector3(level * 0.04, level, 0.02);
    const end = new THREE.Vector3(Math.cos(angle) * spread + 0.2, level + 0.25 + random() * 0.35, Math.sin(angle) * spread * 0.8);
    const fork = origin.clone().lerp(end, 0.67); fork.y -= 0.2;
    barkParts.push(cylinderBetween(origin, fork, 0.064, 0.026, 6), cylinderBetween(fork, end, 0.028, 0.012, 5));
    for (let j = 0; j < 2; j++) {
      const tuft = new THREE.IcosahedronGeometry(1, 1);
      const position = tuft.getAttribute('position');
      const colors = new Float32Array(position.count * 3);
      for (let p = 0; p < position.count; p++) {
        const x = position.getX(p), y = position.getY(p), z = position.getZ(p);
        const irregular = 1 + Math.sin(x * 8 + z * 9 + seed) * 0.13;
        position.setXYZ(p, x * irregular, y * irregular, z * irregular);
        const shade = 0.8 + y * 0.17 + Math.sin(z * 6 + x * 3) * 0.1;
        colors.set([shade * 0.66, shade, shade * 0.65], p * 3);
      }
      tuft.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const width = 0.52 + random() * 0.48;
      tuft.scale(width, 0.25 + random() * 0.18, width * 0.75);
      tuft.translate(end.x + (j - 0.5) * 0.4, end.y + j * 0.15, end.z);
      tuft.computeVertexNormals(); needleParts.push(tuft);
    }
  }
  // Thick, splayed roots keep the trunk grounded against the steep coast.
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 0.4;
    barkParts.push(cylinderBetween(new THREE.Vector3(Math.cos(angle) * 0.47, 0.04, Math.sin(angle) * 0.47), new THREE.Vector3(0, 0.6, 0), 0.055, 0.07, 5));
  }
  const bark = mergeGeometries(barkParts, false)!;
  const needles = mergeGeometries(needleParts, false)!;
  barkParts.forEach((part) => part.dispose()); needleParts.forEach((part) => part.dispose());
  return { bark: resources.geometry(bark), needles: resources.geometry(needles) };
}
