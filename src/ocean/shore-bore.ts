/** Local shoreward simple-wave closure, u=2(sqrt(gh)-sqrt(gh0)).
 * Direction still follows the authored bathymetric uphill proxy; this is not
 * a measured incident wave direction or an overturning free-surface model. */
export function incidentBoreVelocity(depth:number,restDepth:number,maxSpeed=12):number{
  if(![depth,restDepth,maxSpeed].every(Number.isFinite)||depth<=.01||maxSpeed<=0)return 0;
  const velocity=2*(Math.sqrt(9.81*depth)-Math.sqrt(9.81*Math.max(0,restDepth)));
  return Math.max(-maxSpeed,Math.min(maxSpeed,velocity));
}
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** H~2*positive elevation is a crest-height proxy, not measured wave height.
 * A broad authored onset window avoids declaring every small compressive
 * swell to be a breaker. Existing foam still advects and decays separately. */
export function boreFoamBirth(depth:number,compression:number,elevation:number,restDepth:number):number{
  if(![depth,compression,elevation,restDepth].every(Number.isFinite)||depth<=.01)return 0;
  const ratio=2*Math.max(0,elevation)/Math.max(.2,restDepth);
  return Math.max(0,Math.min(1,compression*.7))*(1-smooth(3,7,depth))*smooth(.05,.3,depth)*smooth(.55,.9,ratio);
}
export const shoreBoreGLSL=/* glsl */`
float incidentBoreVelocity(float depth,float restDepth,float maxSpeed){
  if(depth<=.01)return 0.;
  return clamp(2.*(sqrt(9.81*depth)-sqrt(9.81*max(0.,restDepth))),-maxSpeed,maxSpeed);
}
float boreFoamBirth(float depth,float compression,float elevation,float restDepth){
  float ratio=2.*max(0.,elevation)/max(.2,restDepth);
  return clamp(compression*.7,0.,1.)*(1.-smoothstep(3.,7.,depth))*smoothstep(.05,.3,depth)*smoothstep(.55,.9,ratio);
}
`;
