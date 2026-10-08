/** Optical response times are authored, not measured soil moisture or sediment transport. */
export const SAND_MOISTURE = Object.freeze({contactStart:.002,contactEnd:.025,filmSeconds:.8,dampSeconds:130});
export function sandContact(clearance:number):number {
  if(!Number.isFinite(clearance))return 0;
  const t=Math.max(0,Math.min(1,(clearance-SAND_MOISTURE.contactStart)/(SAND_MOISTURE.contactEnd-SAND_MOISTURE.contactStart)));
  return t*t*(3-2*t);
}
export function advanceSandMoisture(previous:readonly[number,number],contact:number,seconds:number):[number,number] {
  if(![...previous,contact,seconds].every(Number.isFinite)||seconds<0)throw new RangeError('Finite moisture state and nonnegative elapsed seconds required');
  const clamp=(v:number)=>Math.max(0,Math.min(1,v)),c=clamp(contact);
  return [Math.max(c,clamp(previous[0])*Math.exp(-seconds/SAND_MOISTURE.dampSeconds)),Math.max(c,clamp(previous[1])*Math.exp(-seconds/SAND_MOISTURE.filmSeconds))];
}
export const sandMoistureResponseGLSL=/* glsl */`
float sandContact(float clearance){return smoothstep(${SAND_MOISTURE.contactStart},${SAND_MOISTURE.contactEnd},clearance);}
vec2 advanceSandMoisture(vec2 previous,float contact,float seconds){
  return max(vec2(clamp(contact,0.,1.)),clamp(previous,0.,1.)*exp(-seconds/vec2(${SAND_MOISTURE.dampSeconds.toFixed(1)},${SAND_MOISTURE.filmSeconds})));
}
`;
