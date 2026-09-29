import * as THREE from 'three';
import { OceanSimulation } from '../src/ocean/fft';

// Independent closed-form waves exercise packing, transform signs, both axes,
// Nyquist partners, and time evolution; no CPU copy of the FFT is used.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.info.autoReset = false;
const simulation = new OceanSimulation(renderer, 7.5);
const results: Record<string, unknown> = {};
const read = (cascade = simulation.cascades[0]) => {
  const raw = new Uint16Array(cascade.size * cascade.size * 4);
  renderer.readRenderTargetPixels(cascade.displacement[cascade.output], 0, 0, cascade.size, cascade.size, raw);
  return Float32Array.from(raw, THREE.DataUtils.fromHalfFloat);
};
const heightDifference = (a: Float32Array, b: Float32Array) => {
  let difference = 0;
  for (let i = 1; i < a.length; i += 4) difference = Math.max(difference, Math.abs(a[i] - b[i]));
  return difference;
};
try {
  const cascade = simulation.cascades[0];
  const { size, length } = cascade;
  let maxError = 0;
  for (const [kx, kz] of [[3, 4], [-5, 2], [0, 7], [-size / 2, 5], [7, -size / 2]]) {
    const spectrum = new Float32Array(size * size * 4);
    const amp = 0.5;
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
    for (const time of [0, 7.3, 142.5]) {
      simulation.advance(time, 0, 1, 1.55);
      const data = read();
      const magnitude = Math.hypot(kx, kz);
      const omega = Math.sqrt(9.81 * magnitude * 2 * Math.PI / length);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const phase = 2 * Math.PI * (kx * x + kz * y) / size + omega * time;
        const expected = [kx === -size / 2 ? 0 : -amp * kx / magnitude * Math.sin(phase),
          amp * Math.cos(phase), kz === -size / 2 ? 0 : -amp * kz / magnitude * Math.sin(phase)];
        const i = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(data[i + c] - expected[c]));
      }
    }
  }
  if (maxError > 0.001) throw new Error('Analytic Fourier-mode mismatch: ' + maxError);
  results.analyticModes = { modes: 5, times: 3, components: 3, maxError };

  simulation.setWind(7.5);
  renderer.info.reset();
  simulation.advance(34, 0, 1, 1.55);
  const calls = renderer.info.render.calls;
  if (calls !== 34) throw new Error('Unexpected FFT draw count: ' + calls);
  results.performance = { drawsPerAdvance: calls, transformTargets: simulation.cascades.reduce((n, c) => n + c.fields.length, 0) };
  const before = read();
  simulation.setWind(18);
  simulation.advance(34, 0.0001, 1, 1.55);
  const windStep = heightDifference(before, read());
  simulation.advance(34.3, 0.3, 1, 1.55);
  const beforeRetarget = read();
  simulation.setWind(2);
  simulation.advance(34.3, 0.0001, 1, 1.55);
  const retargetStep = heightDifference(beforeRetarget, read());
  if (Math.max(windStep, retargetStep) > 0.002) throw new Error('Wind retarget introduced a discontinuous wave jump');
  simulation.advance(34.3, 0, 1, 1.55);
  if (simulation.cascades.some(c => c.blend !== 1)) throw new Error('Paused wind update did not reach its target');
  results.windContinuity = { windStep, retargetStep, pausedTargetReached: true };

  const states = [];
  for (const wind of [2, 7.5, 18]) {
    simulation.setWind(wind);
    simulation.advance(34, 0, 1, 1.55);
    for (let frame = 0; frame < 150; frame++) simulation.advance(34 + frame / 30, 1 / 30, 1, 1.55);
    const cascades = simulation.cascades.map(c => {
      const pixels = read(c);
      let heightSquares = 0, foam = 0, meanHeight = 0, maxHeight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        for (let channel = 0; channel < 4; channel++) if (!Number.isFinite(pixels[i + channel])) throw new Error('Non-finite GPU output');
        const height = pixels[i + 1], white = pixels[i + 3];
        if (white < 0 || white > 1) throw new Error('Foam outside its coverage range');
        heightSquares += height * height; meanHeight += height; foam += white; maxHeight = Math.max(maxHeight, Math.abs(height));
      }
      const mean = meanHeight / c.size ** 2;
      if (Math.abs(mean) > 0.0001) throw new Error('Spurious DC height offset');
      return { size: c.size, length: c.length, rmsHeight: Math.sqrt(heightSquares / c.size ** 2),
        meanHeight: mean, foamMean: foam / c.size ** 2, maxHeight };
    });
    states.push({ wind, cascades });
  }
  if (states[0].cascades[1].rmsHeight > 0.008 || states[0].cascades[1].foamMean > 0.001) throw new Error('Low wind has excessive ripples or whitecaps');
  if (states[2].cascades[1].foamMean <= states[1].cascades[1].foamMean) throw new Error('Strong wind did not increase breaking waves');
  results.windStates = states;
  simulation.setWind(2);
  simulation.advance(39, 0, 1, 1.55);
  const calm = read(simulation.cascades[1]);
  let calmFoam = 0;
  for (let i = 3; i < calm.length; i += 4) calmFoam += calm[i];
  const calmFoamMean = calmFoam / simulation.cascades[1].size ** 2;
  if (calmFoamMean > 0.0001) throw new Error('Paused calm wind retained obsolete storm foam');
  results.pausedFoamReset = { calmFoamMean };
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.error = String(error);
} finally {
  simulation.dispose(); renderer.dispose();
  document.getElementById('result')!.textContent = JSON.stringify(results, null, 2);
  Object.assign(window, { __gpuResults: results });
}
