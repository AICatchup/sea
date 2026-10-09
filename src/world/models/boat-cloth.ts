import * as THREE from 'three';
import type { ModelResources } from './procedural.ts';

/** Poly Haven API dimensions are millimetres; scene coordinates are metres. */
export const BOAT_CLOTH_PERIOD = [.26570814767607123, .2662999927997589] as const;
export const BOAT_CLOTH_URLS = [
  new URL('../../assets/boat/terlenka/terlenka_diff_2k.jpg', import.meta.url).href,
  new URL('../../assets/boat/terlenka/terlenka_nor_gl_2k.jpg', import.meta.url).href,
  new URL('../../assets/boat/terlenka/terlenka_rough_2k.jpg', import.meta.url).href,
];

/** Call on the original box, before rounding changes its positions and normals. */
export function boatClothUV(geometry: THREE.BufferGeometry): void {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Oriented planar axes follow the original BoxGeometry face orientation.
    const u = Math.abs(n.getX(i)) > .5 ? -Math.sign(n.getX(i)) * z : Math.sign(n.getZ(i)) * x;
    if (Math.abs(n.getY(i)) > .5) uv.setXY(i, x / BOAT_CLOTH_PERIOD[0], -Math.sign(n.getY(i)) * z / BOAT_CLOTH_PERIOD[1]);
    else uv.setXY(i, u / BOAT_CLOTH_PERIOD[0], y / BOAT_CLOTH_PERIOD[1]);
  }
  uv.needsUpdate = true;
}

export interface BoatClothState { status: 'loading' | 'loaded' | 'fallback' | 'disposed'; source: string; error?: string; }
/** Atomic PBR activation. Loader-returned textures belong to resources immediately. */
export function loadBoatCloth(resources: ModelResources, material: THREE.MeshStandardMaterial,
  loader: Pick<THREE.TextureLoader, 'load'> = new THREE.TextureLoader()): { ready: Promise<void>; state: BoatClothState } {
  const state: BoatClothState = { status: 'loading', source: 'Poly Haven CC0 terlenka; candidate fabric, exact vessel material unverified' };
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  material.addEventListener('dispose', () => { state.status = 'disposed'; finish(); });
  const maps: THREE.Texture[] = [];
  const loads = BOAT_CLOTH_URLS.map((url, index) => new Promise<void>((resolve, reject) => {
    try {
      const texture = resources.texture(loader.load(url, () => resolve(), undefined, reject));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.repeat.set(1, 1); texture.offset.set(0, 0); texture.rotation = 0;
      maps[index] = texture;
    } catch (error) { reject(error); }
  }));
  Promise.all(loads).then(() => {
    if (state.status === 'disposed') return;
    material.color.set('#ffffff'); material.roughness = 1;
    material.map = maps[0]; material.normalMap = maps[1]; material.roughnessMap = maps[2];
    material.normalScale.set(.35, .35); material.bumpMap = null; material.bumpScale = 0;
    material.needsUpdate = true; state.status = 'loaded'; finish();
  }).catch((error: unknown) => {
    if (state.status === 'disposed') return;
    state.status = 'fallback'; state.error = error instanceof Error ? error.message : String(error); finish();
  });
  return { ready, state };
}
