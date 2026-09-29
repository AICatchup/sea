import { geoToWorld, type WorldDestination } from './contracts.ts';

/** Visitor-map markers. Arrival points are snapped to navigable DEM water by IslandWorld. */
export const DESTINATION_SEEDS: readonly WorldDestination[] = [
  { id: 'tomari', label: '泊海水浴場', island: '式根島', x: -64, z: -70, heading: -.60, landingX: -36, landingZ: 27 },
  { id: 'nakanoura', label: '中の浦海水浴場', island: '式根島', ...geoToWorld(34.32809021013709, 139.20552297599966), heading: 1.15 },
  { id: 'niijima', label: '新島・前浜', island: '新島', ...geoToWorld(34.3658, 139.2450), heading: 1.57 },
  { id: 'kozushima', label: '神津島・前浜', island: '神津島', ...geoToWorld(34.2050, 139.1325), heading: 1.57 },
];

export const LOCATION_PROVENANCE = {
  tomari: 'User-selected Google place origin and GSI DEM shoreline; sandy rear shore arrival is an artistic refinement.',
  nakanoura: '式根島観光協会 embedded visitor map: https://shikinejima.tokyo/play/beach/nakanoura_beach/',
  niijima: 'Approximate west-coast Maehama visitor arrival, snapped to the GSI DEM coast; not an operational harbour waypoint.',
  kozushima: 'Approximate west-coast Maehama visitor arrival, snapped to the GSI DEM coast; not an operational harbour waypoint.',
} as const;
