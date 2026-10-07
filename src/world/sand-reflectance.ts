/** Linear-light mean of the bundled, unchanged sand_02_diff_2k.jpg (all pixels).
 * The pale strand target is authored from the photographic direction, not a
 * measurement of Tomari minerals or a relit photograph of that actual beach.
 */
export const SAND_REFLECTANCE = Object.freeze({
  sourceLinearLuma: .10075974295498259,
  dryTarget: [.58, .56, .50] as const,
  grainContrast: .45,
  maximum: .88,
  sourceSha256: '8d19fa2a0bdec258e9d6a84afcb7ea866506e6b461d75e65792d0865c0043b88',
});
export function paleSandReflectance(photo: readonly number[]): [number, number, number] {
  if (photo.length !== 3 || photo.some(c => !Number.isFinite(c) || c < 0)) throw new Error('Finite linear RGB sand required');
  const luma = photo[0] * .2126 + photo[1] * .7152 + photo[2] * .0722;
  const grain = Math.pow(Math.max(.005, luma) / SAND_REFLECTANCE.sourceLinearLuma, SAND_REFLECTANCE.grainContrast);
  return SAND_REFLECTANCE.dryTarget.map((target, i) => Math.min(SAND_REFLECTANCE.maximum,
    target * grain * (.94 + .06 * photo[i] / Math.max(.005, luma)))) as [number, number, number];
}
/** One reflectance transform for the directly visible strand and refracted bed. */
export const SAND_REFLECTANCE_GLSL = `
uniform float uSandAppearance;
vec3 paleSandReflectance(vec3 photo) {
  float luma=dot(photo,vec3(.2126,.7152,.0722));
  float grain=pow(max(.005,luma)/${SAND_REFLECTANCE.sourceLinearLuma},${SAND_REFLECTANCE.grainContrast});
  vec3 mineral=vec3(.94)+.06*photo/max(.005,luma);
  return min(vec3(${SAND_REFLECTANCE.maximum}),vec3(${SAND_REFLECTANCE.dryTarget.join(',')})*grain*mineral);
}
`;
