/** Concentration opens/closes coherent holes; there is no uniform white floor.
 * Small-scale filtering changes contrast, never the world-space pattern scale. */
export function surfaceFoamCoverage(concentration:number,pattern:number,width:number):number{
  const c=Math.max(0,Math.min(1,concentration)),w=Math.max(.02,Math.min(.18,width));
  const t=Math.max(0,Math.min(1,(pattern-(1-c-w))/(2*w)));
  return t*t*(3-2*t)*Math.min(1,c/.02);
}
export const surfaceFoamGLSL=/* glsl */`
float surfaceFoamCoverage(float concentration,float pattern,float width){
  float c=clamp(concentration,0.,1.),w=clamp(width,.02,.18);
  return smoothstep(1.-c-w,1.-c+w,pattern)*min(1.,c/.02);
}
`;
