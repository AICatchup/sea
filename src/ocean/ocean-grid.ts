/** Metric radial sampling. The old pure exponential spent 52 rings inside
 * two metres, yet used 4.4 m edges at 80 m: a crest could fit between vertices.
 * The offset exponential spends vertices on the visible surf as well as feet.
 * The horizon and complete 360 degree coverage are retained. */
export const OCEAN_RINGS=384, OCEAN_SECTORS=320, OCEAN_RADIUS=28000;
export function oceanRingRadius(index:number):number {
  if(!Number.isInteger(index)||index<0||index>OCEAN_RINGS)throw new RangeError('Invalid ocean ring');
  return 2*Math.expm1(index/OCEAN_RINGS*Math.log1p(OCEAN_RADIUS/2));
}
