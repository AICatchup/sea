/** A visual-only capture seam: locked bookmarks do not prove travel or Human acceptance. */
export type CapturePose = { x: number; z: number; yaw: number; pitch: number; mode: 'walk' | 'swim' | 'dive'; depth?: number };
export type CaptureState = {
  pose: CapturePose; camera: readonly number[]; width: number; height: number;
  quality: string; preset: string; paused: boolean; locked: boolean;
  hidden: boolean; disposed: boolean;
};
export interface SceneCaptureHost {
  ready: Promise<unknown>;
  readState(): CaptureState;
  /** Synchronously restore exact prior state, including pose and lock; never call home/reset travel. */
  restoreState(state: CaptureState): void;
  setQuality(quality: string): void;
  setPreset(preset: string): void;
  setPaused(paused: boolean): void;
  visualLock(locked: boolean): void;
  viewpoint(x: number, z: number, yaw: number, pitch: number, mode: CapturePose['mode'], depth?: number): void;
  capturePixels(): Promise<string | null>;
  nextFrame(): Promise<void>;
}
export type CaptureProfile = { name: string; pose: CapturePose; provenance: string };
export const CAPTURE_PROFILES: readonly CaptureProfile[] = [
  { name: 'spawn', pose: { x: -36, z: 27, yaw: -.6, pitch: -.03, mode: 'walk' }, provenance: 'QA bookmark' },
  { name: 'shore', pose: { x: -42, z: 9, yaw: -.56, pitch: -.24, mode: 'walk' }, provenance: 'QA bookmark' },
  { name: 'cliff', pose: { x: -86, z: -22, yaw: -1.6, pitch: .1, mode: 'walk' }, provenance: 'QA bookmark' },
  { name: 'lookout', pose: { x: -25, z: 36, yaw: -.52, pitch: -.25, mode: 'walk' }, provenance: 'QA bookmark' },
  { name: 'reef', pose: { x: -145, z: -113, yaw: -.5, pitch: -.42, mode: 'dive', depth: 5 }, provenance: 'QA bookmark' },
  { name: 'habushi-front', pose: { x: 5837, z: -4503.84, yaw: Math.PI / 2, pitch: -.04, mode: 'walk' }, provenance: 'QA bookmark' },
  { name: 'secret', pose: { x: 5898, z: -923.918, yaw: Math.PI, pitch: -.04, mode: 'walk' }, provenance: 'South-facing QA bookmark near the Niijima municipal Secret surf marker; beach offset authored from the current DEM sampler' },
];
export type CaptureOptions = { quality: string; preset: string; width: number; height: number; timeoutMs?: number; maxFrames?: number; warmupFrames?: number };
export type CaptureResult = { png: string; metadata: { name: string; provenance: string; evidence: 'visual-only'; movementVerified: false; humanAccepted: false; width: number; height: number; camera: number[]; pose: CapturePose; quality: string; preset: string; paused: boolean; locked: boolean } };
const busy = new WeakSet<SceneCaptureHost>();
function live(s: CaptureState): void {
  if (s.hidden || s.disposed) throw new Error('Capture host hidden or disposed');
  if (!s.width || !s.height || !s.camera.length || !s.camera.every(Number.isFinite)) throw new Error('Invalid capture state');
}
function clone(s: CaptureState): CaptureState { return { ...s, pose: { ...s.pose }, camera: [...s.camera] }; }
function same(a: CaptureState, b: CaptureState): boolean {
  return a.width === b.width && a.height === b.height && JSON.stringify(a.camera) === JSON.stringify(b.camera) && JSON.stringify(a.pose) === JSON.stringify(b.pose);
}
async function execute(host: SceneCaptureHost, profiles: readonly CaptureProfile[], options: CaptureOptions, progress?: (result: CaptureResult, index: number) => void | Promise<void>): Promise<CaptureResult[]> {
  if (busy.has(host)) throw new Error('Capture already in flight');
  if (!profiles.length || profiles.length > 7) throw new Error('Capture matrix requires 1..7 profiles');
  if (!(options.width > 0 && options.height > 0)) throw new Error('Expected dimensions required');
  busy.add(host);
  let previous: CaptureState | undefined;
  let pendingCapture: Promise<string | null> | undefined;
  const deadline = Date.now() + Math.min(60000, Math.max(1, options.timeoutMs ?? 15000));
  async function bounded<T>(task: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Capture timeout')), Math.max(0, deadline - Date.now())); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  try {
    await bounded(host.ready);
    previous = clone(host.readState()); live(previous);
    host.visualLock(true); host.setPaused(true); host.setQuality(options.quality); host.setPreset(options.preset);
    const results: CaptureResult[] = [];
    for (const profile of profiles) {
      const p = profile.pose;
      host.viewpoint(p.x, p.z, p.yaw, p.pitch, p.mode, p.depth);
      for(let i=0;i<Math.min(60,Math.max(0,options.warmupFrames??0));i++)await bounded(host.nextFrame());
      let last = clone(host.readState()), stable = 0;
      for (let frame = 0; stable < 2; frame++) {
        if (frame >= Math.min(120, Math.max(2, options.maxFrames ?? 30))) throw new Error('Camera or resolution did not stabilize');
        await bounded(host.nextFrame());
        const current = clone(host.readState()); live(current);
        stable = same(last, current) ? stable + 1 : 0; last = current;
      }
      if (last.width !== options.width || last.height !== options.height) throw new Error(`Capture dimensions ${last.width}x${last.height}; expected ${options.width}x${options.height}`);
      if (!last.locked || !last.paused || last.quality !== options.quality || last.preset !== options.preset) throw new Error('Capture settings changed');
      pendingCapture = host.capturePixels();
      const png = await bounded(pendingCapture);
      pendingCapture = undefined;
      const after = host.readState(); live(after);
      if (!same(last, after)) throw new Error('Camera or resolution changed during capture');
      if (!png?.startsWith('data:image/png;base64,')) throw new Error('Capture returned no PNG');
      const result: CaptureResult = { png, metadata: { name: profile.name, provenance: profile.provenance, evidence: 'visual-only', movementVerified: false, humanAccepted: false, width: last.width, height: last.height, camera: [...last.camera], pose: { ...last.pose }, quality: last.quality, preset: last.preset, paused: last.paused, locked: last.locked } };
      results.push(result);
      if (progress) await bounded(Promise.resolve(progress(result, results.length - 1)));
    }
    return results;
  } finally {
    try { if (previous) host.restoreState(previous); }
    finally {
      // Even a failed/disposed restoration must release the capture-owned lock.
      try { if (previous) host.visualLock(previous.locked); }
      finally {
        if (pendingCapture) void pendingCapture.then(() => busy.delete(host), () => busy.delete(host));
        else busy.delete(host);
      }
    }
  }
}
export function captureNamed(host: SceneCaptureHost, profile: CaptureProfile, options: CaptureOptions): Promise<CaptureResult> {
  return execute(host, [profile], options).then(results => results[0]);
}
export function captureMatrix(host: SceneCaptureHost, options: CaptureOptions, progress?: (result: CaptureResult, index: number) => void | Promise<void>, profiles: readonly CaptureProfile[] = CAPTURE_PROFILES): Promise<CaptureResult[]> {
  return execute(host, profiles, options, progress);
}


