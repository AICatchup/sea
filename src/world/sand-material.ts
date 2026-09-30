import * as THREE from 'three';

/** The unchanged, official 2K photographs are bundled locally by Vite. */
export const SAND_TEXTURE_URLS = Object.freeze({
  albedo: new URL('../assets/sand/sand_02_diff_2k.jpg', import.meta.url).href,
  normalGL: new URL('../assets/sand/sand_02_nor_gl_2k.jpg', import.meta.url).href,
  arm: new URL('../assets/sand/sand_02_arm_2k.jpg', import.meta.url).href,
});

/** Use world metres for every map so photographed grains retain their scan size. */
export const SAND_SURFACE = Object.freeze({
  tileSpanMeters: 2.14,
  tilesPerMeter: 1 / 2.14,
  dryNormalStrength: 0.6,
  wetNormalStrength: 0.32,
  dryRoughnessRange: [0.78, 0.96] as const,
  wetRoughnessRange: [0.27, 0.48] as const,
  wetAlbedoMultiplier: 0.62,
  normalConvention: 'OpenGL +Y',
  armChannels: { occlusion: 'r', roughness: 'g', metalness: 'b' },
});

export interface SandTextureSet {
  ready:Promise<void>;
  albedo: THREE.Texture;
  normalGL: THREE.Texture;
  arm: THREE.Texture;
  /** The terrain owner disposes these together with its other GPU resources. */
  textures: readonly THREE.Texture[];
}

/** Start image loading without blocking terrain construction; safe for CPU-only tests. */
export function loadSandTextures(anisotropy = 8): SandTextureSet {
  const pending:Promise<void>[]=[];
  const loader = typeof document === 'undefined' ? undefined : new THREE.TextureLoader();
  const load = (role: keyof typeof SAND_TEXTURE_URLS, colorSpace: THREE.ColorSpace) => {
    let texture=new THREE.Texture();
    if(loader)pending.push(new Promise<void>((resolve,reject)=>{texture=loader.load(SAND_TEXTURE_URLS[role],()=>resolve(),undefined,reject);}));
    texture.name = `Poly Haven Sand 02 / ${role}`;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.max(1, Math.min(16, Number.isFinite(anisotropy) ? anisotropy : 8));
    texture.colorSpace = colorSpace;
    texture.userData = { source: 'https://polyhaven.com/a/sand_02', license: 'CC0-1.0', tileSpanMeters: SAND_SURFACE.tileSpanMeters, role };
    return texture;
  };
  const albedo = load('albedo', THREE.SRGBColorSpace);
  const normalGL = load('normalGL', THREE.NoColorSpace);
  const arm = load('arm', THREE.NoColorSpace);
  return { albedo, normalGL, arm, ready:Promise.all(pending).then(()=>{}), textures: [albedo, normalGL, arm] };
}
