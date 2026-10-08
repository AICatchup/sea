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

/** Inferred mesoscopic geometry for the native-backed study. Resistant beds
 * have a broad planar face and a narrow lip/underside, rather than a rounded
 * Gaussian ridge. Seeded cellular joints partition faces into unequal shards.
 * These authored boundaries are not registered observations of Niijima beds. */
export function niijimaStratifiedRelief(z:number,height:number):{retreat:number;tone:number} {
  const boundaries=[8.1,10.3,13.7,15.1,19.4,21.9,23.2,27.6,30.4,34.8,36.2,41.4,46.2,47.5,53.4,59.1,60.8,65.7,71.2,74.9,79.3,82.1];
  let hard=0,cut=0;
  for(let i=0;i<boundaries.length;i++){
    const drift=(noise(z*.012,i*3.71+2)-.5)*.65+(noise(z*.051,i+19)-.5)*.25;
    const y=height-boundaries[i]-drift,thickness=.38+noise(i*4.3,9)*1.1;
    const persistence=ease(.15,.45,noise(z*.033,i*2.7+4));
    hard+=ease(-thickness-.12,-thickness+.06,y)*(1-ease(-.02,.13,y))*persistence*.9;
    cut+=ease(-.04,.14,y)*(1-ease(.28,.55,y))*persistence*.75;
  }
  const az=Math.floor(z/6.7),ay=Math.floor(height/4.9);let first=Infinity,second=Infinity,plane=0;
  for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){
    const a=az+j,b=ay+k,cZ=(a+.15+.7*noise(a*1.3,b*1.7))*6.7,cY=(b+.15+.7*noise(a*2.1+43,b*.9))*4.9;
    const dz=(z-cZ)/6.7,dy=(height-cY)/4.9,d=dz*dz+dy*dy;
    if(d<first){second=first;first=d;plane=(noise(a*2.7+17,b*3.1)-.5)*.4+dz*.16*(noise(a,b+8)-.5)+dy*.12*(noise(a+9,b)-.5);}
    else second=Math.min(second,d);
  }
  const joint=(1-ease(.035,.14,second-first))*.58;
  return {retreat:cut-hard+joint+plane,tone:Math.max(.7,Math.min(.96,.88-hard*.035-joint*.07))};
}
