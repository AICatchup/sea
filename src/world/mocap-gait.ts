import * as THREE from 'three';

/**
 * Looping gait clips baked from the CMU motion capture database by
 * scripts/bake-cmu-mocap.ts. Each sample stores, per bone, the local quaternion relative
 * to the game parent bone (game rest rotations are identity).
 */
export const MOCAP_BONES = [
  'pelvis@C', 'lumbar@C', 'chest@C',
  'left shoulder@L', 'left elbow@L', 'left wrist@L', 'right shoulder@R', 'right elbow@R', 'right wrist@R',
  'left hip@L', 'left knee@L', 'left ankle@L', 'right hip@R', 'right knee@R', 'right ankle@R',
] as const;
export type MocapClipName = 'walk' | 'run' | 'swim';
export interface MocapClip { samples: number; quaternions: number[]; cycleSeconds: number; cycles: number; footLiftLegLengths: number[]; source: string }
export interface MocapGaitData { format: string; bones: readonly string[]; clips: Record<MocapClipName, MocapClip>; provenance: Record<string, unknown> }

export const MOCAP_URL = new URL('../assets/player/cmu-mocap-v65/gait-clips.json', import.meta.url).href;
export async function loadMocapGait(): Promise<MocapGaitData> {
  const response = await fetch(MOCAP_URL);
  if (!response.ok) throw new Error(`mocap gait ${response.status}`);
  return validateMocapGait(await response.json());
}
export function validateMocapGait(data: MocapGaitData): MocapGaitData {
  if (data.format !== 'sea-mocap-gait-v1' || data.bones.join() !== MOCAP_BONES.join()) throw new Error('mocap gait: unexpected format or bone order');
  for (const name of ['walk', 'run', 'swim'] as const) {
    const clip = data.clips[name];
    if (!clip || clip.quaternions.length !== clip.samples * MOCAP_BONES.length * 4 || !clip.quaternions.every(Number.isFinite)
      || clip.footLiftLegLengths?.length !== clip.samples || !clip.footLiftLegLengths.every(Number.isFinite)) throw new Error(`mocap gait: bad ${name} clip`);
  }
  return data;
}

/** Lowest foot above the floor at `cycle`, in leg lengths (0 in stance, >0 in flight). */
export function mocapFootLift(clip: MocapClip, cycle: number): number {
  const t = ((cycle % 1) + 1) % 1 * clip.samples, i = Math.floor(t) % clip.samples, f = t - Math.floor(t);
  const lift = clip.footLiftLegLengths;
  return lift[i] + (lift[(i + 1) % clip.samples] - lift[i]) * f;
}

const a = new THREE.Quaternion(), b = new THREE.Quaternion();
/** Writes the clip pose at `cycle` (0..1, wraps) into `out` (one quaternion per bone). */
export function sampleMocapClip(clip: MocapClip, cycle: number, out: THREE.Quaternion[]): void {
  const t = ((cycle % 1) + 1) % 1 * clip.samples, i = Math.floor(t) % clip.samples, j = (i + 1) % clip.samples, f = t - Math.floor(t);
  const q = clip.quaternions, stride = MOCAP_BONES.length * 4;
  for (let k = 0; k < MOCAP_BONES.length; k++) {
    a.fromArray(q, i * stride + k * 4); b.fromArray(q, j * stride + k * 4);
    out[k].slerpQuaternions(a, b, f).normalize();
  }
}
