import * as THREE from 'three';
import { createSpectrum } from './spectrum';

const quadVertex = `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const evolutionFragment = `
  precision highp float;
  uniform sampler2D uSpectrum, uPreviousSpectrum;
  uniform float uSize, uLength, uTime, uBlend;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    vec2 k = (gl_FragCoord.xy - 0.5 - uSize * 0.5) * 6.28318530718 / uLength;
    float magnitude = length(k);
    vec4 initial = mix(texture2D(uPreviousSpectrum, uv), texture2D(uSpectrum, uv), uBlend);
    float omega = sqrt(9.81 * magnitude);
    vec2 phase = vec2(cos(omega*uTime), sin(omega*uTime));
    vec2 h = cmul(initial.xy, phase) + cmul(initial.zw * vec2(1.0,-1.0), phase * vec2(1.0,-1.0));
    vec2 imaginaryH = vec2(-h.y, h.x);
    vec2 direction = k / max(magnitude, 0.000001);
    // Odd displacement spectra vanish on their self-conjugate Nyquist axis.
    if (gl_FragCoord.x < 1.0) direction.x = 0.0;
    if (gl_FragCoord.y < 1.0) direction.y = 0.0;
    // IFFT(Dx + i Dz) = real Dx + i real Dz: three real fields, one RGBA FFT.
    gl_FragColor = vec4(h, imaginaryH * direction.x - h * direction.y);
  }
`;

const butterflyFragment = `
  precision highp float;
  uniform sampler2D uInput;
  uniform float uSize, uSubtransform;
  uniform bool uHorizontal;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
  void main() {
    vec2 pixel = gl_FragCoord.xy - 0.5;
    float index = uHorizontal ? pixel.x : pixel.y;
    float halfSize = uSubtransform * 0.5;
    float evenIndex = floor(index / uSubtransform) * halfSize + mod(index, halfSize);
    vec2 evenUV = (uHorizontal ? vec2(evenIndex, pixel.y) : vec2(pixel.x, evenIndex)) + 0.5;
    vec2 oddUV = evenUV + (uHorizontal ? vec2(uSize * 0.5, 0.0) : vec2(0.0, uSize * 0.5));
    vec4 a = texture2D(uInput, evenUV / uSize);
    vec4 b = texture2D(uInput, oddUV / uSize);
    float angle = 6.28318530718 * mod(index, uSubtransform) / uSubtransform;
    vec2 twiddle = vec2(cos(angle), sin(angle));
    gl_FragColor = a + vec4(cmul(twiddle, b.xy), cmul(twiddle, b.zw));
  }
`;

const combineFragment = `
  precision highp float;
  uniform sampler2D uFields, uPrevious;
  uniform float uSize, uLength, uDelta, uChoppiness, uSwell, uFoamRetention, uFoamDecay;
  vec3 displacement(vec2 pixel) {
    vec2 p = mod(pixel + uSize, uSize);
    vec2 uv = (p + 0.5) / uSize;
    float signFlip = mod(p.x + p.y, 2.0) < 0.5 ? 1.0 : -1.0;
    vec4 fields = texture2D(uFields, uv);
    return vec3(fields.z, fields.x, fields.w) * signFlip / (uSize * uSize);
  }
  void main() {
    vec2 p = gl_FragCoord.xy - 0.5;
    vec3 d = displacement(p);
    float stepSize = uLength / uSize;
    vec3 dx = (displacement(p + vec2(1,0)) - displacement(p - vec2(1,0))) / (2.0 * stepSize);
    vec3 dz = (displacement(p + vec2(0,1)) - displacement(p - vec2(0,1))) / (2.0 * stepSize);
    float chop = uChoppiness * uSwell;
    float jacobian = (1.0 + dx.x * chop) * (1.0 + dz.z * chop) - dx.z * dz.x * chop * chop;
    float born = 1.0 - smoothstep(0.10, 0.55, jacobian);
    vec2 uv = gl_FragCoord.xy / uSize;
    float previous = texture2D(uPrevious, uv - vec2(0.12,0.09) * uDelta / uLength).a;
    float foam = max(born, previous * uFoamRetention * exp(-uDelta * uFoamDecay));
    gl_FragColor = vec4(d, foam);
  }
