/** Match the shoreline render transition in CPU validation and shared GLSL.
 * Confidence is interpolation support, NOT depth above the local sand. Blending
 * elevation toward mean sea level as depth falls erases a valid advancing bore. */
const transition={edgeStart:.025,edgeEnd:.10,deepStart:8,deepEnd:11,wetStart:.00001,wetEnd:.05} as const;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function shoreSurfaceBlend(edge:number,bed:number,wetWeight:number):number{
  if(![edge,bed,wetWeight].every(Number.isFinite))return 0;
  return smooth(transition.edgeStart,transition.edgeEnd,edge)*(1-smooth(transition.deepStart,transition.deepEnd,-bed))*smooth(transition.wetStart,transition.wetEnd,wetWeight);
}
const gl=(value:number)=>Number.isInteger(value)?value.toFixed(1):String(value);
/** A raster triangle can bridge a dry cell between wet vertices. Contact must
 * satisfy both its actual geometry and the pointwise Eulerian surface. */
export function shoreContactDepth(meshHeight:number,pointHeight:number,worldBed:number):number{
  return Math.min(meshHeight,pointHeight)-worldBed;
}
export const shoreSurfaceTransitionGLSL=`
float shoreContactDepth(float meshHeight,float pointHeight,float worldBed){
  return min(meshHeight,pointHeight)-worldBed;
}
float shoreSurfaceBlend(float edge,float bed,float wetWeight){
  return smoothstep(${gl(transition.edgeStart)},${gl(transition.edgeEnd)},edge)
    *(1.-smoothstep(${gl(transition.deepStart)},${gl(transition.deepEnd)},-bed))
    *smoothstep(${gl(transition.wetStart)},${gl(transition.wetEnd)},wetWeight);
}
`;
