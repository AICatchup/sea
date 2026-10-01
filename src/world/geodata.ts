import { ELEVATION_RASTERS, GEODATA_PROVENANCE } from './geodata.generated.ts';
import { structuralCoastHeight } from './coast-structure.ts';
export { GEODATA_PROVENANCE };

export const NODATA = -32768;
export type ElevationRaster = (typeof ELEVATION_RASTERS)[number];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}
export function sandAt(x: number, z: number): number {
  const cove = Math.hypot((x + 58) / 95, (z + 25) / 105);
  const beach = Math.hypot((x + 40) / 88, (z - 21) / 39);
  return Math.max(1 - smoothstep(0.64, 1.16, cove), 1 - smoothstep(0.68, 1.12, beach));
}
/** Sheltered behind Tomari's rock headlands; progresses to open-sea wind beyond the mouth. */
export function shelterAt(x: number, z: number): number {
  const cove = Math.hypot((x + 57) / 168, (z + 32) / 170);
  const mouth = smoothstep(-138, -290, z);
  return 0.13 + 0.87 * Math.max(smoothstep(0.62, 1.5, cove), mouth);
}

function decode(base64: string): Int16Array {
  const binary = atob(base64), view = new DataView(new ArrayBuffer(binary.length));
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = new Int16Array(binary.length / 2);
  for (let i = 0; i < result.length; i++) result[i] = view.getInt16(i * 2, true);
  return result;
}

/** Eight-neighbour distance transform, in world metres. Positive signed distance is on land. */
function distances(mask: Uint8Array, width: number, height: number, dx: number, dz: number, target: number): Float32Array {
  const out = Float32Array.from(mask, cell => cell === target ? 0 : 1e6);
  const diagonal = Math.hypot(dx, dz);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (x) out[i] = Math.min(out[i], out[i - 1] + dx);
    if (z) {
      out[i] = Math.min(out[i], out[i - width] + dz);
      if (x) out[i] = Math.min(out[i], out[i - width - 1] + diagonal);
      if (x + 1 < width) out[i] = Math.min(out[i], out[i - width + 1] + diagonal);
    }
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x;
    if (x + 1 < width) out[i] = Math.min(out[i], out[i + 1] + dx);
    if (z + 1 < height) {
      out[i] = Math.min(out[i], out[i + width] + dz);
      if (x) out[i] = Math.min(out[i], out[i + width - 1] + diagonal);
      if (x + 1 < width) out[i] = Math.min(out[i], out[i + width + 1] + diagonal);
    }
  }
  return out;
}

export class ElevationField {
  readonly raster: ElevationRaster;
  readonly values: Int16Array;
  readonly land: Uint8Array;
  readonly signedShore: Float32Array;
  readonly ground: Float32Array;
  readonly dx: number;
  readonly dz: number;

  constructor(raster: ElevationRaster) {
    this.raster = raster;
    this.values = decode(raster.elevations);
    this.land = Uint8Array.from(this.values, value => value === NODATA ? 0 : 1);
    this.dx = (raster.maxX - raster.minX) / (raster.width - 1);
    this.dz = (raster.maxZ - raster.minZ) / (raster.height - 1);
    const toLand = distances(this.land, raster.width, raster.height, this.dx, this.dz, 1);
    const toSea = distances(this.land, raster.width, raster.height, this.dx, this.dz, 0);
    this.signedShore = new Float32Array(this.values.length);
    this.ground = new Float32Array(this.values.length);
    const halfCell = Math.min(this.dx, this.dz) * 0.5;
    for (let i = 0; i < this.values.length; i++) {
      const x = raster.minX + (i % raster.width) * this.dx;
      const z = raster.minZ + Math.floor(i / raster.width) * this.dz;
      const shore = this.land[i] ? toSea[i] - halfCell : -(toLand[i] - halfCell);
      this.signedShore[i] = shore;
      if (this.land[i]) {
        const elevation = Math.max(0.08, this.values[i] * 0.1);
        const beach = sandAt(x, z) * (1 - smoothstep(5, 9, elevation));
        // A walkable strand from the measured low land cells; DEM peaks and rocky headlands remain intact.
        const strand = Math.min(5.5, 0.22 + Math.max(shore, 0) * 0.105);
        this.ground[i] = elevation * (1 - beach) + strand * beach;
      } else {
        const d = Math.max(0, -shore);
        const sand = sandAt(x, z);
        const shelf = -0.3 - d * 0.22 - smoothstep(100, 750, d) * 20;
        const cove = -0.1 - d * 0.036 - smoothstep(85, 250, d) * 7;
        // Coast-derived artistic bathymetry, explicitly distinct from GSI's land elevations.
        const ripple = Math.sin(x * 0.11 + Math.sin(z * 0.06)) * Math.sin(z * 0.083) * 0.07 * sand;
        this.ground[i] = Math.max(-110, shelf * (1 - sand) + cove * sand + ripple);
      }
    }
  }

