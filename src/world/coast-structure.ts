/** Metre-scale authored rock structure. These values are presentation refinements, not DEM measurements. */
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const ease = (low: number, high: number, value: number) => { const t = clamp((value-low)/(high-low),0,1); return t*t*(3-2*t); };
export const jointRandom = (x: number, z: number, seed: number): number => {
  let v = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(seed, 83492791);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
};

/** A fractured planar panel, with a narrow open joint between adjacent unequal panels. */
function panelRelief(u: number, v: number): number {
  const cellU = Math.floor(u/10), cellV = Math.floor(v/7);
  let first = Infinity, second = Infinity, bestU = 0, bestV = 0;
  for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++) {
    const cu=cellU+i, cv=cellV+j;
    const du=u-(cu+.18+jointRandom(cu,cv,1)*.64)*10;
    const dv=v-(cv+.18+jointRandom(cu,cv,2)*.64)*7;
    const distance=du*du+dv*dv;
    if(distance<first){ second=first;first=distance;bestU=cu;bestV=cv; }
    else if(distance<second)second=distance;
  }
  const distanceToJoint = (Math.sqrt(second)-Math.sqrt(first))*.5;
  const du=u-(bestU+.18+jointRandom(bestU,bestV,1)*.64)*10;
  const dv=v-(bestV+.18+jointRandom(bestU,bestV,2)*.64)*7;
  const tilt = du*(jointRandom(bestU,bestV,3)-.5)*.12 + dv*(jointRandom(bestU,bestV,4)-.5)*.16;
  const plane = (jointRandom(bestU,bestV,5)-.5)*2.4+tilt;
  // The gap carves inward; it does not add pebbly, positive noise to every point.
  return plane*ease(.12,.85,distanceToJoint) - (1-ease(.06,.58,distanceToJoint))*1.65;
}

/** Sharpen only an already steep source face; crown, sandy ground and seabed stay tied to the source. */
export function structuralCoastHeight(
  x: number, z: number, y: number, baseHeightAt: (x:number,z:number)=>number, sand: number,
): number {
  if(y<3.5 || y>62 || sand>.62)return y;
  const gx=(baseHeightAt(x+5,z)-baseHeightAt(x-5,z))/10;
  const gz=(baseHeightAt(x,z+5)-baseHeightAt(x,z-5))/10;
  const gradient=Math.hypot(gx,gz);
  const strength=ease(.62,1.22,gradient)*ease(3.5,7,y)*(1-ease(.3,.62,sand));
  if(strength===0)return y;
  const nx=gx/gradient,nz=gz/gradient;
  const top=baseHeightAt(x+nx*11,z+nz*11),foot=baseHeightAt(x-nx*11,z-nz*11);
  const span=top-foot;
  let sharp=y;
  if(span>8) {
    const t=clamp((y-foot)/span,0,1);
    // A broad toe and crown with a narrow scarp: source elevations and footprint remain the anchors.
    const profile=t<.3 ? t*.3 : t>.72 ? .955+(t-.72)*(.045/.28) : .09+(t-.3)*(.865/.42);
    sharp=foot+profile*span;
  }
  // Joint directions are shared across the headland, not re-oriented independently at each sample.
  const u=z*.96+x*.28, v=y*.92+x*.075-z*.045;
  const relief=panelRelief(u,v);
  // Two broad, irregularly spaced re-entrant clefts on the west buttress and the east ridge.
  const west=ease(-95,-130,x)*(1-ease(-220,-260,x));
  const east=ease(42,90,x)*(1-ease(160,210,x));
  const cleftA=Math.max(0,1-Math.abs(z+37+x*.105)/3.2);
  const cleftB=Math.max(0,1-Math.abs(z+67-x*.14)/2.6);
  const clefts=(west*cleftA+east*cleftB)*2.6*ease(5,12,y)*(1-ease(26,42,y));
  return y+((sharp-y)*.82+relief-clefts)*strength;
}
