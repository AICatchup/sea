import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrum, type SpectrumOptions } from '../src/ocean/spectrum.ts';

const config: SpectrumOptions = { size: 32, length: 64, wind: 8, seed: 71, minWaveNumber: 0, maxWaveNumber: 1.4, rmsHeight: 0.4 };

test('same seed gives the same finite wave field with no DC height offset', () => {
  const a = createSpectrum(config), b = createSpectrum(config);
  assert.deepEqual(a, b);
  assert.ok(a.every(Number.isFinite));
  const zero = (config.size / 2 * config.size + config.size / 2) * 4;
  assert.deepEqual(Array.from(a.slice(zero, zero + 4)), [0, 0, 0, 0]);
  assert.notDeepEqual(a, createSpectrum({ ...config, seed: 72 }));
});

test('the evolved frequency field is Hermitian, so spatial height is real at every time', () => {
  const { size, length } = config;
  const data = createSpectrum(config);
  for (const time of [0, 7.3, 142.5]) {
    const height = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      const k = Math.hypot(x - size / 2, y - size / 2) * 2 * Math.PI / length;
      const phase = Math.sqrt(9.81 * k) * time;
      const c = Math.cos(phase), s = Math.sin(phase);
      return [(data[i] + data[i + 2]) * c - (data[i + 1] + data[i + 3]) * s,
        (data[i] - data[i + 2]) * s + (data[i + 1] - data[i + 3]) * c];
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = height(x, y), b = height((size - x) % size, (size - y) % size);
      assert.ok(Math.abs(a[0] - b[0]) < 1e-6);
      assert.ok(Math.abs(a[1] + b[1]) < 1e-6);
    }
  }
});

test('Nyquist axes cannot inject an unpaired imaginary horizontal displacement', () => {
  const data = createSpectrum({ ...config, maxWaveNumber: 20 });
  for (let i = 0; i < config.size; i++) {
    assert.deepEqual(Array.from(data.slice(i * 4, i * 4 + 4)), [0, 0, 0, 0]);
    const row = i * config.size * 4;
    assert.deepEqual(Array.from(data.slice(row, row + 4)), [0, 0, 0, 0]);
  }
});

test('wave energy aligns with the wind while retaining crosswind variation', () => {
  const data = createSpectrum(config);
  let energy = 0, alongWind = 0;
  for (let y = 0; y < config.size; y++) for (let x = 0; x < config.size; x++) {
    const kx = x - config.size / 2, kz = y - config.size / 2;
    const squaredK = kx * kx + kz * kz;
    if (squaredK === 0) continue;
    const i = (y * config.size + x) * 4;
    const e = data[i] ** 2 + data[i + 1] ** 2;
    energy += e;
    alongWind += e * (kx * 0.8 + kz * 0.6) ** 2 / squaredK;
  }
  assert.ok(alongWind / energy > 0.65);
  assert.ok(alongWind / energy < 0.95);
});

test('spectral energy is normalized to the requested statistical surface height', () => {
  const data = createSpectrum(config);
  let energy = 0;
  for (let i = 0; i < data.length; i += 4) energy += data[i] ** 2 + data[i + 1] ** 2;
  const rms = Math.sqrt(2 * energy) / config.size ** 2;
  assert.ok(Math.abs(rms - config.rmsHeight) < 1e-6);
  assert.ok(createSpectrum({ ...config, rmsHeight: 0 }).every(value => value === 0));
});

test('invalid transform sizes and physical parameters are rejected', () => {
  for (const size of [0, 3, 15, 2.5]) assert.throws(() => createSpectrum({ ...config, size }));
  for (const length of [0, -1, NaN]) assert.throws(() => createSpectrum({ ...config, length }));
  assert.throws(() => createSpectrum({ ...config, wind: 0 }));
  assert.throws(() => createSpectrum({ ...config, maxWaveNumber: 0 }));
});