  contains(x: number, z: number, margin = 0): boolean {
    const r = this.raster;
    const epsilon = 1e-6;
    return x >= r.minX + margin - epsilon && x <= r.maxX - margin + epsilon && z >= r.minZ + margin - epsilon && z <= r.maxZ - margin + epsilon;
  }
  sample(array: Float32Array, x: number, z: number): number {
    const r = this.raster;
    const px = clamp((x - r.minX) / this.dx, 0, r.width - 1);
    const pz = clamp((z - r.minZ) / this.dz, 0, r.height - 1);
    const ix = Math.min(r.width - 2, Math.floor(px)), iz = Math.min(r.height - 2, Math.floor(pz));
    const fx = px - ix, fz = pz - iz, i = iz * r.width + ix;
    return (array[i] * (1 - fx) + array[i + 1] * fx) * (1 - fz) + (array[i + r.width] * (1 - fx) + array[i + r.width + 1] * fx) * fz;
  }
  /** Sample the same two triangles used by the rendered grid, including coarse distant coasts. */
  heightAt(x: number, z: number, stride = 1): number {
    const r = this.raster;
    const px = clamp((x - r.minX) / this.dx, 0, r.width - 1);
    const pz = clamp((z - r.minZ) / this.dz, 0, r.height - 1);
    const ix = Math.min(Math.floor((r.width - 2) / stride) * stride, Math.floor(px / stride) * stride);
    const iz = Math.min(Math.floor((r.height - 2) / stride) * stride, Math.floor(pz / stride) * stride);
    const jx = Math.min(r.width - 1, ix + stride), jz = Math.min(r.height - 1, iz + stride);
    const fx = (px - ix) / (jx - ix), fz = (pz - iz) / (jz - iz);
    const a = this.ground[iz * r.width + ix], b = this.ground[iz * r.width + jx];
    const c = this.ground[jz * r.width + ix], d = this.ground[jz * r.width + jx];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  shoreAt(x: number, z: number): number { return this.sample(this.signedShore, x, z); }

  /** C1 interpolation removes the source-cell diagonals from the low sandy strand. */
  smoothHeightAt(x: number, z: number): number {
    const r = this.raster, px = clamp((x - r.minX) / this.dx, 0, r.width - 1), pz = clamp((z - r.minZ) / this.dz, 0, r.height - 1);
    const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
    const cubic = (a: number, b: number, c: number, d: number, t: number) => {
      const value = b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
      return clamp(value, Math.min(b, c), Math.max(b, c)); // A shoreline filter must not invent a ridge or a pit.
    };
    const rows: number[] = [];
    for (let dz = -1; dz <= 2; dz++) {
      const row = clamp(iz + dz, 0, r.height - 1) * r.width;
      rows.push(cubic(...[-1, 0, 1, 2].map(dx => this.ground[row + clamp(ix + dx, 0, r.width - 1)]) as [number, number, number, number], fx));
    }
    return cubic(rows[0], rows[1], rows[2], rows[3], fz);
  }
}

/** An authored refinement, not additional measured elevation. All consumers use these exact triangles. */
export class TomariCoastSurface {
  readonly subdivision: number;
  readonly sourceMinX: number;
  readonly sourceMaxX: number;
  readonly sourceMinZ: number;
  readonly sourceMaxZ: number;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly dx: number;
  readonly dz: number;
  readonly width: number;
  readonly height: number;
  readonly ground: Float32Array;

