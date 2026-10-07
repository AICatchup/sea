/** Match the shoreline render transition in CPU validation and shared GLSL.
 * Confidence is interpolation support, NOT depth above the local sand. Blending
 * elevation toward mean sea level as depth falls erases a valid advancing bore. */
const transition={edgeStart:.025,edgeEnd:.10,deepStart:8,deepEnd:11,wetStart:.00001,wetEnd:.05} as const;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function shoreSurfaceBlend(edge:number,bed:number,wetWeight:number):number{
  if(![edge,bed,wetWeight].every(Number.isFinite))return 0;
  return smooth(transition.edgeStart,transition.edgeEnd,edge)*(1-smooth(transition.deepStart,transition.deepEnd,-bed))*smooth(transition.wetStart,transition.wetEnd,wetWeight);
}
/** In the solved domain, a dry cell exposes its bed. Falling back to the FFT
 * there resurrects an isolated water peak next to a drained trough. Domain
 * blending still preserves the offshore FFT and wet bore elevations. */
export function reconstructShoreSurface(edge:number,bed:number,wetWeight:number,wetElevation:number,fallbackHeight:number):number{
  if(![edge,bed,wetWeight,wetElevation,fallbackHeight].every(Number.isFinite))return fallbackHeight;
  const wet=smooth(transition.wetStart,transition.wetEnd,wetWeight);
  const dry=Math.min(fallbackHeight,bed-.015);
  const local=dry+(wetElevation-dry)*wet;
  return fallbackHeight+(local-fallbackHeight)*shoreSurfaceBlend(edge,bed,1);
}
const gl=(value:number)=>Number.isInteger(value)?value.toFixed(1):String(value);
/** A raster triangle can bridge a dry cell between wet vertices. Contact must
 * satisfy both its actual geometry and the pointwise Eulerian surface. */
export function shoreContactDepth(meshHeight:number,pointHeight:number,worldBed:number):number{
  return Math.min(meshHeight,pointHeight)-worldBed;
}
/** Differentiate the wet surface, not its dry FFT fallback. At a wet/dry
 * boundary use the available wet side; retain central slopes for wet waves. */
export function shoreWetSurfaceSlope(center:number,negative:number,negativeBed:number,positive:number,positiveBed:number,step:number):number{
  const wetNegative=negative>negativeBed,wetPositive=positive>positiveBed;
  if(wetNegative&&wetPositive)return (positive-negative)/(2*step);
  if(wetPositive)return (positive-center)/step;
  if(wetNegative)return (center-negative)/step;
  return 0;
}
export const shoreSurfaceTransitionGLSL=`
float shoreWetSurfaceSlope(float center,float negative,float negativeBed,float positive,float positiveBed,float stepSize){
  bool wetNegative=negative>negativeBed,wetPositive=positive>positiveBed;
  if(wetNegative&&wetPositive)return (positive-negative)/(2.*stepSize);
  if(wetPositive)return (positive-center)/stepSize;
  if(wetNegative)return (center-negative)/stepSize;
  return 0.;
}
float shoreContactDepth(float meshHeight,float pointHeight,float worldBed){
  return min(meshHeight,pointHeight)-worldBed;
}
float shoreSurfaceBlend(float edge,float bed,float wetWeight){
  return smoothstep(${gl(transition.edgeStart)},${gl(transition.edgeEnd)},edge)
    *(1.-smoothstep(${gl(transition.deepStart)},${gl(transition.deepEnd)},-bed))
    *smoothstep(${gl(transition.wetStart)},${gl(transition.wetEnd)},wetWeight);
}
float shoreWetSupport(float weight){return smoothstep(${gl(transition.wetStart)},${gl(transition.wetEnd)},weight);}
`;
