/** Bounded game dynamics. Metres, X east/Z south; yaw 0 north, positive east. */
export type SurfPhase = 'absent' | 'carried' | 'paddling' | 'riding' | 'wipeout';
export interface SurfVector { x: number; z: number }
export interface SurfState {
  phase: SurfPhase; yaw: number; speed: number; balance: number;
  catchWindow: number; movingWave: number; previousWaterHeight: number | null;
  previousPlayerX: number | null; previousPlayerZ: number | null;
  wipeoutTime: number; eyeBlend: number; rideDistance: number; rideTime: number;
  bestDistance: number; bestTime: number;
}
export interface SurfInput {
  dt: number; playerPosition: SurfVector; boardPosition: SurfVector;
  waterHeight: number; waterGradient: SurfVector; waveReady: boolean;
  /** Optional Eulerian water-height derivative (m/s) from the wave cache. */
  waterVerticalVelocity?: number;
  groundDepth: number; shoreward: SurfVector; forward: number; steer: number;
  pickup?: boolean; launch?: boolean; stand?: boolean; recover?: boolean; drop?: boolean;
  yaw?: number;
}
export interface SurfOutput {
  state: SurfState; displacement: SurfVector; velocity: SurfVector;
  boardPitch: number; boardRoll: number; eyeHeight: number; eyeBlend: number;
  swimming: boolean; hint: string;
}
const finite = (v: number, fallback = 0) => Number.isFinite(v) ? v : fallback;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, finite(v)));
const angle = (v: number) => Math.atan2(Math.sin(finite(v)), Math.cos(finite(v)));
export function createSurfState(yaw = 0): SurfState {
  return {phase: 'absent', yaw: angle(yaw), speed: 0, balance: 1, catchWindow: 0,
    movingWave: 0, previousWaterHeight: null, previousPlayerX:null, previousPlayerZ:null, wipeoutTime: 0, eyeBlend: 0,
    rideDistance: 0, rideTime: 0, bestDistance: 0, bestTime: 0};
}
/** Pure step: caller applies displacement only while paddling/riding; never sets camera position. */
export function stepSurfing(previous: SurfState, input: SurfInput): SurfOutput {
  const s: SurfState = {...createSurfState(), ...previous};
  s.yaw = angle(s.yaw); s.speed = clamp(s.speed, 0, 9); s.balance = clamp(s.balance, 0, 1);
  for (const key of ['catchWindow','movingWave','wipeoutTime','eyeBlend','rideDistance','rideTime','bestDistance','bestTime'] as const) s[key] = clamp(s[key], 0, key === 'eyeBlend' ? 1 : 1e7);
  if (!['absent','carried','paddling','riding','wipeout'].includes(s.phase)) s.phase = 'absent';
  const dt = clamp(input.dt, 0, .12), depth = clamp(input.groundDepth, 0, 1000);
  const gx = clamp(input.waterGradient.x, -2, 2), gz = clamp(input.waterGradient.z, -2, 2);
  const water = finite(input.waterHeight);
  const waterValid = input.waveReady && Number.isFinite(input.waterHeight) && Number.isFinite(input.waterGradient.x) && Number.isFinite(input.waterGradient.z);
  // Height difference includes board advection: subtract grad dot last board velocity.
  const playerX=finite(input.playerPosition.x),playerZ=finite(input.playerPosition.z);
  const hasPosition=Number.isFinite(s.previousPlayerX)&&Number.isFinite(s.previousPlayerZ);
  const travelledX=hasPosition?playerX-s.previousPlayerX!:0,travelledZ=hasPosition?playerZ-s.previousPlayerZ!:0;
  const continuous=hasPosition&&Math.hypot(travelledX,travelledZ)<=Math.max(.5,dt*12);
  // Remove motion through the spatial wave using the displacement the world
  // actually accepted. A paused/colliding body may retain nominal board speed.
  const sampledDerivative = dt > 0 && continuous && s.previousWaterHeight !== null && Number.isFinite(s.previousWaterHeight)
    ? (water - s.previousWaterHeight - gx*travelledX - gz*travelledZ) / dt : 0;
  const derivative = clamp(input.waterVerticalVelocity ?? sampledDerivative, -4, 4);
  s.previousWaterHeight = waterValid ? water : null;
  s.previousPlayerX=waterValid?playerX:null;s.previousPlayerZ=waterValid?playerZ:null;
  const slope = Math.hypot(gx, gz);
  const sx = finite(input.shoreward.x), sz = finite(input.shoreward.z), sl = Math.hypot(sx, sz);
  const shore = sl > .001 ? {x: sx / sl, z: sz / sl} : {x: -1, z: 0};
  if (input.drop) { s.phase = 'absent'; s.speed = 0; }
  const distance = Math.hypot(finite(input.playerPosition.x, 1e6) - finite(input.boardPosition.x, -1e6), finite(input.playerPosition.z, 1e6) - finite(input.boardPosition.z, -1e6));
  if (input.pickup && s.phase === 'absent' && distance <= 2.5) {s.phase = 'carried'; s.yaw = angle(input.yaw ?? s.yaw);}
  if ((input.launch && s.phase === 'carried' || input.recover && s.phase === 'wipeout' && s.wipeoutTime >= .8) && depth >= .55 && waterValid) {
    s.phase = 'paddling'; s.speed = 0; s.balance = 1; s.catchWindow = 0; s.movingWave = 0;
  }
  const displacement = {x: 0, z: 0};
  const steps = Math.ceil(dt / .02), h = steps ? dt / steps : 0;
  for (let i = 0; i < steps; i++) {
    const active = s.phase === 'paddling' || s.phase === 'riding';
    if (active) {
      const forward = clamp(input.forward, 0, 1), steer = clamp(input.steer, -1, 1);
      const moving = waterValid && slope >= .035 && Math.abs(derivative) >= .018;
      s.movingWave = moving ? .65 : Math.max(0, s.movingWave - h);
      const dx = Math.sin(s.yaw), dz = -Math.cos(s.yaw);
      const alignment = dx * shore.x + dz * shore.z;
      if (s.phase === 'paddling') {
        s.yaw = angle(s.yaw + steer * .8 * h);
        s.speed += (forward * 2.1 - s.speed * 1.05) * h;
        const catchable = moving && alignment > .55 && s.speed > .7 && depth > .85;
        s.catchWindow = catchable ? .65 : Math.max(0, s.catchWindow - h);
        if (input.stand && i === 0 && waterValid && s.catchWindow > 0 && depth > .85) {
          s.phase = 'riding'; s.speed = Math.max(s.speed, 2.2); s.rideDistance = 0; s.rideTime = 0;
        }
      } else {
        s.yaw = angle(s.yaw + steer * (1.1 / (1 + s.speed * .14)) * h);
        s.balance = clamp(s.balance + (.28 * (1 - Math.abs(steer)) - Math.abs(steer) * s.speed * .22) * h, 0, 1);
        // Drive expires when moving crest evidence disappears; flat water cannot sustain a ride.
        // The renderer delivers water samples at 5 Hz. Retain decaying crest
        // evidence between samples; evaluating only its arrival frame loses drive.
        // A moving wave pushes only from its front face (water higher on the seaward
        // side), plus gravity along the heading: riding down the face accelerates,
        // climbing onto the back of the swell decelerates. Before, slope magnitude
        // alone drove the board, so the back of a wave also accelerated it.
        const evidence = Math.min(1,s.movingWave/.65);
        const face = clamp(-(gx*shore.x+gz*shore.z)/.12, 0, 1), downhill = -(gx*dx+gz*dz);
        const drive = waterValid ? evidence * (2.4 * face * Math.max(0, alignment) + 9.81 * .6 * clamp(downhill, -.6, .6)) : 0;
        s.speed += (drive - .35 * s.speed) * h;
        s.rideTime += h;
        if (s.balance <= .08 || s.speed < .65 || !waterValid) {s.phase = 'wipeout'; s.wipeoutTime = 0; s.speed = 0;}
      }
      s.speed = clamp(s.speed, 0, s.phase === 'paddling' ? 2 : 8);
      if (depth < .8) s.speed *= Math.exp(-5 * h * (1 - depth / .8));
      if (depth < .3) {s.phase = 'carried'; s.speed = 0; s.catchWindow = 0;}
      if (s.phase === 'paddling' || s.phase === 'riding') {
        const travel = s.speed * h;
        displacement.x += Math.sin(s.yaw) * travel; displacement.z -= Math.cos(s.yaw) * travel;
        if (s.phase === 'riding') s.rideDistance += travel;
      }
    }
    if (s.phase === 'wipeout') {
      if(Number.isFinite(input.groundDepth)&&depth<.3){
        s.phase='carried';s.speed=0;s.catchWindow=0;s.movingWave=0;s.wipeoutTime=0;
      }else s.wipeoutTime += h;
    }
    s.bestDistance = Math.max(s.bestDistance, s.rideDistance); s.bestTime = Math.max(s.bestTime, s.rideTime);
    s.eyeBlend += ((s.phase === 'riding' ? 1 : 0) - s.eyeBlend) * (1 - Math.exp(-8 * h));
  }
  const velocity = {x: Math.sin(s.yaw) * s.speed, z: -Math.cos(s.yaw) * s.speed};
  const pitch = Math.atan(gx * Math.sin(s.yaw) + gz * -Math.cos(s.yaw));
  const roll = Math.atan(gx * Math.cos(s.yaw) + gz * Math.sin(s.yaw));
  const hint = s.phase === 'absent' ? 'ボードへ近づいて拾う' : s.phase === 'carried' ? '深さのある海でボードを出す' : s.phase === 'wipeout' ? '泳いで体勢を戻し、再びパドル' : s.phase === 'riding' ? '小さく曲がってバランスを保つ' : s.catchWindow > 0 ? '波をつかんだ！ 立ち上がる' : '岸へ向けてパドルし、動く波を待つ';
  return {state: s, displacement, velocity, boardPitch: clamp(pitch, -.55, .55), boardRoll: clamp(roll - clamp(input.steer, -1, 1) * s.speed * .025, -.5, .5), eyeHeight: .4 + s.eyeBlend * 1.15, eyeBlend: s.eyeBlend, swimming: s.phase === 'wipeout', hint};
}