`;

interface Cascade {
  size: number;
  length: number;
  spectrum: THREE.DataTexture;
  previousSpectrum: THREE.DataTexture;
  blend: number;
  breakingScale: number;
  fields: THREE.WebGLRenderTarget[];
  displacement: THREE.WebGLRenderTarget[];
  output: number;
}

/** Stockham inverse FFT, with two independently band-limited spatial cascades. */
export class OceanSimulation {
  readonly cascades: Cascade[];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly outputTextures: THREE.Texture[] = [];
  private wind = 0;
  private readonly evolve = new THREE.ShaderMaterial({
    vertexShader: quadVertex, fragmentShader: evolutionFragment, depthTest: false, depthWrite: false,
    uniforms: { uSpectrum: { value: null }, uPreviousSpectrum: { value: null }, uBlend: { value: 1 },
      uSize: { value: 256 }, uLength: { value: 384 }, uTime: { value: 0 } },
  });
  private readonly fft = new THREE.ShaderMaterial({
    vertexShader: quadVertex, fragmentShader: butterflyFragment, depthTest: false, depthWrite: false,
    uniforms: { uInput: { value: null }, uSize: { value: 256 }, uSubtransform: { value: 2 }, uHorizontal: { value: true } },
  });
  private readonly combine = new THREE.ShaderMaterial({
    vertexShader: quadVertex, fragmentShader: combineFragment, depthTest: false, depthWrite: false,
    uniforms: { uFields: { value: null }, uPrevious: { value: null }, uSize: { value: 256 },
      uLength: { value: 384 }, uDelta: { value: 0.016 }, uChoppiness: { value: 1.45 }, uSwell: { value: 1 },
      uFoamRetention: { value: 1 }, uFoamDecay: { value: 0.8 } },
  });

  constructor(private readonly renderer: THREE.WebGLRenderer, wind: number) {
    this.scene.add(this.quad);
    this.quad.frustumCulled = false;
    this.cascades = [this.createCascade(256, 384), this.createCascade(128, 24)];
    this.setWind(wind);
    this.outputTextures.push(...this.cascades.map(cascade => cascade.displacement[0].texture));
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const cascade of this.cascades) {
      for (const target of cascade.displacement) {
        renderer.setRenderTarget(target);
        renderer.clear();
      }
    }
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  private createCascade(size: number, length: number): Cascade {
    const makeTarget = (output = false) => new THREE.WebGLRenderTarget(size, size, {
      type: output ? THREE.HalfFloatType : THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: output ? THREE.LinearFilter : THREE.NearestFilter,
      magFilter: output ? THREE.LinearFilter : THREE.NearestFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    const spectrum = new THREE.DataTexture();
    return { size, length, spectrum, previousSpectrum: spectrum, blend: 1, breakingScale: 0,
      fields: [makeTarget(), makeTarget()],
      displacement: [makeTarget(true), makeTarget(true)], output: 0 };
  }

  setWind(wind: number): void {
    if (!Number.isFinite(wind) || wind <= 0) throw new Error('Wind must be finite and positive.');
    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];
      // Residual long swell keeps its long wavelengths when the local wind dies.
      const data = createSpectrum({ size: cascade.size, length: cascade.length,
        wind: i === 0 ? Math.max(5, wind) : wind, seed: 8107 + i * 73,
        minWaveNumber: i === 0 ? 0 : 1.15,
        maxWaveNumber: i === 0 ? 1.55 : 18,
        rmsHeight: i === 0 ? 0.11 + 0.0055 * wind ** 2
          : 0.009 * wind ** 0.92 * THREE.MathUtils.smoothstep(wind, 1.5, 5),
      });
      if (this.wind > 0) {
        const previous = cascade.previousSpectrum;
        const current = cascade.spectrum;
        // Retarget an unfinished transition from its visible coefficients, not
        // its old endpoint. Identical seeds preserve phase during wind changes.
        if (cascade.blend < 1 && previous !== current) {
          const from = previous.image.data as Float32Array;
          const to = current.image.data as Float32Array;
          const blend = cascade.blend * cascade.blend * (3 - 2 * cascade.blend);
          for (let j = 0; j < from.length; j++) from[j] += (to[j] - from[j]) * blend;
          previous.needsUpdate = true;
          current.dispose();
        } else {
          if (previous !== current) previous.dispose();
          cascade.previousSpectrum = current;
        }
        cascade.blend = 0;
      } else cascade.spectrum.dispose();
      cascade.spectrum = new THREE.DataTexture(data, cascade.size, cascade.size, THREE.RGBAFormat, THREE.FloatType);
      cascade.spectrum.needsUpdate = true;
      if (this.wind === 0) cascade.previousSpectrum = cascade.spectrum;
    }
    this.wind = wind;
  }

  advance(time: number, delta: number, swell: number, choppiness: number): void {
    const previousTarget = this.renderer.getRenderTarget();
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      for (let i = 0; i < this.cascades.length; i++) {
        const cascade = this.cascades[i];
        // A zero-delta readback is also used to update a paused ocean immediately.
        const snapshotTransition = delta === 0 && cascade.blend < 1;
        cascade.blend = delta === 0 ? 1 : Math.min(1, cascade.blend + Math.max(0, delta) / 1.2);
        const blend = cascade.blend * cascade.blend * (3 - 2 * cascade.blend);
        if (cascade.blend === 1 && cascade.previousSpectrum !== cascade.spectrum) {
          cascade.previousSpectrum.dispose();
          cascade.previousSpectrum = cascade.spectrum;
        }
        const buffers = cascade.fields;
        let current = 0;
        this.evolve.uniforms.uSpectrum.value = cascade.spectrum;
        this.evolve.uniforms.uPreviousSpectrum.value = cascade.previousSpectrum;
        this.evolve.uniforms.uBlend.value = blend;
        this.evolve.uniforms.uSize.value = cascade.size;
        this.evolve.uniforms.uLength.value = cascade.length;
        this.evolve.uniforms.uTime.value = time;
        this.draw(this.evolve, buffers[current]);
        this.fft.uniforms.uSize.value = cascade.size;
        for (let axis = 0; axis < 2; axis++) {
          this.fft.uniforms.uHorizontal.value = axis === 0;
          for (let subtransform = 2; subtransform <= cascade.size; subtransform *= 2) {
            this.fft.uniforms.uSubtransform.value = subtransform;
            this.fft.uniforms.uInput.value = buffers[current].texture;
            current = 1 - current;
            this.draw(this.fft, buffers[current]);
          }
        }
        const next = 1 - cascade.output;
        this.combine.uniforms.uFields.value = buffers[current].texture;
        this.combine.uniforms.uPrevious.value = cascade.displacement[cascade.output].texture;
        this.combine.uniforms.uSize.value = cascade.size;
        this.combine.uniforms.uLength.value = cascade.length;
        this.combine.uniforms.uDelta.value = delta;
        this.combine.uniforms.uSwell.value = swell;
        this.combine.uniforms.uChoppiness.value = choppiness;
        const breakingScale = swell * choppiness;
        this.combine.uniforms.uFoamRetention.value = snapshotTransition ? 0 : cascade.breakingScale > 0
          ? Math.min(1, breakingScale / cascade.breakingScale) ** 2 : 1;
        this.combine.uniforms.uFoamDecay.value = 0.8 + 1.6 * (1 - THREE.MathUtils.smoothstep(this.wind, 2, 8));
        this.draw(this.combine, cascade.displacement[next]);
        cascade.output = next;
        cascade.breakingScale = breakingScale;
        this.outputTextures[i] = cascade.displacement[next].texture;
      }
    } finally {
      this.renderer.autoClear = previousAutoClear;
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  get textures(): THREE.Texture[] {
    return this.outputTextures;
  }

  dispose(): void {
    for (const cascade of this.cascades) {
      cascade.spectrum.dispose();
      if (cascade.previousSpectrum !== cascade.spectrum) cascade.previousSpectrum.dispose();
      for (const target of [...cascade.fields, ...cascade.displacement]) target.dispose();
    }
    this.quad.geometry.dispose();
    this.evolve.dispose(); this.fft.dispose(); this.combine.dispose();
  }
}
