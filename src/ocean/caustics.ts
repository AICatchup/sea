import * as THREE from 'three';
import { capillarySampling, shoreWaveSampling } from './surface-detail';

export interface CausticBathymetry {
  /** R: seabed height in metres, G: local wave shelter, as in oceanVertex. */
  texture: THREE.Texture;
  origin: THREE.Vector2;
  size: THREE.Vector2;
}

export interface WaveCausticsOptions {
  span?: number;
  resolution?: 256 | 512;
  photonResolution?: 128 | 256;
}

const photonVertex = /* glsl */ `
  precision highp float;
  uniform sampler2D uLongWaves, uShortWaves, uBathymetry;
  uniform vec4 uBounds, uBathyBounds;
  uniform vec2 uBathyResolution;
  uniform vec3 uSunDirection;
  uniform float uSwell, uChoppiness, uWind, uResolution, uPhotonResolution, uTime;
  varying float vEnergy;
  const float PI = 3.14159265359;
  ${capillarySampling}
  ${shoreWaveSampling}
  vec2 bathyUv(vec2 p) {
    return (p-uBathyBounds.xy)/uBathyBounds.zw;
  }
  vec2 coastAt(vec2 p) {
    vec2 uv=bathyUv(p);
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec2(-110.0,1.0);
    uv=uv*(uBathyResolution-1.0)/uBathyResolution+.5/uBathyResolution;
    return texture2D(uBathymetry,uv).rg;
  }
  vec3 surfaceAt(vec2 p) {
    vec2 coast=coastAt(p);
    float shoal=shoreWaveScale(coast,uSwell,uWind);
    vec3 d=(texture2D(uLongWaves,p/384.0).xyz+texture2D(uShortWaves,p/24.0).xyz)*shoal*uSwell;
    return vec3(p.x+d.x*uChoppiness,d.y,p.y+d.z*uChoppiness);
  }
  void main() {
    // Emit at regularly spaced crossings of the mean water plane. Invert the
    // choppy displacement to preserve incident photon density in WORLD space.
    float sourceSpan=uBounds.z*1.5;
    vec2 meanXZ=uBounds.xy+uBounds.z*.5+position.xy*sourceSpan;
    vec3 incident=-normalize(uSunDirection);
    incident.y=min(incident.y,-.035);
    vec2 parameter=meanXZ;
    for(int i=0;i<4;i++) {
      vec3 water=surfaceAt(parameter);
      vec2 horizontalDisplacement=water.xz-parameter;
      parameter=meanXZ+incident.xz*(water.y/incident.y)-horizontalDisplacement;
    }
    vec3 surface=surfaceAt(parameter);
    // Resolve the shortest FFT cascade in metres, not a screen-space normal.
    const float stepLength=.1875;
    vec3 dx=surfaceAt(parameter+vec2(stepLength,0.0))-surfaceAt(parameter-vec2(stepLength,0.0));
    vec3 dz=surfaceAt(parameter+vec2(0.0,stepLength))-surfaceAt(parameter-vec2(0.0,stepLength));
    vec3 normal=normalize(cross(dz,dx));
    if(normal.y<0.0) normal=-normal;
    normal.xz-=capillarySurfaceSlope(parameter,uTime)*(.45+uWind*.035);normal=normalize(normal);
    vec3 ray=refract(incident,normal,1.0/1.333);
    // Intersect the metric seabed. Re-sampling catches slopes and sandy banks.
    float floorY=coastAt(surface.xz).r;
    float distance=max(0.0,(floorY-surface.y)/min(ray.y,-.02));
    vec3 hit=surface+ray*distance;
    for(int i=0;i<4;i++) {
      floorY=coastAt(hit.xz).r;
      distance=max(0.0,(floorY-surface.y)/min(ray.y,-.02));
      hit=surface+ray*distance;
    }
    float cell=sourceSpan/uPhotonResolution;
    // A finite Gaussian photon footprint integrates the sampling lattice. The
    // solar angular radius widens it with depth; wind adds unresolved roughness.
    // The support must overlap several emitters (sigma is radius/sqrt(8)).
    // A narrower footprint paints a checkerboard even through perfectly flat
    // water; 1.7-cell support keeps the flat-water reconstruction within 2%.
    float radius=max(cell*1.70,.14)+distance*.00465*(1.0+.016*uWind);
    float cosine=clamp(dot(-incident,normal),0.0,1.0);
    float reflection=.02037+.97963*pow(1.0-cosine,5.0);
    // Scalar geometric focusing only. Receiver materials apply wavelength-
    // dependent Beer absorption along the refracted path, exactly once.
    float flux=(1.0-reflection);
    flux*=smoothstep(.025,.12,uSunDirection.y);
    float valid=step(floorY,-.035)*step(.02,-ray.y)*step(distance,80.0);
    // Integral of exp(-4*r^2) over the unit disk; hence conserved photon energy.
    float kernelIntegral=PI*(1.0-exp(-4.0))*.25;
    vEnergy=valid*flux*cell*cell/(radius*radius*kernelIntegral);
    gl_PointSize=clamp(2.0*radius*uResolution/uBounds.z,2.0,48.0);
    vec2 uv=(hit.xz-uBounds.xy)/uBounds.zw;
    gl_Position=vec4(uv*2.0-1.0,0.0,1.0);
  }
`;

