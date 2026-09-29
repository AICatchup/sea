import * as THREE from 'three';
import { OceanSimulation } from '../src/ocean/fft';

// Integration check against an analytic Fourier mode, independently of the shader algorithm.
const renderer = new THREE.WebGLRenderer({ antialias: false });
const simulation = new OceanSimulation(renderer, 7.5);
const results: Record<string, unknown> = {};
try {
  const cascade = simulation.cascades[0];
  const { size } = cascade;
  const spectrum = new Float32Array(size * size * 4);
  const amp = 0.5, kx = 3, kz = 4;
  const index = (((size / 2 + kz) % size) * size + (size / 2 + kx) % size) * 4;
  spectrum[index] = size * size * amp * 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const mirror = (((size - y) % size) * size + (size - x) % size) * 4;
    spectrum[i + 2] = spectrum[mirror]; spectrum[i + 3] = spectrum[mirror + 1];
  }
  cascade.spectrum.dispose();
  cascade.spectrum = new THREE.DataTexture(spectrum, size, size, THREE.RGBAFormat, THREE.FloatType);
  cascade.spectrum.needsUpdate = true;
  simulation.advance(0, 0, 1, 1.55);
  const data = new Uint16Array(size * size * 4);
  renderer.readRenderTargetPixels(cascade.displacement[cascade.output], 0, 0, size, size, data);
  let maxError = 0, sumSquares = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const phase = 2 * Math.PI * (kx * x + kz * y) / size;
    const expected = [-amp * (kx / 5) * Math.sin(phase), amp * Math.cos(phase), -amp * (kz / 5) * Math.sin(phase)];
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(THREE.DataUtils.fromHalfFloat(data[i + c]) - expected[c]));
    sumSquares += THREE.DataUtils.fromHalfFloat(data[i + 1]) ** 2;
  }
  if (maxError > 0.001) throw new Error(`Analytic Fourier-mode mismatch: ${maxError}`);
  results.analyticMode = { maxError, rms: Math.sqrt(sumSquares / (size * size)), expectedRms: amp / Math.sqrt(2) };

  simulation.setWind(7.5);
  for (let frame = 0; frame < 150; frame++) simulation.advance(34 + frame / 30, 1 / 30, 1, 1.55);
  results.cascades = simulation.cascades.map(c => {
    const pixels = new Uint16Array(c.size * c.size * 4);
    renderer.readRenderTargetPixels(c.displacement[c.output], 0, 0, c.size, c.size, pixels);
    let heightSquares = 0, foam = 0, meanHeight = 0, maxHeight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const height = THREE.DataUtils.fromHalfFloat(pixels[i + 1]);
      const white = THREE.DataUtils.fromHalfFloat(pixels[i + 3]);
      if (!Number.isFinite(height) || !Number.isFinite(white)) throw new Error('Non-finite GPU output');
      heightSquares += height * height; meanHeight += height; foam += white; maxHeight = Math.max(maxHeight, Math.abs(height));
    }
    return { size: c.size, length: c.length, rmsHeight: Math.sqrt(heightSquares / c.size ** 2),
      meanHeight: meanHeight / c.size ** 2, foamMean: foam / c.size ** 2, maxHeight };
  });
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.error = String(error);
} finally {
  simulation.dispose(); renderer.dispose();
  document.getElementById('result')!.textContent = JSON.stringify(results, null, 2);
  Object.assign(window, { __gpuResults: results });
}
