import * as THREE from 'three';

/** Official scan width 2139.9996 mm; fallen leaves retain centimetre scale. */
export const FOREST_GROUND_SURFACE = Object.freeze({
  tileSpanMeters: 2.14, normalStrength: 0.6,
  source: 'https://polyhaven.com/a/forest_floor', license: 'CC0-1.0',
  normalConvention: 'OpenGL +Y',
});
export const FOREST_GROUND_TEXTURE_URLS = Object.freeze({
  albedo: new URL('../assets/forest-ground/forest_floor_diff_2k.jpg', import.meta.url).href,
  normalGL: new URL('../assets/forest-ground/forest_floor_nor_gl_2k.jpg', import.meta.url).href,
  arm: new URL('../assets/forest-ground/forest_floor_arm_2k.jpg', import.meta.url).href,
});
/** Terrain material owns these maps. A rejected load retains the authored soil fallback. */
export function loadForestGroundTextures() {
  const loader = typeof document === 'undefined' ? undefined : new THREE.TextureLoader();
  const pending: Promise<void>[] = [];
  const ready = { value: 0 };
  const load = (role: keyof typeof FOREST_GROUND_TEXTURE_URLS) => {
    let texture = new THREE.Texture();
    if (loader) pending.push(new Promise<void>((resolve, reject) => {
      texture = loader.load(FOREST_GROUND_TEXTURE_URLS[role], () => resolve(), undefined, reject);
    }));
    texture.name = `Poly Haven Forest Floor / ${role}`;
    texture.colorSpace = role === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.userData = { ...FOREST_GROUND_SURFACE, role };
    return texture;
  };
  const albedo = load('albedo'), normalGL = load('normalGL'), arm = load('arm');
  const promise = Promise.all(pending).then(() => { ready.value = loader ? 1 : 0; });
  void promise.catch(error => console.warn('Forest ground unavailable; authored soil retained', error));
  return { albedo, normalGL, arm, textures: [albedo, normalGL, arm], ready, promise };
}
