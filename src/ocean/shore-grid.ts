/** The SWE surface is Eulerian. Inside its fully owned domain, sampling it
 * on a folded FFT parameter mesh creates overlapping triangles with different
 * material coordinates. Keep that mesh world-fixed; leave offshore waves alone.
 * The collar lies wholly inside the 100% SWE height blend. */
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function shoreGridChop(edge:number,bed:number,exposure:number,ready=true):number{
  if(!ready||![edge,bed,exposure].every(Number.isFinite)||exposure<.18)return 1;
  return 1-smooth(.10,.20,edge)*(1-smooth(5,8,-bed));
}
export const shoreGridGLSL=/* glsl */`
float shoreGridChop(vec2 world,vec2 coast){
  if(uShoreReady<.5||coast.y<.18)return 1.;
  vec2 uv=(world-uShoreBounds.xy)/uShoreBounds.zw;
  float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
  return 1.-smoothstep(.10,.20,edge)*(1.-smoothstep(5.,8.,-coast.x));
}
`;
