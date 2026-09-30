import type * as THREE from 'three';

/** World metres: X east, Z south, Y above mean sea level; origin = Tomari beach. */
export const GEO_ORIGIN = { lat: 34.3359808, lon: 139.2117451 };
export function geoToWorld(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - GEO_ORIGIN.lon) * 111320 * Math.cos(GEO_ORIGIN.lat * Math.PI / 180),
    z: (GEO_ORIGIN.lat - lat) * 111320 };
}
export function worldToGeo(x: number, z: number): { lat: number; lon: number } {
  return { lat: GEO_ORIGIN.lat - z / 111320,
    lon: GEO_ORIGIN.lon + x / (111320 * Math.cos(GEO_ORIGIN.lat * Math.PI / 180)) };
}
export interface GroundSampler {
  heightAt(x: number, z: number): number;
  bodySegmentBlocked?(from:{x:number;y:number;z:number},to:{x:number;y:number;z:number},radius?:number,bodyHeight?:number):boolean;
  /** Feet-space capsule sweep. A direction gives the capsule axis for a swimming pose. */
  sweepBody?(from: BodyPoint, to: BodyPoint, radius?: number, height?: number, pose?: BodyPose): BodySweep;
  /** Highest walkable solid surface at/below feetY + maxRise, or null when absent. */
  supportHeightAt?(x: number, z: number, feetY: number, maxRise?: number, radius?: number): number | null;
  /** Correct a newly introduced overlap locally; maxPush bounds displacement per call. */
  resolveBody?(feet: BodyPoint, radius?: number, height?: number, maxPush?: number, pose?: BodyPose): BodyPoint;
}
export interface BodyPoint { x: number; y: number; z: number; }
export interface BodyPose { direction: BodyPoint; }
export interface BodySweep {
  position: BodyPoint;
  fraction: number;
  blocked: boolean;
  normal: BodyPoint;
  colliderId?: number;
}
export const PLAYER_DIMENSIONS = { height: 1.75, eyeHeight: 1.64, radius: .25 } as const;
export type TravelMode = 'walk' | 'swim' | 'dive' | 'boat';
export type PlaceableKind = 'chair' | 'umbrella' | 'buoy' | 'tank' | 'rock' | 'pine';
export interface WorldDestination {
  id: string; label: string; island: string;
  x: number; z: number; heading: number;
  landingX?: number; landingZ?: number;
}
export interface AdventureState {
  mode: TravelMode;
  position: THREE.Vector3;
  yaw: number; pitch: number;
  speed: number; oxygen: number; depth: number;
  boatPosition: THREE.Vector3; boatYaw: number;
  voyageTarget: string | null; voyageRemaining: number;
  message: string;
  stamina?: number;
  grounded?: boolean;
  immersion?: number;
  gaitPhase?: number;
  viewOffset?: THREE.Vector3;
  velocity?: THREE.Vector3;
  interactionLabel?: string;
  boardingProgress?: number;
  avatarAction?: 'idle' | 'walk' | 'run' | 'swim' | 'dive' | 'helm' | 'climb';
  boatPitch?: number;
  boatRoll?: number;
}
export interface MapOutline { id: string; label: string; points: [number, number][]; }
export interface AdventureCallbacks {
  /** Optional legacy/developer hooks; the playing interface has no mode or teleport buttons. */
  mode?(mode: TravelMode): void;
  home?(): void;
  interact?(): void;
  navigate(id: string): void;
  place(kind: PlaceableKind): void;
  undo(): void;
  move(x: number, forward: number): void;
  vertical(direction: number): void;
}
