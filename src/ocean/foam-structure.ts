import {surfaceFoamCoverage} from './surface-foam.ts';
/** Coverage is a thresholded visibility mask, not bubble concentration. */
export function foamMaterialConcentration(solved:number,unthresholdedFFT:number):number {
  if(![solved,unthresholdedFFT].every(Number.isFinite))return 0;
  return Math.max(0,Math.min(1,Math.max(solved,unthresholdedFFT)));
}
/** Two independent occupancy bands tend to c in expectation. Unresolved
 * structure tends to that mean, not a thresholded constant noise value. */
export function structuredFoamCoverage(concentration:number,macro:number,meso:number,footprint:number):number {
  if(![concentration,macro,meso,footprint].every(Number.isFinite))return 0;
  const p=Math.sqrt(Math.max(0,Math.min(1,concentration))),f=Math.max(0,footprint);
  const edge=.5*Math.min(p,1-p),wm=Math.max(.02,Math.min(Math.max(.085,f*.6),edge)),ws=Math.max(.02,Math.min(Math.max(.11,f*6),edge));
  const a=p+(surfaceFoamCoverage(p,macro,wm)-p)*Math.exp(-((f*.6)**2));
  const b=p+(surfaceFoamCoverage(p,meso,ws)-p)*Math.exp(-((f*6)**2));
  return a*b;
}

/** World-metre optical structure only; it does not create or transport foam.
 * Clear pockets and bubble caps use different scales. Beyond resolution each
 * converges to a mean instead of closing every pore or sparkling. */
export const foamStructureGLSL=/* glsl */`
float foamMaterialConcentration(float solved,float unthresholdedFFT){return clamp(max(solved,unthresholdedFFT),0.,1.);}
float structuredFoamCoverage(float concentration,float macro,float meso,float footprint){
  float p=sqrt(clamp(concentration,0.,1.)),f=max(0.,footprint);
  float edge=.5*min(p,1.-p),wm=max(.02,min(max(.085,f*.6),edge)),ws=max(.02,min(max(.11,f*6.),edge));
  float a=mix(p,surfaceFoamCoverage(p,macro,wm),exp(-pow(f*.6,2.)));
  float b=mix(p,surfaceFoamCoverage(p,meso,ws),exp(-pow(f*6.,2.)));
  return a*b;
}
float foamPocketField(vec2 world){
  vec2 p=mat2(.8,.6,-.6,.8)*world*5.2;
  p+=2.1*vec2(noise(p*.37+vec2(13,5)),noise(p*.43+vec2(71,29)));
  return .48*noise(p)+.32*noise(p*2.07+vec2(7,31))+.20*noise(p*4.17+vec2(41,3));
}
vec4 foamStructureCell(vec2 world,float scale){
  vec2 p=world*scale;
  p+=.42*vec2(noise(world*scale*.29+vec2(13,5)),noise(world*scale*.23+vec2(71,29)));
  vec2 cell=floor(p),winning=vec2(0);float distance=4.,radius=.3;
  for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){
    vec2 id=cell+vec2(float(x),float(z));
    vec2 center=id+.08+.84*vec2(hash(id+vec2(31,7)),hash(id+vec2(5,83)));
    float r=.20+.38*pow(hash(id+vec2(79,43)),2.);
    vec2 v=p-center;float d=length(v)/r;
    if(d<distance){distance=d;radius=r;winning=v;}
  }
  return vec4(distance,radius,winning);
}
vec2 foamStructureBand(vec2 world,float footprint,float scale,float strength){
  vec4 cell=foamStructureCell(world,scale);
  float pixel=max(0.,footprint)*scale,diameter=2.*cell.y;
  float resolved=1.-smoothstep(.30,1.5,pixel/diameter),aa=max(.06,pixel/cell.y);
  float pore=1.-smoothstep(.56-aa,.88+aa,cell.x);
  float rim=1.-smoothstep(.10+aa,.38+aa,abs(cell.x-1.));
  vec2 radial=cell.zw/max(length(cell.zw),.00001),sun=uSunDirection.xz/max(length(uSunDirection.xz),.001);
  // Approximate mean pore area for this bounded radius distribution; no
  // claim that these authored pockets are a measured local bubble census.
  float meanOpacity=1.-.18*strength;
  float opacity=mix(meanOpacity,1.-pore*strength,resolved);
  float slope=6.*(cell.x-1.)*exp(-pow((cell.x-1.)/.32,2.));
  vec3 capNormal=normalize(vec3(-radial.x*slope,1.,-radial.y*slope));
  float capLight=(.48+.52*max(0.,dot(capNormal,normalize(uSunDirection))))/(.48+.52*max(0.,uSunDirection.y));
  float relief=mix(1.,capLight+.05*rim,resolved);
  return vec2(opacity,relief);
}
vec2 structuredFoamFilm(vec2 world,float footprint,float concentration,float field){
  float c=clamp(concentration,0.,1.);
  // Larger water pockets merge into warped channels rather than a polka-dot
  // array of round holes. Individual bubble caps remain a separate small band.
  float aa=clamp(footprint*5.2*.35,.012,.2),resolved=exp(-pow(footprint*5.2*.95,2.));
  float channels=1.-smoothstep(.32-aa,.45+aa,field),strength=mix(.70,.38,c);
  float meanOpacity=1.-.18*strength;
  vec2 pockets=vec2(mix(meanOpacity,1.-channels*strength,resolved),1.+resolved*(.08*field-.05*channels));
  vec2 bubbles=foamStructureBand(world+vec2(17.31,53.17),footprint,48.,mix(.25,.15,c));
  float mottling=mix(0.,noise(world*2.7+vec2(7.1,19.3))-.5,exp(-pow(footprint*2.7,2.)));
  return vec2(pockets.x*bubbles.x,pockets.y*bubbles.y*(1.04+.14*mottling));
}
`;
