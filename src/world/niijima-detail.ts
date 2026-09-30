import { NIIJIMA_DETAIL_RASTER as raster, NIIJIMA_DETAIL_PROVENANCE } from './niijima-detail.generated.ts';
import type { GroundSampler } from './contracts.ts';
export { NIIJIMA_DETAIL_PROVENANCE };

const NODATA = -32768;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ease = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function noise(x: number, z: number): number {
  const hash = (a: number, b: number) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; };
  const ix = Math.floor(x), iz = Math.floor(z), fx = ease(0, 1, x - ix), fz = ease(0, 1, z - iz);
  return (hash(ix, iz) * (1 - fx) + hash(ix + 1, iz) * fx) * (1 - fz) + (hash(ix, iz + 1) * (1 - fx) + hash(ix + 1, iz + 1) * fx) * fz;
}
function distances(mask: Uint8Array, width: number, height: number, dx: number, dz: number, value: number): Float32Array {
  const out = Float32Array.from(mask, v => v === value ? 0 : 1e6), diagonal = Math.hypot(dx, dz);
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const i = z * width + x; let d = out[i];
      if (x) d = Math.min(d, out[i - 1] + dx);
      if (z) { d = Math.min(d, out[i - width] + dz); if (x) d = Math.min(d, out[i - width - 1] + diagonal); if (x + 1 < width) d = Math.min(d, out[i - width + 1] + diagonal); }
      out[i] = d;
    }
    for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
      const i = z * width + x; let d = out[i];
      if (x + 1 < width) d = Math.min(d, out[i + 1] + dx);
      if (z + 1 < height) { d = Math.min(d, out[i + width] + dz); if (x) d = Math.min(d, out[i + width - 1] + diagonal); if (x + 1 < width) d = Math.min(d, out[i + width + 1] + diagonal); }
      out[i] = d;
    }
  }
  return out;
}

