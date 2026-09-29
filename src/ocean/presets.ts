export type PresetName = 'golden' | 'day' | 'storm' | 'dusk';
export interface Environment {
  label: string;
  wind: number;
  swell: number;
  height: number;
  sun: [number, number, number];
  sunColor: [number, number, number];
  zenith: [number, number, number];
  horizon: [number, number, number];
  cloud: [number, number, number];
  water: [number, number, number];
  coverage: number;
  exposure: number;
  storm: number;
}

export const presets: Record<PresetName, Environment> = {
  golden: { label: '夕凪', wind: 7.5, swell: 1, height: 3.6,
    sun: [0.26, 0.105, -0.96], sunColor: [3.1, 1.98, 0.99],
    zenith: [0.073, 0.13, 0.22], horizon: [0.46, 0.34, 0.25], cloud: [0.77, 0.64, 0.49],
    water: [0.88, 1.02, 1.04], coverage: 0.40, exposure: 1.0, storm: 0 },
  day: { label: '青い海', wind: 8.5, swell: 1, height: 3.8,
    sun: [-0.38, 0.56, -0.73], sunColor: [3.0, 2.85, 2.58],
    zenith: [0.052, 0.14, 0.29], horizon: [0.39, 0.49, 0.56], cloud: [0.87, 0.88, 0.86],
    water: [0.76, 1.0, 1.16], coverage: 0.57, exposure: 1.0, storm: 0 },
  storm: { label: '荒天', wind: 14, swell: 1.25, height: 5.8,
    sun: [0.42, 0.18, -0.88], sunColor: [0.62, 0.68, 0.74],
    zenith: [0.060, 0.078, 0.105], horizon: [0.23, 0.28, 0.31], cloud: [0.39, 0.43, 0.46],
    water: [0.87, 0.96, 1.04], coverage: 0.99, exposure: 0.91, storm: 1 },
  dusk: { label: '薄明', wind: 5.0, swell: 0.78, height: 3.2,
    sun: [0.50, 0.010, -0.866], sunColor: [0.35, 0.22, 0.29],
    zenith: [0.018, 0.030, 0.063], horizon: [0.21, 0.18, 0.23], cloud: [0.32, 0.28, 0.32],
    water: [0.75, 0.86, 1.09], coverage: 0.46, exposure: 0.90, storm: 0.08 },
};
