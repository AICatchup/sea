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
export interface GroundSampler { heightAt(x: number, z: number): number; }
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
  mode(mode: TravelMode): void;
  home(): void;
  navigate(id: string): void;
  place(kind: PlaceableKind): void;
  undo(): void;
  move(x: number, forward: number): void;
  vertical(direction: number): void;
}
