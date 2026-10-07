/** Photographic shape reference, not a surveyed tide/elevation datum. The GSI
 * foam band is interpreted at roughly half a metre per pixel. A broad fit
 * removes individual breaking-wave lobes before the profile enters the DEM.
 */
export const TOMARI_STRAND_REFERENCE = Object.freeze({
  source: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/18/232442/104422.jpg',
  eastSource: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/18/232443/104422.jpg',
  attribution: '国土地理院 地理院タイル（全国最新写真）を参照して作成',
  sourceSha256: '591dfc350f5afb9317a476f180b98a4cdffb1631b1a257e4b8d7939ba9b426b6',
  eastSourceSha256: 'c735aac164dc5b22ba4470c112a7117320fd39f9190e286b27cbf9ddb330b357',
  captureDateAndTide: 'not established',
  origin: [-113.50933682551104, -72.54439167967206] as const,
  span: [126.23545010247444, 126.23532265575875] as const,
  pixelFitRMSE: 1.8489479987879993,
  cubic: [-15.690662278897475, -49.412704942116754, -13.951871657753989, 177.22973901098896] as const,
});
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ref = TOMARI_STRAND_REFERENCE, [a,b,c,d] = ref.cubic;
const pixels: [number,number][] = Array.from({length:14},(_,i)=>{const x=40+i*16,u=(x-128)/128;return [x,((a*u+b)*u+c)*u+d];});
pixels.push([256,96],[264,76],[272,44],[280,21]);
export const TOMARI_STRAND_POINTS: readonly (readonly [number,number])[] = Object.freeze(pixels.map(([x,z])=>Object.freeze([
  ref.origin[0]+x/256*ref.span[0],ref.origin[1]+z/256*ref.span[1],
] as [number,number])));
const intervals=TOMARI_STRAND_POINTS.slice(1).map((point,i)=>point[0]-TOMARI_STRAND_POINTS[i][0]);
const secants=intervals.map((span,i)=>(TOMARI_STRAND_POINTS[i+1][1]-TOMARI_STRAND_POINTS[i][1])/span);
// Shape-preserving Hermite tangents: no spline overshoot at the beach apex.
const tangents=TOMARI_STRAND_POINTS.map((_,i)=>{
  if(i===0)return secants[0];if(i===TOMARI_STRAND_POINTS.length-1)return secants.at(-1)!;
  const left=secants[i-1],right=secants[i];if(left*right<=0)return 0;
  const w1=2*intervals[i]+intervals[i-1],w2=intervals[i]+2*intervals[i-1];return (w1+w2)/(w1/left+w2/right);
});
export function tomariStrandReferenceAt(x:number):{z:number;slope:number;endWeight:number}|null{
  const first=TOMARI_STRAND_POINTS[0][0],last=TOMARI_STRAND_POINTS.at(-1)![0];
  if(!Number.isFinite(x)||x<first||x>last)return null;
  let i=0;while(i<TOMARI_STRAND_POINTS.length-2&&x>TOMARI_STRAND_POINTS[i+1][0])i++;
  const h=intervals[i],t=(x-TOMARI_STRAND_POINTS[i][0])/h,t2=t*t,t3=t2*t;
  const p=TOMARI_STRAND_POINTS[i][1],q=TOMARI_STRAND_POINTS[i+1][1],m=tangents[i],n=tangents[i+1];
  return {z:(2*t3-3*t2+1)*p+(t3-2*t2+t)*h*m+(-2*t3+3*t2)*q+(t3-t2)*h*n,
    slope:((6*t2-6*t)*p+(-6*t2+6*t)*q)/h+(3*t2-4*t+1)*m+(3*t2-2*t)*n,
    endWeight:smooth(0,8,x-first)*smooth(0,8,last-x)};
}

export interface StrandGrid {ground:Float32Array;width:number;height:number;dx:number;dz:number;minX:number;minZ:number;}
/** Reconstruct the low sandy profile only. Navigation-depth water, high land,
 * steep rock and patch edges retain their existing samples exactly.
 */
