/** Positive spectral axis. The FFT uses exp(+i omega t) and a positive-sign
 * inverse transform, so its dominant travelling component moves along -axis. */
export const OCEAN_SPECTRUM_AXIS = {x:.8,z:.6} as const;
export const OCEAN_PROPAGATION_DIRECTION = {x:-OCEAN_SPECTRUM_AXIS.x,z:-OCEAN_SPECTRUM_AXIS.z} as const;

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Authored local ray closure: preserve the offshore spectrum direction on a
 * flat shelf, and refract incoming rays toward the bed normal as c~sqrt(gh)
 * decreases. The 12m matching depth is the solver's offshore boundary, not a
 * measured wavelength or a full spectral refraction solution. */
export function shoreIncidentDirection(gx:number,gz:number,depth:number):{x:number;z:number}{
  const incident=OCEAN_PROPAGATION_DIRECTION;
  if(![gx,gz,depth].every(Number.isFinite))return {...incident};
  const slope=Math.hypot(gx,gz);
  if(slope<1e-6)return {...incident};
  const nx=gx/slope,nz=gz/slope,arrival=incident.x*nx+incident.z*nz;
  if(arrival<=0)return {...incident};
  const tx=-nz,tz=nx,sine=(incident.x*tx+incident.z*tz)*Math.sqrt(Math.max(0,Math.min(1,depth/12)));
  const cosine=Math.sqrt(Math.max(0,1-sine*sine));
  const weight=smooth(.002,.035,slope),x=incident.x*(1-weight)+(nx*cosine+tx*sine)*weight,z=incident.z*(1-weight)+(nz*cosine+tz*sine)*weight;
  const length=Math.hypot(x,z);return {x:x/length,z:z/length};
}
export const shoreIncidentDirectionGLSL=/* glsl */`
vec2 shoreIncidentDirection(vec2 gradient,float depth){
  const vec2 incoming=vec2(${OCEAN_PROPAGATION_DIRECTION.x.toFixed(1)},${OCEAN_PROPAGATION_DIRECTION.z.toFixed(1)});
  float slope=length(gradient);if(slope<.000001)return incoming;
  vec2 n=gradient/slope;if(dot(incoming,n)<=0.)return incoming;
  vec2 tangent=vec2(-n.y,n.x);
  float sine=dot(incoming,tangent)*sqrt(clamp(depth/12.,0.,1.));
  vec2 refracted=n*sqrt(max(0.,1.-sine*sine))+tangent*sine;
  return normalize(mix(incoming,refracted,smoothstep(.002,.035,slope)));
}
`;
