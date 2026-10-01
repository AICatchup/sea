import { geoToWorld, type WorldDestination } from './contracts.ts';

/** Visitor-map markers. Arrival points are snapped to navigable DEM water by IslandWorld. */
export const DESTINATION_SEEDS: readonly WorldDestination[] = [
  { id: 'tomari', label: '泊海水浴場', island: '式根島', x: -64, z: -70, heading: -.60, landingX: -36, landingZ: 27 },
  { id: 'nakanoura', label: '中の浦海水浴場', island: '式根島', ...geoToWorld(34.32809021013709, 139.20552297599966), heading: 1.15 },
  { id: 'niijima', label: '新島・前浜', island: '新島', ...geoToWorld(34.3658, 139.2450), heading: 1.57 },
  { id: 'habushi', label: '新島・羽伏浦メインゲート', island: '新島', ...geoToWorld(34.3764393, 139.2755897 + .0011), heading: -1.57 },
  { id: 'horikiri', label: '新島・堀切入口', island: '新島', ...geoToWorld(34.35561844, 139.2758477 + .0011), heading: -1.57 },
  { id: 'secret', label: '新島・シークレット', island: '新島', ...geoToWorld(34.34428046, 139.2757618 + .0011), heading: -1.57 },
  { id: 'kozushima', label: '神津島・前浜', island: '神津島', ...geoToWorld(34.2050, 139.1325), heading: 1.57 },
];

export const LOCATION_PROVENANCE = {
  tomari: 'User-selected Google place origin and GSI DEM shoreline; sandy rear shore arrival is an artistic refinement.',
  nakanoura: '式根島観光協会 embedded visitor map: https://shikinejima.tokyo/play/beach/nakanoura_beach/',
  niijima: 'Approximate west-coast Maehama visitor arrival, snapped to the GSI DEM coast; not an operational harbour waypoint.',
  habushi: 'Niijima official tour https://niijima-info.jp/course/2499/ links https://maps.app.goo.gl/VbdFNE5ySqEVpcjKA to the Main Gate Google place marker 34.3764393,139.2755897. Authored boat approach is 0.0011 degrees east, snapped to simulated navigable water; not an operational navigation waypoint.',
  horikiri: 'Niijima municipal surfing-map marker: 34.35561844,139.2758477, https://www.niijima.com/kankou/niijima/active/2014-0313-0955-90.html . Authored boat approach is 0.0011 degrees east, then snapped to navigable simulated water; not a harbour waypoint or surveyed entrance.',
  secret: 'Niijima municipal surfing-map marker: 34.34428046,139.2757618, https://www.niijima.com/kankou/niijima/active/2014-0313-0955-90.html . The actual surf region is distinct from Horikiri entrance per https://niijima-info.jp/column/4724/ . Authored boat approach is 0.0011 degrees east; coast walking is a simulation, not a current safe footpath.',
  kozushima: 'Approximate west-coast Maehama visitor arrival, snapped to the GSI DEM coast; not an operational harbour waypoint.',
} as const;
