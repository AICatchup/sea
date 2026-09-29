export interface SpectrumOptions {
  size: number;
  length: number;
  wind: number;
  seed: number;
  minWaveNumber: number;
  maxWaveNumber: number;
  rmsHeight: number;
}

/** A deterministic Phillips spectrum. RG = h0(k), BA = h0(-k). */
export function createSpectrum(options: SpectrumOptions): Float32Array {
  const { size, length, wind, seed, minWaveNumber, maxWaveNumber, rmsHeight } = options;
  if (size < 2 || (size & (size - 1)) !== 0 || !Number.isInteger(size)) {
    throw new Error('The FFT size must be a power of two.');
  }
  if (![length, wind, rmsHeight, minWaveNumber, maxWaveNumber].every(Number.isFinite)
      || length <= 0 || wind <= 0 || rmsHeight < 0
      || minWaveNumber < 0 || maxWaveNumber <= minWaveNumber) {
    throw new Error('Invalid ocean spectrum parameters.');
  }
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Float32Array(size * size * 4);
  const waveStep = 2 * Math.PI / length;
  const largestWave = wind * wind / 9.81;
  let energy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The represented Nyquist frequencies have no distinct -k partner.
      // Remove them so height and both odd displacement fields stay Hermitian.
      if (x === 0 || y === 0) continue;
      const kx = (x - size / 2) * waveStep;
      const kz = (y - size / 2) * waveStep;
      const k = Math.hypot(kx, kz);
      if (k < 1e-6) continue;
      const direction = (kx * 0.8 + kz * 0.6) / k;
      // Long waves have a clear wind alignment; ripples spread more widely.
      const spreading = 4 - 2 * smoothstep(0.25, 2.0, k);
      const directional = 0.035 + 0.965 * Math.abs(direction) ** spreading;
      const lowBand = minWaveNumber === 0 ? 1 : smoothstep(minWaveNumber * 0.75, minWaveNumber * 1.25, k);
      const highBand = 1 - smoothstep(maxWaveNumber * 0.75, maxWaveNumber, k);
      const phillips = Math.exp(-1 / (k * largestWave) ** 2) / k ** 4
        * directional * (direction < 0 ? 0.35 : 1)
        * Math.exp(-k * k * 0.003) * lowBand * highBand;
      const gaussianRadius = Math.sqrt(-2 * Math.log(Math.max(1e-9, random())));
      const gaussianAngle = 2 * Math.PI * random();
      const amplitude = Math.sqrt(phillips * 0.5) * waveStep;
      const i = (y * size + x) * 4;
      data[i] = gaussianRadius * Math.cos(gaussianAngle) * amplitude;
      data[i + 1] = gaussianRadius * Math.sin(gaussianAngle) * amplitude;
      energy += data[i] ** 2 + data[i + 1] ** 2;
    }
  }
  // The inverse FFT divides by N². Normalize statistical surface RMS in metres.
  const scale = energy > 0 ? rmsHeight * size * size / Math.sqrt(2 * energy) : 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i] *= scale;
    data[i + 1] *= scale;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const mirror = (((size - y) % size) * size + (size - x) % size) * 4;
      data[i + 2] = data[mirror];
      data[i + 3] = data[mirror + 1];
    }
  }
  return data;
}

function smoothstep(a: number, b: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
