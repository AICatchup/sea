import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const photographicSkyUrl = new URL('../assets/sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr', import.meta.url).href;

export interface PhotographicSky {
  texture: THREE.DataTexture;
  reflection: THREE.DataTexture;
  /** Positive azimuth in XZ, in radians. Use the SAME angle in the GLSL sampler. */
  rotation: number;
  /** Multiply raw HDR radiance by this once, before the scene exposure. */
  exposure: number;
  /** Brightest-region centroid, rotated into the same world frame as the sky. */
  sun: THREE.Vector3;
}

/** The direct GGX lobe already accounts for the photographed sun. Remove
 * only that disk before reflection mip filtering, preserving the display HDR.
 * Half-resolution RGBA16F costs about 5.3 MiB including the mip chain at 2K. */
export function createReflectionSky(texture:THREE.DataTexture,worldSun:THREE.Vector3,rotation:number):THREE.DataTexture {
  const {data,width,height}=texture.image as {data:Float32Array|Uint16Array;width:number;height:number};
  const sun=rotateSkyDirection(worldSun,-rotation),axis=new THREE.Vector3().crossVectors(sun,Math.abs(sun.y)<.95?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize();
  const other=new THREE.Vector3().crossVectors(sun,axis),sky=[0,0,0];
  const value=(i:number)=>data instanceof Float32Array?data[i]:THREE.DataUtils.fromHalfFloat(data[i]);
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8,d=sun.clone().addScaledVector(axis,Math.cos(a)*.045).addScaledVector(other,Math.sin(a)*.045).normalize();
    const x=Math.min(width-1,Math.floor(((Math.atan2(d.z,d.x)/(2*Math.PI)+.5+1)%1)*width));
    const y=THREE.MathUtils.clamp(Math.floor((.5-Math.asin(d.y)/Math.PI)*height),0,height-1);
    for(let c=0;c<3;c++)sky[c]+=value((y*width+x)*4+c)/16;
  }
  const w=Math.max(1,width>>1),h=Math.max(1,height>>1),out=new Uint16Array(w*h*4);
  const inner=Math.cos(.009),outer=Math.cos(.023);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const rgb=[0,0,0];let samples=0;
    for(let sy=y*2;sy<Math.min(height,y*2+2);sy++)for(let sx=x*2;sx<Math.min(width,x*2+2);sx++){
      const lat=(.5-(sy+.5)/height)*Math.PI,lon=((sx+.5)/width-.5)*Math.PI*2,cl=Math.cos(lat);
      const dot=cl*Math.cos(lon)*sun.x+Math.sin(lat)*sun.y+cl*Math.sin(lon)*sun.z;
      const disk=THREE.MathUtils.smoothstep(dot,outer,inner),i=(sy*width+sx)*4;
      for(let c=0;c<3;c++)rgb[c]+=THREE.MathUtils.lerp(value(i+c),sky[c],disk);samples++;
    }
    const i=(y*w+x)*4;for(let c=0;c<3;c++)out[i+c]=THREE.DataUtils.toHalfFloat(rgb[c]/samples);out[i+3]=THREE.DataUtils.toHalfFloat(1);
  }
  const reflection=new THREE.DataTexture(out,w,h,THREE.RGBAFormat,THREE.HalfFloatType);
  reflection.colorSpace=THREE.LinearSRGBColorSpace;reflection.flipY=texture.flipY;
  reflection.wrapS=THREE.RepeatWrapping;reflection.wrapT=THREE.ClampToEdgeWrapping;
  reflection.minFilter=THREE.LinearMipmapLinearFilter;reflection.magFilter=THREE.LinearFilter;
  reflection.generateMipmaps=true;reflection.needsUpdate=true;reflection.name='Sky reflection without direct solar disk';
  return reflection;
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
  try { const lighting=photographicSkyLighting(texture,rotation);return { texture, rotation, ...lighting,reflection:createReflectionSky(texture,lighting.sun,rotation) }; }
  catch (error) { texture.dispose(); throw error; }
}

/** Use inside skyRadiance; the HDR sun is already present, so add no second disk. */
export const photographicSkySampling = /* glsl */ `
  uniform sampler2D uSkyTexture,uSkyReflectionTexture;
  uniform float uSkyRotation, uSkyExposure;
  vec2 photographicSkyUV(vec3 direction) {
    float c=cos(uSkyRotation),s=sin(uSkyRotation);
    vec3 ray=normalize(vec3(c*direction.x+s*direction.z,direction.y,-s*direction.x+c*direction.z));
    return vec2(atan(ray.z,ray.x)*.159154943091895+.5,asin(clamp(ray.y,-1.0,1.0))*.318309886183791+.5);
  }
  vec3 photographicSkyRadiance(vec3 direction) {
    return texture2D(uSkyTexture,photographicSkyUV(direction)).rgb*uSkyExposure;
  }
  vec3 photographicSkyReflection(vec3 direction,float angularWidth) {
    vec2 uv=photographicSkyUV(direction),size=vec2(textureSize(uSkyReflectionTexture,0));
    // Unresolved surface slopes spread reflected radiance over a cone. Using
    // a sharp HDR sample here ignored the roughness already used for sun/land
    // and made a distant cloud edge a hard stripe on the water. Filter linear
    // HDR radiance; exposure and tone mapping still happen exactly once.
    float latitudeScale=max(.12,sqrt(max(0.,1.-direction.y*direction.y)));
    vec2 cone=angularWidth*vec2(.159154943091895/latitudeScale,.318309886183791);
    vec2 pixel=max(abs(dFdx(uv)),abs(dFdy(uv)));
    // Longitude wraps at the map seam. A wrap is not a huge pixel footprint.
    pixel.x=min(pixel.x,1.-pixel.x);
    float lod=log2(max(1.,max(max(pixel.x,cone.x)*size.x,max(pixel.y,cone.y)*size.y)));
    return textureLod(uSkyReflectionTexture,uv,lod).rgb*uSkyExposure;
  }
`;
