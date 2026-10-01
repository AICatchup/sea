import {shoreBoreGLSL} from './shore-bore.ts';
/** A bounded readback of the solver's current flow and compression. Foam
 * concentration is deliberately not an emission source: it is already history.
 * Include after shoreSolverSampling and shoreWaveSampling. */
export const whitewaterFlowSampling=/* glsl */`
${shoreBoreGLSL}
vec4 whitewaterSolvedFlow(vec2 world){
  if(uShoreReady<.5)return vec4(0);
  vec2 uv=(world-uShoreBounds.xy)/uShoreBounds.zw;
  vec2 buv=(world-uBathyBounds.xy)/uBathyBounds.zw;
  if(any(lessThan(buv,vec2(0)))||any(greaterThan(buv,vec2(1))))return vec4(0);
  vec2 coast=sampleCoastalGround(uBathymetry,buv,uBathyResolution).rg;
  vec2 e=vec2(1./uShoreResolution,0);
  if(any(lessThan(uv,e.xx))||any(greaterThan(uv,vec2(1)-e.xx))||coast.g<.18)return vec4(0);
  vec4 c=texture2D(uShoreState,uv),r=texture2D(uShoreState,uv+e),l=texture2D(uShoreState,uv-e);
  vec4 t=texture2D(uShoreState,uv+e.yx),b=texture2D(uShoreState,uv-e.yx);
  if(c.r<.01)return vec4(0);
  vec2 cellSize=uShoreBounds.zw/uShoreResolution;
  float compression=max(0.,-(r.y/max(r.r,.01)-l.y/max(l.r,.01))/(2.*cellSize.x)
                         -(t.z/max(t.r,.01)-b.z/max(b.r,.01))/(2.*cellSize.y));
  float born=boreFoamBirth(c.r,compression,c.r+coast.r,max(0.,-coast.r));
  float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
  float blend=smoothstep(.025,.10,edge)*(1.-smoothstep(8.,11.,-coast.r))*smoothstep(.015,.12,c.r);
  return vec4(clamp(c.yz/max(c.r,.01),vec2(-12),vec2(12)),born,blend);
}
`;

/** Signed 8-bit transport is adequate for the existing 6m/5Hz cache, not a
 * high-resolution velocity measurement. 128 encodes exact rest. */
export function decodeWhitewaterVelocity(code:number):number {
  return Math.max(-12,Math.min(12,(code-128)*12/127));
}

/** Exact displacement/velocity for dv/dt=(target-v)/tau over a constant sample.
 * Allows offshore backwash and alongshore flow without a forced onshore bias. */
export function relaxWhitewaterVelocity(previous:number,target:number,dt:number):{distance:number;velocity:number}{
  const tau=.28,decay=Math.exp(-dt/tau);
  return {distance:target*dt+(previous-target)*tau*(1-decay),velocity:target+(previous-target)*decay};
}

/** Integrate a current, unitless birth-rate proxy over a two-second collapse
 * window. The square root controls geometric aeration, not emission count;
 * a weak current source stays sparse instead of becoming a white sheet.
 * This is an authored closure, not a measured dissipation rate. */
export function whitewaterAerationStrength(birthProxy:number):number {
  if(!Number.isFinite(birthProxy)||birthProxy<=0)return 0;
  return Math.sqrt(-Math.expm1(-2*Math.min(1,birthProxy)));
}