const photonFragment = /* glsl */ `
  precision highp float;
  varying float vEnergy;
  void main() {
    vec2 p=gl_PointCoord*2.0-1.0;
    float radiusSquared=dot(p,p);
    if(radiusSquared>1.0) discard;
    float energy=vEnergy*exp(-4.0*radiusSquared);
    gl_FragColor=vec4(energy,energy,energy,0.0);
  }
`;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`;

const integrateFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uPhotons, uHistory;
  uniform vec4 uBounds, uPreviousBounds;
  uniform float uResolution, uHistoryWeight;
  varying vec2 vUv;
  void main() {
    // The footprint is already a normalized low-pass reconstruction; a tiny
    // pixel filter removes splat edges without erasing real focus/defocus.
    vec2 pixel=vec2(1.0/uResolution);
    float current=texture2D(uPhotons,vUv).r*.5;
    current+=(texture2D(uPhotons,vUv+vec2(pixel.x,0)).r+texture2D(uPhotons,vUv-vec2(pixel.x,0)).r
      +texture2D(uPhotons,vUv+vec2(0,pixel.y)).r+texture2D(uPhotons,vUv-vec2(0,pixel.y)).r)*.125;
    vec2 world=uBounds.xy+vUv*uBounds.zw;
    vec2 previousUv=(world-uPreviousBounds.xy)/uPreviousBounds.zw;
    float previous=texture2D(uHistory,clamp(previousUv,0.0,1.0)).r;
    float inside=step(0.0,previousUv.x)*step(0.0,previousUv.y)*step(previousUv.x,1.0)*step(previousUv.y,1.0);
    float energy=mix(current,previous,uHistoryWeight*inside);
    gl_FragColor=vec4(energy,energy,energy,1.0);
  }
`;

/**
 * Photon-density caustics from the SAME FFT displacement textures as the ocean.
 * R is geometric irradiance relative to a flat, perfectly transmitting surface.
 * This is an XZ seabed projection, not a volume solution for suspended objects.
 */
export class WaveCaustics {
  readonly bounds = new THREE.Vector4();
  private readonly span: number;
  private readonly resolution: number;
  private readonly photonScene = new THREE.Scene();
  private readonly integrationScene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly photons: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly photonTarget: THREE.WebGLRenderTarget;
  private readonly history: THREE.WebGLRenderTarget[];
  private readonly previousBounds = new THREE.Vector4();
  private readonly previousSun = new THREE.Vector3();
  private readonly clearColor = new THREE.Color();
  private historyIndex = 0;
  private initialized = false;
  private previousTime = NaN;
  private previousSwell = NaN;
  private previousWind = NaN;
  private previousChoppiness = NaN;