export function refineTomariStrand(grid:StrandGrid):{changed:number;maximumDelta:number;meanAbsoluteDelta:number;westernJoinVertices:number}{
  const {ground,width,height,dx,dz,minX,minZ}=grid;
  if(width*height!==ground.length||dx<=0||dz<=0)throw new Error('Invalid strand grid');
  const original=ground.slice();let changed=0,maximumDelta=0,total=0;
  for(let ix=1;ix<width-1;ix++){
    const x=minX+ix*dx,curve=tomariStrandReferenceAt(x);if(!curve||curve.endWeight===0)continue;
    for(let iz=1;iz<height-1;iz++){
      const index=iz*width+ix,y=original[index];if(y<=-.9||y>=1.6)continue;
      const z=minZ+iz*dz,normalDistance=(z-curve.z)/Math.hypot(1,curve.slope);
      if(Math.abs(normalDistance)>=18)continue;
      let lowest=y;
      // Preserve all vertices of triangles touching protected deeper water,
      // not just individual deep vertices: the navigable contour stays exact.
      for(let oz=-1;oz<=1;oz++)for(let ox=-1;ox<=1;ox++)lowest=Math.min(lowest,original[index+oz*width+ox]);
      const slope=Math.hypot((original[index+1]-original[index-1])/(2*dx),(original[index+width]-original[index-width])/(2*dz));
      const domain=curve.endWeight*smooth(-.9,-.55,lowest)*(1-smooth(.8,1.6,y))*(1-smooth(.28,.60,slope))*(1-smooth(10,18,Math.abs(normalDistance)));
      const target=normalDistance*(.04+.055*smooth(-4,4,normalDistance));
      const delta=Math.max(-1.2,Math.min(1.2,target-y))*domain;
      ground[index]=y+delta;
      const change=Math.abs(ground[index]-y);if(change>1e-7){changed++;total+=change;maximumDelta=Math.max(maximumDelta,change);}
    }
  }
  // Fair the low-confidence western join into the unchanged rock-foot shore.
  // This changes the actual heightfield, not a screen-space water-edge blur.
  // The well-supported photographic arc east of x=-85 remains constrained.
  const profiled=ground.slice(),sigma=1.6,radius=Math.ceil(3*sigma/Math.min(dx,dz));
  const kernel:{ox:number;oz:number;weight:number}[]=[];
  for(let oz=-radius;oz<=radius;oz++)for(let ox=-radius;ox<=radius;ox++)kernel.push({ox,oz,weight:Math.exp(-((ox*dx)**2+(oz*dz)**2)/(2*sigma*sigma))});
  let westernJoinVertices=0;
  for(let ix=1;ix<width-1;ix++){
    const x=minX+ix*dx;if(x<=-97||x>=-85)continue;
    for(let iz=1;iz<height-1;iz++){
      const z=minZ+iz*dz,r2=((x+88)/9)**2+((z-8)/14)**2;if(r2>=1)continue;
      const index=iz*width+ix,y=original[index];if(y<=-.9||y>=1.6)continue;
      let lowest=y;for(let oz=-1;oz<=1;oz++)for(let ox=-1;ox<=1;ox++)lowest=Math.min(lowest,original[index+oz*width+ox]);
      const slope=Math.hypot((original[index+1]-original[index-1])/(2*dx),(original[index+width]-original[index-width])/(2*dz));
      const weight=(1-smooth(.2,1,r2))*(1-smooth(-87,-85,x))*smooth(-.9,-.55,lowest)*(1-smooth(.8,1.6,y))*(1-smooth(.28,.60,slope));
      if(weight<=0)continue;
      let sum=0,mass=0;for(const k of kernel){const sx=ix+k.ox,sz=iz+k.oz;if(sx<0||sx>=width||sz<0||sz>=height)continue;sum+=profiled[sz*width+sx]*k.weight;mass+=k.weight;}
      const next=profiled[index]+Math.max(-.2,Math.min(.2,sum/mass-profiled[index]))*weight;
      ground[index]=Math.max(y-1.2,Math.min(y+1.2,next));if(Math.abs(ground[index]-profiled[index])>1e-7)westernJoinVertices++;
    }
  }
  changed=0;maximumDelta=0;total=0;
  for(let i=0;i<ground.length;i++){const delta=Math.abs(ground[i]-original[i]);if(delta>1e-7){changed++;total+=delta;maximumDelta=Math.max(maximumDelta,delta);}}
  return {changed,maximumDelta,meanAbsoluteDelta:changed?total/changed:0,westernJoinVertices};
}
