/** Perceptual sound targets, not measured acoustics. Units: metres, seconds, radians.
 * Yaw 0 faces north (-Z), +PI/2 east (+X). Wind direction is the air travel yaw.
 * Feed one frame per simulation update; time is descriptive, never an event clock.
 */
export interface SoundscapeFrame {
  dt: number; time: number; mode: 'walk' | 'swim' | 'dive' | 'boat';
  position: {x: number; y: number; z: number};
  velocity: {x: number; y: number; z: number}; yaw: number;
  depth: number; immersion: number; grounded: boolean;
  /** Accumulated radians, with footfalls crossing 0 and PI each cycle. */
  gaitPhase: number;
  boat: {pitch: number; roll: number; speed: number};
  environment: {windSpeed: number; windDirection: number};
  wave: {ready: boolean; level: number; slope: number; shoreDistance?: number; shoreStrength?: number};
}
export interface SoundEvent {amplitude: number; variation: number; pan: number}
export interface SoundscapeTargets {
  wind: number; surf: number; hullwash: number; creak: number; engine: number;
  swim: number; breath: number; bubbles: number;
  footsteps: SoundEvent[]; bird: SoundEvent | null;
  cutoffHz: number; windCutoffHz: number; pan: number; enginePitch: number;
  relativeWindSpeed: number; airTransmission: number;
}
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, finite(n)));
const phase = (n: number) => ((finite(n) / (2 * Math.PI) % 1) + 1) % 1;
const smooth = (n: number) => {const x = clamp(n); return x * x * (3 - 2 * x);};

export class SoundscapeState {
  private seed: number;
  private previous: SoundscapeFrame | null = null;
  private birdRemaining = 12;
  constructor(seed = 0x534541) {this.seed = finite(seed, 1) >>> 0;}
  /** Explicit lifecycle reset; does not alter the deterministic random sequence. */
  reset(): void {this.previous = null; this.birdRemaining = 12;}
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  update(f: SoundscapeFrame): SoundscapeTargets {
    const dt = finite(f.dt), active = dt > 0 && dt <= .5;
    const v = f.velocity, yaw = finite(f.yaw), direction = finite(f.environment.windDirection);
    const windSpeed = clamp(f.environment.windSpeed, 0, 50);
    const rx = Math.sin(direction) * windSpeed - finite(v.x);
    const rz = -Math.cos(direction) * windSpeed - finite(v.z);
    const relativeWindSpeed = Math.min(100, Math.hypot(rx, rz));
    const speed = Math.min(100, Math.hypot(finite(v.x), finite(v.y), finite(v.z)));
    const boatSpeed = clamp(Math.abs(finite(f.boat.speed)), 0, 30);
    const wet = clamp(f.immersion), depth = clamp(f.depth, 0, 100);
    const airTransmission = 1 - smooth(Math.max(wet, depth / .35));
    const shore = f.wave.ready ? (f.wave.shoreStrength === undefined
      ? 1 - smooth(clamp(finite(f.wave.shoreDistance ?? 100) / 70))
      : clamp(f.wave.shoreStrength)) : 0;
    const roughness = f.wave.ready ? clamp(Math.abs(finite(f.wave.slope)) * 1.5) : 0;
    const waterMotion = clamp(speed / 3);
    const aboard = f.mode === 'boat';
    const p = this.previous;
    const jump = p !== null && Math.hypot(finite(f.position.x) - p.position.x,
      finite(f.position.y) - p.position.y, finite(f.position.z) - p.position.z) > 12;
    const transition = !p || p.mode !== f.mode || jump;
    const pan = relativeWindSpeed > .001 ? clamp((rx * Math.cos(yaw) + rz * Math.sin(yaw)) / relativeWindSpeed, -1, 1) : 0;
    let rocking = 0;
    if (active && !transition && p) rocking = clamp((Math.abs(finite(f.boat.pitch) - p.boat.pitch)
      + Math.abs(finite(f.boat.roll) - p.boat.roll)) / dt / 1.8);
    const out: SoundscapeTargets = {
      wind: clamp(Math.pow(relativeWindSpeed / 20, 1.4) * airTransmission * (.2 + .8 * shore)),
      surf: clamp(shore * (.12 + .4 * windSpeed / 20 + .25 * roughness) * airTransmission),
      hullwash: aboard ? clamp((boatSpeed / 10 * .6 + roughness * .18) * airTransmission) : 0,
      creak: aboard ? clamp(rocking * .55 * airTransmission) : 0,
      engine: aboard ? clamp((.08 + .62 * smooth(boatSpeed / 12)) * airTransmission) : 0,
      swim: (f.mode === 'swim' || f.mode === 'dive') ? clamp(waterMotion * wet * .55) : 0,
      breath: f.mode === 'swim' ? clamp(.12 * airTransmission * wet) : 0,
      bubbles: (f.mode === 'swim' || f.mode === 'dive') ? clamp(wet * (1 - airTransmission) * waterMotion * .4) : 0,
      footsteps: [], bird: null, cutoffHz: 350 + 13650 * airTransmission,
      windCutoffHz: 600 + 7400 * clamp(relativeWindSpeed / 25) * airTransmission,
      pan, enginePitch: .65 + .9 * smooth(boatSpeed / 12), relativeWindSpeed, airTransmission,
    };
    if (active) {
      if (!transition && p && f.mode === 'walk' && f.grounded && wet < .2 && speed > .15) {
        const before = phase(p.gaitPhase), now = phase(f.gaitPhase);
        const advance = (finite(f.gaitPhase) - p.gaitPhase) / (2 * Math.PI);
        // Reject backward/discontinuous gait jumps; emit at most one footfall per frame.
        if (advance > 0 && advance <= .5 && Math.floor(before * 2) !== Math.floor(now * 2)) {
          out.footsteps.push({amplitude: clamp((.12 + speed / 6) * airTransmission), variation: this.random(), pan: now < .5 ? -.15 : .15});
        }
      }
      // Count only audible habitat time: no timestamp catch-up after a pause/teleport.
      if (!transition && shore > .35 && airTransmission > .9 && f.mode !== 'dive') {
        this.birdRemaining -= dt;
        if (this.birdRemaining <= 0) {
          out.bird = {amplitude: .08 + .12 * shore, variation: this.random(), pan: this.random() * 2 - 1};
          this.birdRemaining = 14 + this.random() * 24;
        }
      }
      if (transition) this.birdRemaining = Math.max(12, this.birdRemaining);
    }
    // Snapshot pose on every call, including paused frames, to avoid resume derivatives.
    this.previous = {...f, position: {x: finite(f.position.x), y: finite(f.position.y), z: finite(f.position.z)},
      boat: {pitch: finite(f.boat.pitch), roll: finite(f.boat.roll), speed: boatSpeed}, gaitPhase: finite(f.gaitPhase)};
    return out;
  }
}
