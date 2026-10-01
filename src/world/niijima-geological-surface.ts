import { noise, ease } from './niijima-detail.ts';

/** Photo-informed erosion, not surveyed geology. Unequal hard beds persist in
 * world height; soft intervals retreat and rain grooves interrupt their ledges.
 * No view input, periodic stripe spacing or unrelated rock objects. */
const beds = [8.1, 13.7, 21.9, 30.4, 34.8, 46.2, 59.1, 65.7, 79.3, 94.6, 110.8];
export function niijimaGeologicalSurface(z:number,height:number):{retreat:number;tone:number} {
  let retreat=0, hard=0;
  for(let i=0;i<beds.length;i++) {
    const drift=(noise(z*.009,i*3.71+2)-.5)*3.8+(noise(z*.036,i+19)-.5)*.65;
    const y=height-beds[i]-drift;
    const thickness=.6+noise(i*4.3,9)*1.6;
    const persistence=.45+.55*noise(z*.013,i*2.7+4);
    // Resistant bed protrudes; the softer material immediately above recedes.
    hard+= (1-ease(thickness*.35,thickness,Math.abs(y)))*persistence;
    retreat+=ease(-thickness,0,y)*(1-ease(thickness,thickness+2.8,y))*persistence*1.9;
  }
  const block=(noise(z*.11,height*.15)-.5)*1.2+(noise(z*.033,height*.042)-.5)*2.2;
  return {retreat:retreat-hard*.85+block, tone:Math.max(.68,Math.min(.96,.85-hard*.065+(noise(z*.045,height*.08)-.5)*.11))};
}
