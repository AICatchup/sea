import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const photographicSkyUrl = new URL('../assets/sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr', import.meta.url).href;

export interface PhotographicSky {
  texture: THREE.DataTexture;
  /** Positive azimuth in XZ, in radians. Use the SAME angle in the GLSL sampler. */
  rotation: number;
  /** Multiply raw HDR radiance by this once, before the scene exposure. */
  exposure: number;
  /** Brightest-region centroid, rotated into the same world frame as the sky. */
  sun: THREE.Vector3;
}

function radiance(data: Float32Array | Uint16Array, index: number): number {
  const decode = (offset: number) => data instanceof Float32Array ? data[offset] : THREE.DataUtils.fromHalfFloat(data[offset]);
  return .2126 * decode(index) + .7152 * decode(index + 1) + .0722 * decode(index + 2);
}

/** RGBE is top-to-bottom; HDRLoader flips it on upload, matching Three equirectUv. */
export function photographicSkyPixelDirection(x: number, y: number, width: number, height: number): THREE.Vector3 {
  const longitude = ((x + .5) / width - .5) * Math.PI * 2;
  const latitude = (.5 - (y + .5) / height) * Math.PI;
  const horizontal = Math.cos(latitude);
  return new THREE.Vector3(horizontal * Math.cos(longitude), Math.sin(latitude), horizontal * Math.sin(longitude));
}

export function rotateSkyDirection(direction: THREE.Vector3, rotation: number): THREE.Vector3 {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return new THREE.Vector3(c * direction.x - s * direction.z, direction.y, s * direction.x + c * direction.z);
}

/** Detect the photographed sun once on CPU; there is no per-frame image readback. */
export function photographicSkyLighting(texture: THREE.DataTexture, rotation = 0): { sun: THREE.Vector3; exposure: number } {
  const image = texture.image as { data: Float32Array | Uint16Array; width: number; height: number };
  const { data, width, height } = image;
  let maximum = 0;
  const histogram = new Uint32Array(256);
  let samples = 0;
  for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
    const light = radiance(data, (y * width + x) * 4);
    if (!Number.isFinite(light)) throw new Error('Non-finite HDR sky radiance.');
    maximum = Math.max(maximum, light);
    // Exclude the sun and horizon from a robust sky-exposure sample region.
    if (y > height * .08 && y < height * .45 && x % 4 === 0 && y % 4 === 0) {
      const bin = Math.round(THREE.MathUtils.clamp((Math.log2(Math.max(light, 1e-6)) + 12) / 24, 0, 1) * 255);
      histogram[bin]++; samples++;
    }
  }
  if (maximum <= 0 || samples === 0) throw new Error('Empty photographic sky.');
  const sun = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let total = 0;
  for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
    const light = radiance(data, (y * width + x) * 4);
    if (light < maximum * .85) continue;
    direction.copy(photographicSkyPixelDirection(x, y, width, height));
    const weight = (light - maximum * .85) * Math.sqrt(Math.max(0, 1 - direction.y * direction.y));
    sun.addScaledVector(direction, weight); total += weight;
  }
  if (total <= 0 || sun.lengthSq() < 1e-8) throw new Error('HDR sun could not be detected.');
  let count = 0, medianBin = 0;
  for (; medianBin < histogram.length - 1; medianBin++) {
    count += histogram[medianBin]; if (count >= samples * .5) break;
  }
  const medianRadiance = 2 ** (medianBin / 255 * 24 - 12);
  // Keep a blue midday sky in the compositor's useful linear range. Original
  // dynamic range and the photographed cloud edges remain in the HDR texture.
  return { sun: rotateSkyDirection(sun.normalize(), rotation),
    exposure: THREE.MathUtils.clamp(.32 / medianRadiance, .005, 8) };
}

export async function loadPhotographicSky(rotation = 0): Promise<PhotographicSky> {
  const texture = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(photographicSkyUrl);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.name = 'Poly Haven — Kloofendal 48d Partly Cloudy Pure Sky (CC0)';
  try { return { texture, rotation, ...photographicSkyLighting(texture, rotation) }; }
  catch (error) { texture.dispose(); throw error; }
}

/** Use inside skyRadiance; the HDR sun is already present, so add no second disk. */
export const photographicSkySampling = /* glsl */ `
  uniform sampler2D uSkyTexture;
  uniform float uSkyRotation, uSkyExposure;
  vec3 photographicSkyRadiance(vec3 direction) {
    float c=cos(uSkyRotation),s=sin(uSkyRotation);
    vec3 ray=normalize(vec3(c*direction.x+s*direction.z,direction.y,-s*direction.x+c*direction.z));
    vec2 uv=vec2(atan(ray.z,ray.x)*.159154943091895+.5,asin(clamp(ray.y,-1.0,1.0))*.318309886183791+.5);
    return texture2D(uSkyTexture,uv).rgb*uSkyExposure;
  }
`;
