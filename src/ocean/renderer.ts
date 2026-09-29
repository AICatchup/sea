import * as THREE from 'three';
import { OceanSimulation } from './fft';
import { oceanVertex, oceanFragment, skyVertex, skyFragment } from './shaders';
import { presets, type PresetName } from './presets';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
type Uniforms = Record<string, THREE.IUniform>;

function makeOceanGrid(): THREE.BufferGeometry {
  const rings = 220, sectors = 384;
  const positions = new Float32Array((rings + 1) * (sectors + 1) * 3);
  const indices = new Uint32Array(rings * sectors * 6);
  let v = 0, t = 0;
  for (let r = 0; r <= rings; r++) {
    const radius = 0.7 * Math.exp((r / rings) * Math.log(22000 / 0.7));
    for (let s = 0; s <= sectors; s++) {
      const angle = s / sectors * Math.PI * 2;
      positions[v++] = Math.cos(angle) * radius;
      positions[v++] = 0;
      positions[v++] = Math.sin(angle) * radius;
      if (r < rings && s < sectors) {
        const a = r * (sectors + 1) + s, b = a + sectors + 1;
        indices[t++] = a; indices[t++] = a + 1; indices[t++] = b;
        indices[t++] = a + 1; indices[t++] = b + 1; indices[t++] = b;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export class Ocean {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 35000);
  readonly simulation: OceanSimulation;
  readonly scene = new THREE.Scene();
  readonly uniforms: Uniforms;
  wind = presets.golden.wind;
  swell = presets.golden.swell;
  paused = false;
  quality: Quality = 'auto';
  time = 34;
  frames = 0;
  fps = 60;
  private yaw = 0;
  private pitch = -0.075;
  private targetYaw = 0;
  private targetPitch = -0.075;
  private height = 3.6;
  private targetHeight = 3.6;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private automaticScale = window.innerWidth < 650 ? 0.8 : 1;
  private lastStamp = 0;
  private measureTime = 0;
  private measureFrames = 0;
  private animationFrame = 0;
  private captureNextFrame: ((blob: Blob | null) => void) | null = null;
  private disposed = false;
  private readonly abort = new AbortController();
  private readonly viewDirection = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly materials: THREE.ShaderMaterial[];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!context || !context.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL 2と浮動小数点テクスチャに対応したGPUが必要です。ブラウザのハードウェアアクセラレーションを確認してください。');
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
    this.renderer.setClearColor(0x091d2b, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.simulation = new OceanSimulation(this.renderer, this.wind);
    const p = presets.golden;
    this.uniforms = {
      uTime: { value: this.time }, uSunDirection: { value: new THREE.Vector3(...p.sun).normalize() },
      uSunColor: { value: new THREE.Vector3(...p.sunColor) }, uZenith: { value: new THREE.Vector3(...p.zenith) },
      uHorizon: { value: new THREE.Vector3(...p.horizon) }, uCloudColor: { value: new THREE.Vector3(...p.cloud) },
      uWaterTint: { value: new THREE.Vector3(...p.water) }, uCloudCoverage: { value: p.coverage },
      uExposure: { value: p.exposure }, uStorm: { value: p.storm },
      uLongWaves: { value: null }, uShortWaves: { value: null }, uSwell: { value: this.swell },
      uChoppiness: { value: 1.55 }, uWind: { value: this.wind },
      uCameraWorld: { value: this.camera.matrixWorld }, uInverseProjection: { value: this.camera.projectionMatrixInverse },
    };
    const skyMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVertex, fragmentShader: skyFragment,
      depthTest: false, depthWrite: false, toneMapped: false });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
    const oceanMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: oceanVertex, fragmentShader: oceanFragment,
      side: THREE.DoubleSide, toneMapped: false });
    const ocean = new THREE.Mesh(makeOceanGrid(), oceanMaterial);
    ocean.frustumCulled = false;
    this.scene.add(ocean);
    this.materials = [skyMaterial, oceanMaterial];
    this.listen();
    this.resize();
    this.simulation.advance(this.time, 0, this.swell, this.uniforms.uChoppiness.value);
    this.frame(0);
  }

  private listen(): void {
    const options = { signal: this.abort.signal };
    window.addEventListener('resize', () => this.resize(), options);
    this.canvas.addEventListener('pointerdown', event => {
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    }, options);
    this.canvas.addEventListener('pointermove', event => {
      if (!this.dragging) return;
      this.targetYaw -= (event.clientX - this.lastPointer.x) * 0.0026;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + (event.clientY - this.lastPointer.y) * 0.0021, -0.65, 0.65);
      this.lastPointer = { x: event.clientX, y: event.clientY };
    }, options);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(event, () => { this.dragging = false; }, options);
    }
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.targetHeight = THREE.MathUtils.clamp(this.targetHeight * Math.exp(event.deltaY * 0.0012), 2.2, 55);
    }, { ...options, passive: false });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.animationFrame); this.lastStamp = 0; }
      else if (!this.disposed) { this.lastStamp = 0; this.animationFrame = requestAnimationFrame(this.frame); }
    }, options);
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      cancelAnimationFrame(this.animationFrame);
      window.dispatchEvent(new CustomEvent('ocean-error', { detail: 'GPUとの接続が中断されました。ページを再読み込みしてください。' }));
    }, options);
  }

  private frame = (stamp: number): void => {
    if (this.disposed) return;
    const elapsed = this.lastStamp === 0 ? 1 / 60 : (stamp - this.lastStamp) / 1000;
    const delta = Math.min(elapsed, 0.05);
    this.lastStamp = stamp;
    const damping = 1 - Math.exp(-delta * 8);
    this.yaw = THREE.MathUtils.lerp(this.yaw, this.targetYaw, damping);
    this.pitch = THREE.MathUtils.lerp(this.pitch, this.targetPitch, damping);
    const safeHeight = Math.max(2.2, (0.11 + 0.0055 * this.wind ** 2) * this.swell * 3.5 + 0.7);
    this.height = THREE.MathUtils.lerp(this.height, Math.max(this.targetHeight, safeHeight), damping);
    if (!this.paused) {
      this.time += delta;
      this.simulation.advance(this.time, delta, this.swell, this.uniforms.uChoppiness.value);
    }
    const bob = Math.sin(this.time * 0.57) * 0.045 + Math.sin(this.time * 0.93) * 0.023;
    this.camera.position.set(0, this.height + bob, 0);
    this.viewDirection.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.target.copy(this.camera.position).add(this.viewDirection);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    const textures = this.simulation.textures;
    this.uniforms.uLongWaves.value = textures[0];
    this.uniforms.uShortWaves.value = textures[1];
    this.uniforms.uTime.value = this.time;
    this.uniforms.uSwell.value = this.swell;
    this.uniforms.uWind.value = this.wind;
    this.renderer.info.reset();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (this.captureNextFrame) {
      this.canvas.toBlob(this.captureNextFrame, 'image/png');
      this.captureNextFrame = null;
    }
    this.measureTime += elapsed;
    this.measureFrames++;
    if (this.measureTime >= 2.5) {
      this.fps = this.measureFrames / this.measureTime;
      if (this.quality === 'auto' && this.frames > 80) {
        if (this.fps < 27 && this.automaticScale > 0.55) { this.automaticScale = Math.max(0.55, this.automaticScale * 0.82); this.resize(); }
        else if (this.fps > 56 && this.automaticScale < 1) { this.automaticScale = Math.min(1, this.automaticScale + 0.08); this.resize(); }
      }
      this.measureTime = 0; this.measureFrames = 0;
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  resize(): void {
    const width = window.innerWidth, height = window.innerHeight;
    const scale = { auto: this.automaticScale, high: 1.25, medium: 0.9, low: 0.6 }[this.quality];
    const ratio = Math.min(window.devicePixelRatio, 1.8) * scale;
    const budgetRatio = Math.min(ratio, Math.sqrt(3200000 / (width * height)));
    this.renderer.setPixelRatio(budgetRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: Quality): void { this.quality = quality; this.resize(); }
  setWind(wind: number): void {
    this.wind = Math.max(2, Math.min(18, wind));
    this.simulation.setWind(this.wind);
    if (this.paused) this.simulation.advance(this.time, 0, this.swell, this.uniforms.uChoppiness.value);
  }
  setSwell(swell: number): void {
    this.swell = Math.max(0.3, Math.min(2, swell));
    if (this.paused) this.simulation.advance(this.time, 0, this.swell, this.uniforms.uChoppiness.value);
  }
  setPreset(name: PresetName): void {
    const p = presets[name];
    this.setWind(p.wind);
    this.setSwell(p.swell);
    this.targetHeight = p.height;
    this.uniforms.uSunDirection.value.set(...p.sun).normalize();
    this.uniforms.uSunColor.value.set(...p.sunColor);
    this.uniforms.uZenith.value.set(...p.zenith);
    this.uniforms.uHorizon.value.set(...p.horizon);
    this.uniforms.uCloudColor.value.set(...p.cloud);
    this.uniforms.uWaterTint.value.set(...p.water);
    this.uniforms.uCloudCoverage.value = p.coverage;
    this.uniforms.uExposure.value = p.exposure;
    this.uniforms.uStorm.value = p.storm;
  }
  resetView(): void { this.targetYaw = 0; this.targetPitch = -0.075; this.targetHeight = 3.6; }
  capture(): Promise<Blob | null> {
    return new Promise(resolve => { this.captureNextFrame = resolve; });
  }
  get diagnostics() {
    return { time: this.time, frames: this.frames, fps: Number(this.fps.toFixed(1)), paused: this.paused,
      wind: this.wind, swell: this.swell, quality: this.quality,
      resolution: [this.canvas.width, this.canvas.height],
      camera: { yaw: this.yaw, pitch: this.pitch, height: this.height },
      programs: this.renderer.info.programs?.length,
    };
  }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.abort.abort();
    this.simulation.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.materials.forEach(material => material.dispose());
    this.renderer.dispose();
    this.captureNextFrame?.(null);
  }
}
