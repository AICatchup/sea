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
    sun: [0.45, 0.095, -0.89], sunColor: [3.4, 2.25, 1.25],
    zenith: [0.11, 0.20, 0.33], horizon: [0.64, 0.46, 0.32], cloud: [0.91, 0.77, 0.60],
    water: [0.85, 1.10, 1.03], coverage: 0.35, exposure: 1.04, storm: 0 },
  day: { label: '青い海', wind: 8.5, swell: 1, height: 3.6,
    sun: [-0.38, 0.56, -0.73], sunColor: [3.2, 3.0, 2.65],
    zenith: [0.075, 0.23, 0.50], horizon: [0.57, 0.70, 0.78], cloud: [1.0, 1.0, 0.97],
    water: [0.8, 1.18, 1.35], coverage: 0.46, exposure: 1.05, storm: 0 },
  storm: { label: '荒天', wind: 14, swell: 1.3, height: 5.8,
    sun: [0.42, 0.18, -0.88], sunColor: [0.85, 0.92, 1.02],
    zenith: [0.080, 0.105, 0.14], horizon: [0.30, 0.36, 0.40], cloud: [0.33, 0.40, 0.45],
    water: [0.9, 1.04, 1.1], coverage: 0.98, exposure: 0.88, storm: 1 },
  dusk: { label: '薄明', wind: 5.0, swell: 0.75, height: 3.2,
    sun: [0.6, 0.018, -0.8], sunColor: [0.23, 0.21, 0.36],
    zenith: [0.022, 0.035, 0.085], horizon: [0.24, 0.21, 0.31], cloud: [0.30, 0.28, 0.36],
    water: [0.85, 0.84, 1.2], coverage: 0.40, exposure: 0.91, storm: 0.1 },
};
