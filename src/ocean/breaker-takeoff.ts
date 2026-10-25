/** Sub-grid crest turnover. The depth-averaged solver has no vertical
 * pressure profile, so this is an explicit energy-bounded reconstruction,
 * not a Navier-Stokes / VOF solver. The crest-frame head is split between
 * turning upward and overtaking the crest, then parcels fall at 9.81 m/s².
 * A broad, non-breaking shoulder must not acquire this extra vertical head. */
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function plungingTakeoff(crestSpeed:number,drop:number,frontSlope:number):{speed:number;up:number;plunging:number}{
  if(![crestSpeed,drop,frontSlope].every(Number.isFinite))return {speed:0,up:0,plunging:0};
  const c=Math.max(0,crestSpeed),h=Math.max(0,Math.min(3.5,drop));
  const plunging=smooth(.08,.30,frontSlope)*smooth(.45,1.20,h);
  // With the front face resolved below the lip, the crest does not need an
  // artificial fountain above the broad SWE shoulder to obtain air clearance.
  // At the overturning lip the jet leaves approximately horizontally.
  // Lifting every emitted row makes an airborne roof above the moving crest.
  const up=0;
  const oldExcess=Math.min(c*.05*9.81*h,Math.sqrt(2*9.81*h));
  const resolvedExcess=.92*Math.sqrt(Math.max(0,2*9.81*h-up*up));
  return {speed:Math.min(24,c+oldExcess*(1-plunging)+resolvedExcess*plunging),up,plunging};
}
