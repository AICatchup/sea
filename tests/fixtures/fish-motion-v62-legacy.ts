// Immutable oracle copied from dd2f5eb:src/world/fish-motion.ts.
/** CPU swimming state. Terrain is sampled at <= 2cm along every accepted move. */
export interface FishPose { x: number; y: number; z: number; heading: number; }
export interface FishMotion extends FishPose { time: number; turn: number; blockedSteps: number; }
export const FISH_MOTION_LIMITS = { speed: 1.6, verticalSpeed: 0.6, turnRate: 1.8, maxStep: 0.1, sampleSpacing: 0.02 } as const;
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
type Height = (x: number, z: number) => number;
export function fishSegmentClear(from: FishPose, to: FishPose, clearance: number, height: Height): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / FISH_MOTION_LIMITS.sampleSpacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n, bottom = height(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (!Number.isFinite(bottom) || bottom > -0.65 || from.y + (to.y - from.y) * t < bottom + clearance - 1e-8) return false;
  }
  return true;
}
export function createFishMotion(initial: FishPose, time = 0): FishMotion {
  return { ...initial, time, turn: 1, blockedSteps: 0 };
}
/** No catch-up on a clock jump/reversal: retain the last valid pose and rebase time. */
export function advanceFishMotion(state: FishMotion, target: FishPose, time: number, clearance: number, height: Height): void {
  if (!Number.isFinite(time)) return;
  const elapsed = time - state.time; state.time = time;
  if (elapsed <= 0 || elapsed > FISH_MOTION_LIMITS.maxStep + 1e-8) return;
  const dt = Math.min(elapsed, FISH_MOTION_LIMITS.maxStep);
  if (![target.x, target.y, target.z, target.heading].every(Number.isFinite)) return;
  const distance = Math.hypot(target.x - state.x, target.z - state.z);
  const desired = distance > 0.005 ? Math.atan2(target.z - state.z, target.x - state.x) : target.heading;
  const maxTurn = FISH_MOTION_LIMITS.turnRate * dt;
  const heading = state.heading + clamp(angleDifference(desired, state.heading), -maxTurn, maxTurn);
  const step = Math.min(FISH_MOTION_LIMITS.speed * dt, distance);
  const bottomHere = height(state.x, state.z);
  // An unavailable sample must never overwrite the last finite pose.
  if (!Number.isFinite(bottomHere)) return;
  const desiredY = clamp(Math.max(target.y, bottomHere + clearance), bottomHere + clearance, -0.3);
  const y = state.y + clamp(desiredY - state.y, -FISH_MOTION_LIMITS.verticalSpeed * dt, FISH_MOTION_LIMITS.verticalSpeed * dt);
  const candidate = { x: state.x + Math.cos(heading) * step, z: state.z + Math.sin(heading) * step, y, heading };
  const ahead = { ...candidate, x: candidate.x + Math.cos(heading) * 0.35, z: candidate.z + Math.sin(heading) * 0.35 };
  if (fishSegmentClear(state, candidate, clearance, height) && (state.blockedSteps === 0 || fishSegmentClear(candidate, ahead, clearance, height))) {
    Object.assign(state, candidate); state.blockedSteps = 0; return;
  }
  // Turn in place before continuing around the obstruction. Keep one turning side
  // until swimming resumes, avoiding alternating frame-by-frame shore bounces.
  if (state.blockedSteps === 0) {
    const left = { ...state, x: state.x + Math.cos(state.heading + 0.7) * 0.35, z: state.z + Math.sin(state.heading + 0.7) * 0.35 };
    const right = { ...state, x: state.x + Math.cos(state.heading - 0.7) * 0.35, z: state.z + Math.sin(state.heading - 0.7) * 0.35 };
    state.turn = fishSegmentClear(state, left, clearance, height) ? 1 : fishSegmentClear(state, right, clearance, height) ? -1 : state.turn;
  }
  state.blockedSteps++;
  const avoidanceHeading = state.heading + state.turn * maxTurn;
  const avoidance = { x: state.x + Math.cos(avoidanceHeading) * step, z: state.z + Math.sin(avoidanceHeading) * step, y, heading: avoidanceHeading };
  const lookahead = { ...avoidance, x: avoidance.x + Math.cos(avoidanceHeading) * 0.35, z: avoidance.z + Math.sin(avoidanceHeading) * 0.35 };
  if (fishSegmentClear(state, avoidance, clearance, height) && fishSegmentClear(avoidance, lookahead, clearance, height)) Object.assign(state, avoidance);
  else {
    state.heading = avoidanceHeading;
    const rise = { ...state, y };
    if (fishSegmentClear(state, rise, clearance, height)) state.y = y;
  }
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
}
