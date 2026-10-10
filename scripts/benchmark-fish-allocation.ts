import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { advanceFishMotion, createFishMotion } from '../src/world/fish-motion.ts';
import { advanceFishMotion as legacy } from '../tests/fixtures/fish-motion-v62-legacy.ts';

const fishCount = 255, frames = 1200, runs = 12;
function run(optimized: boolean, shore: boolean) {
  const states = Array.from({ length: fishCount }, (_, i) => createFishMotion({ x: 7, z: 0, y: -1.5, heading: Math.PI / 2 }));
  const scratch = { x: 0, z: 0, y: 0, heading: 0 };
  const ground = { heightAt: (_x: number, z: number) => shore && z > 3.4 ? -0.2 : -4 };
  const height = (x: number, z: number) => ground.heightAt(x, z);
  const fn = optimized ? advanceFishMotion : legacy;
  let blockedEvents = 0;
  const start = performance.now();
  for (let frame = 1; frame <= frames; frame++) for (let i = 0; i < fishCount; i++) {
    const t = frame / 60, phase = t * 0.13 + i * 0.001;
    const target = optimized ? scratch : { x: 0, z: 0, y: 0, heading: 0 };
    target.x = Math.cos(phase) * 7; target.z = Math.sin(phase) * 3.5;
    target.y = -1.5 + Math.sin(t * 0.6 + i * 0.001) * 0.24;
    target.heading = Math.atan2(Math.cos(phase) * 0.5, -Math.sin(phase));
    fn(states[i], target, t, 0.23, optimized ? height : (x, z) => ground.heightAt(x, z));
    if (states[i].blockedSteps) blockedEvents++;
  }
  return { milliseconds: performance.now() - start, blockedEvents, checksum: states.reduce((sum, s) => sum + s.x + s.y + s.z + s.heading + s.blockedSteps, 0) };
}
const results: any[] = [];
for (const shore of [false, true]) {
  for (let warmup = 0; warmup < 6; warmup++) { run(warmup % 2 === 0, shore); run(warmup % 2 !== 0, shore); }
  const paired = [];
  for (let i = 0; i < runs; i++) {
    const first = run(i % 2 === 0, shore), second = run(i % 2 !== 0, shore);
    const old = i % 2 === 0 ? second : first, current = i % 2 === 0 ? first : second;
    if (old.blockedEvents !== current.blockedEvents || !Object.is(old.checksum, current.checksum)) throw new Error('checksum mismatch');
    paired.push({ old, current, order: i % 2 === 0 ? 'current-old' : 'old-current' });
  }
  const median = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return (sorted[5] + sorted[6]) / 2; };
  const oldMedian = median(paired.map(p => p.old.milliseconds)), currentMedian = median(paired.map(p => p.current.milliseconds));
  results.push({ terrain: shore ? 'nearshore' : 'deepwater', paired, oldMedian, currentMedian, reductionPercent: (1-currentMedian/oldMedian)*100 });
}
const receipt = { node: process.version, fishCount, frames, runs, warmupPairs: 6, scope: 'CPU fish kernel including target/callback allocation model; no renderer/GPU/FPS measurement', results };
writeFileSync('work/fish-allocation-benchmark.json', JSON.stringify(receipt, null, 2), 'utf8');
console.log(JSON.stringify(receipt, null, 2));