  constructor(private readonly renderer: THREE.WebGLRenderer, options: WaveCausticsOptions = {}) {
    this.span = options.span ?? 64;
    this.resolution = options.resolution ?? 512;
    const count = options.photonResolution ?? 256;
    if (!Number.isFinite(this.span) || this.span < 32 || this.span > 96) throw new Error('Caustic span must be 32–96 metres.');
    if (![256, 512].includes(this.resolution) || ![128, 256].includes(count)) throw new Error('Unsupported caustic budget.');
    this.bounds.set(-this.span / 2, -this.span / 2, this.span, this.span);
    this.previousBounds.copy(this.bounds);
    const coordinates = new Float32Array(count * count * 3);
    for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
      const offset = (z * count + x) * 3;
      coordinates[offset] = (x + .5) / count - .5;
      coordinates[offset + 1] = (z + .5) / count - .5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3));
    const photonMaterial = new THREE.ShaderMaterial({
      vertexShader: photonVertex, fragmentShader: photonFragment, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending, toneMapped: false,
      // AdditiveBlending's default SRC_ALPHA factor would zero these photons.
      premultipliedAlpha: true,
      uniforms: {
        uLongWaves: { value: null }, uShortWaves: { value: null }, uBathymetry: { value: null },
        uBounds: { value: this.bounds }, uBathyBounds: { value: new THREE.Vector4() },
        uBathyResolution: { value: new THREE.Vector2() }, uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSwell: { value: 1 }, uChoppiness: { value: 1.55 }, uWind: { value: 8 }, uTime:{value:0},
        uResolution: { value: this.resolution }, uPhotonResolution: { value: count },
      },
    });
    this.photons = new THREE.Points(geometry, photonMaterial);
    this.photons.frustumCulled = false;
    this.photonScene.add(this.photons);
    const makeTarget = () => new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.photonTarget = makeTarget();
    this.history = [makeTarget(), makeTarget()];
    const integrationMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex, fragmentShader: integrateFragment, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uPhotons: { value: this.photonTarget.texture }, uHistory: { value: this.history[0].texture },
        uBounds: { value: this.bounds }, uPreviousBounds: { value: this.previousBounds },
        uResolution: { value: this.resolution }, uHistoryWeight: { value: 0 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), integrationMaterial);
    this.quad.frustumCulled = false;
    this.integrationScene.add(this.quad);
  }

  get texture(): THREE.Texture { return this.history[this.historyIndex].texture; }

  /** Explicit developer probe; never called in the frame loop. */
  readEnergy():{min:number;max:number;mean:number;rms:number;center:number}{
    const pixels=new Uint16Array(this.resolution*this.resolution*4);
    this.renderer.readRenderTargetPixels(this.history[this.historyIndex],0,0,this.resolution,this.resolution,pixels);
    let min=Infinity,max=0,sum=0,squares=0;
    for(let i=0;i<pixels.length;i+=4){const value=THREE.DataUtils.fromHalfFloat(pixels[i]);min=Math.min(min,value);max=Math.max(max,value);sum+=value;squares+=value*value;}
    const count=pixels.length/4,mean=sum/count;
    const index=(Math.floor(this.resolution/2)*this.resolution+Math.floor(this.resolution/2))*4;
    return {min,max,mean,rms:Math.sqrt(Math.max(0,squares/count-mean*mean)),center:THREE.DataUtils.fromHalfFloat(pixels[index])};
  }

  update(time: number, delta: number, longWaves: THREE.Texture, shortWaves: THREE.Texture,
    bathymetry: CausticBathymetry, cameraPosition: THREE.Vector3, sunDirection: THREE.Vector3,
    swell: number, wind: number, choppiness = 1.55): void {
    const u = this.photons.material.uniforms;
    const oldTarget = this.renderer.getRenderTarget();
    const oldFace = this.renderer.getActiveCubeFace();
    const oldMip = this.renderer.getActiveMipmapLevel();
    const oldAutoClear = this.renderer.autoClear;
    const oldAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(this.clearColor);
    // Align source photons in world space; preserve history through camera moves.
    const sourceCell = this.span * 1.5 / u.uPhotonResolution.value;
    this.bounds.set(Math.floor(cameraPosition.x / sourceCell) * sourceCell - this.span / 2,
      Math.floor(cameraPosition.z / sourceCell) * sourceCell - this.span / 2, this.span, this.span);
    u.uLongWaves.value = longWaves; u.uShortWaves.value = shortWaves; u.uBathymetry.value = bathymetry.texture;
    u.uBathyBounds.value.set(bathymetry.origin.x, bathymetry.origin.y, bathymetry.size.x, bathymetry.size.y);
    const image = bathymetry.texture.image as { width: number; height: number };
    u.uBathyResolution.value.set(image.width, image.height);
    u.uSunDirection.value.copy(sunDirection).normalize();
    u.uSwell.value = swell; u.uWind.value = wind; u.uChoppiness.value = choppiness;
    u.uTime.value=time;
    const continuous = this.initialized && delta > 0 && time >= this.previousTime && time - this.previousTime < .12
      && this.previousSun.dot(u.uSunDirection.value) > .9999 && Math.abs(this.previousSwell - swell) < .02
      && Math.abs(this.previousWind - wind) < .2 && Math.abs(this.previousChoppiness - choppiness) < .02;
    const integration = this.quad.material.uniforms;
    integration.uHistoryWeight.value = continuous ? Math.exp(-delta / .025) : 0;
    integration.uHistory.value = this.history[this.historyIndex].texture;
    const next = 1 - this.historyIndex;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    try {
      if (!this.initialized) {
        // Both floating-point histories have defined contents before sampling.
        for (const target of this.history) { this.renderer.setRenderTarget(target); this.renderer.clear(true, false, false); }
      }
      this.renderer.setRenderTarget(this.photonTarget);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.photonScene, this.camera);
      this.renderer.setRenderTarget(this.history[next]);
      this.renderer.render(this.integrationScene, this.camera);
      this.historyIndex = next;
      this.previousBounds.copy(this.bounds);
      this.previousSun.copy(u.uSunDirection.value);
      this.previousTime = time; this.previousSwell = swell; this.previousWind = wind; this.previousChoppiness = choppiness;
      this.initialized = true;
    } finally {
      this.renderer.autoClear = oldAutoClear;
      this.renderer.setClearColor(this.clearColor, oldAlpha);
      this.renderer.setRenderTarget(oldTarget, oldFace, oldMip);
    }
  }

  dispose(): void {
    this.photons.geometry.dispose(); this.photons.material.dispose();
    this.quad.geometry.dispose(); this.quad.material.dispose();
    this.photonTarget.dispose(); this.history.forEach(target => target.dispose());
  }
}

/** Include this in a receiving material, then modulate its underwater sunlight. */
export const waveCausticsSampling = /* glsl */ `
  uniform sampler2D uCaustics;
  uniform vec4 uCausticBounds;
  float refractedIrradiance(vec3 worldPosition) {
    vec2 uv=(worldPosition.xz-uCausticBounds.xy)/uCausticBounds.zw;
    vec2 edge=min(uv,1.0-uv);
    float valid=smoothstep(0.0,.04,min(edge.x,edge.y));
    float energy=texture2D(uCaustics,clamp(uv,0.0,1.0)).r;
    // Keep geometric energy linear; spectral attenuation belongs to the
    // receiver and tone mapping belongs to the scene compositor.
    return mix(1.0,energy,valid);
  }
`;