  constructor(field: ElevationField, baseHeightAt: (x: number, z: number) => number,
    options:{subdivision:number;minX:number;maxX:number;minZ:number;maxZ:number;coherentRock?:boolean} = { subdivision: 4, minX: 40, maxX: 190, minZ: 50, maxZ: 168 }) {
    this.subdivision = options.subdivision;
    this.sourceMinX = options.minX; this.sourceMaxX = options.maxX;
    this.sourceMinZ = options.minZ; this.sourceMaxZ = options.maxZ;
    this.minX = field.raster.minX + this.sourceMinX * field.dx;
    this.minZ = field.raster.minZ + this.sourceMinZ * field.dz;
    this.maxX = field.raster.minX + this.sourceMaxX * field.dx;
    this.maxZ = field.raster.minZ + this.sourceMaxZ * field.dz;
    this.dx = field.dx / this.subdivision; this.dz = field.dz / this.subdivision;
    this.width = (this.sourceMaxX - this.sourceMinX) * this.subdivision + 1;
    this.height = (this.sourceMaxZ - this.sourceMinZ) * this.subdivision + 1;
    this.ground = new Float32Array(this.width * this.height);
    for (let iz = 0; iz < this.height; iz++) for (let ix = 0; ix < this.width; ix++) {
      const x = this.minX + ix * this.dx, z = this.minZ + iz * this.dz, y = baseHeightAt(x, z);
      const edge = Math.min(x - this.minX, this.maxX - x, z - this.minZ, this.maxZ - z);
      const join = smoothstep(0, 16, edge);
      const beach = sandAt(x, z) * (1 - smoothstep(3, 7, Math.abs(y))) * join;
      // The nested 0.5m strand interpolates this surface, rather than applying the scarp twice.
      const rock = options.subdivision <= 4 ? structuralCoastHeight(x,z,y,baseHeightAt,sandAt(x,z),options.coherentRock??false) : y;
      this.ground[iz * this.width + ix] = y + (field.smoothHeightAt(x, z) - y) * beach + (rock-y)*(1-beach)*join;
    }
  }

  contains(x: number, z: number): boolean { return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ; }
  heightAt(x: number, z: number): number {
    const px = clamp((x - this.minX) / this.dx, 0, this.width - 1), pz = clamp((z - this.minZ) / this.dz, 0, this.height - 1);
    const ix = Math.min(this.width - 2, Math.floor(px)), iz = Math.min(this.height - 2, Math.floor(pz));
    const fx = px - ix, fz = pz - iz, i = iz * this.width + ix;
    const a = this.ground[i], b = this.ground[i + 1], c = this.ground[i + this.width], d = this.ground[i + this.width + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
}

export class IslandElevation {
  readonly fields = ELEVATION_RASTERS.map(raster => new ElevationField(raster));
  readonly shikine = this.fields.find(field => field.raster.id === 'shikine')!;
  readonly tomari = this.fields.find(field => field.raster.id === 'tomari');
  readonly coast:TomariCoastSurface|undefined;
  readonly beach:TomariCoastSurface|undefined;
  readonly coherentRock:boolean;
  constructor(coherentRock=false){
    this.coherentRock=coherentRock;
    this.coast=this.tomari?new TomariCoastSurface(this.tomari,(x,z)=>this.baseHeightAt(x,z),
      {subdivision:4,minX:40,maxX:190,minZ:50,maxZ:168,coherentRock}):undefined;
    this.beach=this.tomari&&this.coast?new TomariCoastSurface(this.tomari,(x,z)=>this.coast!.heightAt(x,z),
      {subdivision:8,minX:80,maxX:139,minZ:95,maxZ:143}):undefined;
  }

  fieldAt(x: number, z: number): ElevationField | undefined {
    if (this.tomari?.contains(x, z)) return this.tomari;
    return this.fields.find(field => field !== this.tomari && field.contains(x, z));
  }
  heightAt(x: number, z: number): number {
    if (this.beach?.contains(x, z)) return this.beach.heightAt(x, z);
    if (this.coast?.contains(x, z)) return this.coast.heightAt(x, z);
    return this.baseHeightAt(x, z);
  }
  private baseHeightAt(x: number, z: number): number {
    const field = this.fieldAt(x, z);
    if (!field) return -110;
    if (field !== this.tomari) return field.heightAt(x, z, 2);
    const r = field.raster;
    const edge = Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
    const blend = smoothstep(0, 24, edge);
    return this.shikine.heightAt(x, z, 2) * (1 - blend) + field.heightAt(x, z) * blend;
  }
  shoreAt(x: number, z: number): number {
    const field = this.fieldAt(x, z);
    return field ? field.shoreAt(x, z) : -2000;
  }
  /** Find a coastal landing and a water point using the same sampler as movement. */
  arrival(x: number, z: number): { x: number; z: number; landingX: number; landingZ: number } {
    let water = { x, z }, waterScore = Infinity, landing = { x, z }, landScore = Infinity;
    for (let dz = -300; dz <= 300; dz += 8) for (let dx = -300; dx <= 300; dx += 8) {
      const px = x + dx, pz = z + dz, ground = this.heightAt(px, pz);
      const distance = Math.hypot(dx, dz);
      if (ground < -2.3 && ground > -18) {
        const score = distance + Math.abs(ground + 5) * 4;
        if (score < waterScore) { waterScore = score; water = { x: px, z: pz }; }
      }
      if (ground > 0.55 && ground < 6 && this.shoreAt(px, pz) > 2) {
        const score = distance + ground * 5;
        if (score < landScore) { landScore = score; landing = { x: px, z: pz }; }
      }
    }
    return { ...water, landingX: landing.x, landingZ: landing.z };
  }
}