/** GSI land macroshape. Sea distance/profile and all microrelief are explicitly authored. */
export class NiijimaDEM {
  readonly raster: { readonly width: number; readonly height: number; readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number; readonly elevations: string };
  readonly dx: number;
  readonly dz: number;
  readonly land: Uint8Array;
  readonly heights: Float32Array;
  readonly shore: Float32Array;
  constructor(source = raster as NiijimaDEM['raster']) {
    this.raster = source; const raster = source;
    this.dx = (raster.maxX - raster.minX) / (raster.width - 1); this.dz = (raster.maxZ - raster.minZ) / (raster.height - 1);
    const encoded = atob(raster.elevations), buffer = new ArrayBuffer(encoded.length), bytes = new Uint8Array(buffer);
    for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
    const view = new DataView(buffer), values = Int16Array.from({ length: encoded.length / 2 }, (_, i) => view.getInt16(i * 2, true));
    this.land = Uint8Array.from(values, v => v === NODATA ? 0 : 1);
    const sea = distances(this.land, raster.width, raster.height, this.dx, this.dz, 0);
    const land = distances(this.land, raster.width, raster.height, this.dx, this.dz, 1);
    this.shore = new Float32Array(values.length); this.heights = new Float32Array(values.length);
    const halfCell = Math.min(this.dx, this.dz) / 2;
    for (let i = 0; i < values.length; i++) {
      const d = this.land[i] ? sea[i] - halfCell : -(land[i] - halfCell); this.shore[i] = d;
      this.heights[i] = this.land[i] ? Math.max(-0.15, values[i] * .1) : Math.max(-110, -.2 + d * .075 - ease(80, 600, -d) * 27);
    }
  }
  sample(array: Float32Array, x: number, z: number): number {
    const raster = this.raster;
    const px = clamp((x - raster.minX) / this.dx, 0, raster.width - 1), pz = clamp((z - raster.minZ) / this.dz, 0, raster.height - 1);
    const ix = Math.min(raster.width - 2, Math.floor(px)), iz = Math.min(raster.height - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz, i = iz * raster.width + ix;
    return (array[i] * (1 - fx) + array[i + 1] * fx) * (1 - fz) + (array[i + raster.width] * (1 - fx) + array[i + raster.width + 1] * fx) * fz;
  }
  heightAt(x: number, z: number): number { return this.sample(this.heights, x, z); }
  shoreAt(x: number, z: number): number { return this.sample(this.shore, x, z); }
  /** Authored erosion is local to steep pumice faces; measured mountain tops stay anchored. */
  refinedHeightAt(x: number, z: number): number {
    const y = this.heightAt(x, z), d = this.shoreAt(x, z);
    const gx = (this.heightAt(x + 3, z) - this.heightAt(x - 3, z)) / 6;
    const gz = (this.heightAt(x, z + 3) - this.heightAt(x, z - 3)) / 6, slope = Math.hypot(gx, gz);
    const cliff = ease(.5, 1.15, slope) * ease(4, 16, y) * (1 - ease(210, 330, d));
    // Broad rain gullies, hard bedding and crumbly small ledges. No cloned Tomari rocks.
    const gullies = Math.pow(1 - Math.abs(noise(z * .13, y * .009) * 2 - 1), 9) * 1.8;
    const strata = Math.sin(y * 1.05 + noise(x * .012, z * .012) * 2.4) * .24;
    const crumbs = (noise(x * .67, z * .67) - .5) * .42;
    const beach = (1 - ease(3, 7, Math.abs(y))) * (1 - ease(.35, .9, slope)) * (1 - ease(50, 100, Math.abs(d)));
    // Small sand ridges die out at the waterline, keeping the dry/wet transition continuous.
    const sand = Math.sin(z * .8 + noise(x * .021, z * .021) * 9) * .013 + (noise(x * .39, z * .39) - .5) * .027;
    return y + cliff * (strata + crumbs - gullies) + sand * beach * ease(-.25, .6, y);
  }
}

export interface SurfaceBounds { minX: number; minZ: number; maxX: number; maxZ: number; }
/** Every height query is barycentric interpolation of the identical indexed render triangles. */
export class NiijimaSurface implements GroundSampler {
  readonly width: number; readonly height: number; readonly ground: Float32Array;
  readonly dx: number; readonly dz: number;
  readonly bounds: SurfaceBounds;
  constructor(bounds: SurfaceBounds, spacing: number | { x: number; z: number }, base: GroundSampler, authored: GroundSampler, join = 20) {
    this.bounds = bounds;
    this.width = Math.round((bounds.maxX - bounds.minX) / (typeof spacing === 'number' ? spacing : spacing.x)) + 1;
    this.height = Math.round((bounds.maxZ - bounds.minZ) / (typeof spacing === 'number' ? spacing : spacing.z)) + 1;
    this.dx = (bounds.maxX - bounds.minX) / (this.width - 1); this.dz = (bounds.maxZ - bounds.minZ) / (this.height - 1);
    this.ground = new Float32Array(this.width * this.height);
    for (let iz = 0; iz < this.height; iz++) for (let ix = 0; ix < this.width; ix++) {
      const x = bounds.minX + ix * this.dx, z = bounds.minZ + iz * this.dz;
      const edge = Math.min(x - bounds.minX, bounds.maxX - x, z - bounds.minZ, bounds.maxZ - z), blend = ease(0, join, edge);
      this.ground[iz * this.width + ix] = base.heightAt(x, z) * (1 - blend) + authored.heightAt(x, z) * blend;
    }
  }
  contains(x: number, z: number): boolean { const b = this.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  heightAt(x: number, z: number): number {
    const b = this.bounds, px = clamp((x - b.minX) / this.dx, 0, this.width - 1), pz = clamp((z - b.minZ) / this.dz, 0, this.height - 1);
    const ix = Math.min(this.width - 2, Math.floor(px)), iz = Math.min(this.height - 2, Math.floor(pz)), fx = px - ix, fz = pz - iz, i = iz * this.width + ix;
    const a = this.ground[i], bb = this.ground[i + 1], c = this.ground[i + this.width], d = this.ground[i + this.width + 1];
    return fx + fz <= 1 ? a + (bb - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (bb - d) * (1 - fz);
  }
}
