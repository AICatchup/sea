/** Shared Eulerian coverage closure in metres. Macro flocs advect through this
 * authored field; these pores are not claimed to be a SWE material tracer. */
export const whitewaterPoreGLSL=/* glsl */`
float whitewaterHash(vec2 p){vec3 q=fract(vec3(p.x,p.y,p.x)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float whitewaterNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(whitewaterHash(i),whitewaterHash(i+vec2(1,0)),f.x),mix(whitewaterHash(i+vec2(0,1)),whitewaterHash(i+vec2(1,1)),f.x),f.y);}
float whitewaterPore(vec2 world){return .65*whitewaterNoise(world*vec2(1.3,.72))+.35*whitewaterNoise(world*vec2(3.1,2.6));}
float whitewaterPoreThreshold(float alpha,float age){return max(.30,mix(.30,.68,1.-clamp(alpha*(1.25-.2*smoothstep(.12,.85,age)),0.,1.)));}
`;
/** CPU coverage decision oracle: .30 is a mandatory shared void floor even
 * for the youngest floc, so no younger overlap can refill these channels. */
export function whitewaterPoreThreshold(alpha:number,age:number):number {
  const t=Math.max(0,Math.min(1,(age-.12)/(.85-.12))),erosion=t*t*(3-2*t);
  return Math.max(.30,.30+.38*(1-Math.max(0,Math.min(1,alpha*(1.25-.2*erosion)))));
}
