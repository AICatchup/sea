/** An opt-in authored erosion profile. No raster bytes or measured claims change. */
export interface ScarpSource {
  heightAt(x: number, z: number): number;
  shoreAt(x: number, z: number): number;
}
export const NIIJIMA_SCARP_BOUNDS = { minX: 5720, maxX: 5970, minZ: -1500, maxZ: -450 } as const;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Reparameterize a single connected terrain surface along its inland normal.
 * The low strand is invariant; talus, face and crest are parts of this field,
 * so indexed render triangles and GroundSampler retain one shared authority.
 */
export function niijimaScarpHeight(source: ScarpSource, x: number, z: number, legacy: number): number {
  const b = NIIJIMA_SCARP_BOUNDS;
  if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) return legacy;
  const original = source.heightAt(x, z), d = source.shoreAt(x, z);
  if (original <= 3 || d <= 12 || d >= 145) return legacy;
  const gx = (source.shoreAt(x + 3, z) - source.shoreAt(x - 3, z)) / 6;
  const gz = (source.shoreAt(x, z + 3) - source.shoreAt(x, z - 3)) / 6;
  const length = Math.hypot(gx, gz);
  if (length < .15 || !Number.isFinite(length)) return legacy;
  // Long uneven frontage, narrower rain incisions and continuous bedding ledges.
  // These are world-space geological hypotheses, never camera-space geometry.
  const frontage = 3 * Math.sin(z * .021) + 1.6 * Math.sin(z * .061 + .8);
  const gully = Math.pow(.5 + .5 * Math.sin(z * .19 + Math.sin(z * .031)), 12);
  const toe = 36 + frontage + gully * 4;
  const crest = toe + 12;
  let mapped: number;
  if (d < toe) {
    // Broad accessible dry strand, then grounded loose talus rising to the toe.
    mapped = 12 + (d - 12) * .20;
  } else if (d < crest) {
    const t = (d - toe) / (crest - toe);
    const toeHeight = 12 + (toe - 12) * .20;
    mapped = toeHeight + (90 - toeHeight) * t;
    mapped += Math.sin(t * Math.PI * 8 + Math.sin(z * .017)) * .8 * Math.sin(t * Math.PI);
  } else {
    mapped = 90 + (d - crest) * (145 - 90) / (145 - crest);
  }
  const shift = mapped - d;
  const target = source.heightAt(x + gx / length * shift, z + gz / length * shift);
  const edge = smooth(b.minX, b.minX + 30, x) * (1 - smooth(b.maxX - 25, b.maxX, x))
    * smooth(b.minZ, b.minZ + 100, z) * (1 - smooth(b.maxZ - 160, b.maxZ, z));
  const weight = edge * smooth(3, 7, original) * smooth(12, 18, d) * (1 - smooth(130, 145, d));
  return legacy + (target - legacy) * weight;
}
