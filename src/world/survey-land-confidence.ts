/** A land-only confidence envelope, not a classification of submerged rock.
 * The coastal DTM contains isolated centimetres-above-zero patches surrounded
 * by negative wet samples. Without point classifications those must not lift
 * the inferred seabed into unsupported new islets. Keep terrain >=1m and its
 * immediate 2m foot, then fade to the old bed by 6m from supported dry land.
 * Two-pass octile distance is deliberately conservative and computed once. */
export function surveyLandConfidence(heights:Float32Array,valid:Uint8Array,width:number,height:number,dx:number,dz:number):Float32Array {
 if(heights.length!==width*height||valid.length!==heights.length||dx<=0||dz<=0)throw new Error('Invalid survey confidence grid');
 const d=new Float32Array(heights.length),diagonal=Math.hypot(dx,dz);
 for(let n=0;n<d.length;n++)d[n]=valid[n]&&heights[n]>=1?0:100000;
 for(let j=0;j<height;j++)for(let i=0;i<width;i++){
  const n=j*width+i;
  if(i)d[n]=Math.min(d[n],d[n-1]+dx);
  if(j){d[n]=Math.min(d[n],d[n-width]+dz);if(i)d[n]=Math.min(d[n],d[n-width-1]+diagonal);if(i+1<width)d[n]=Math.min(d[n],d[n-width+1]+diagonal);}
 }
 for(let j=height-1;j>=0;j--)for(let i=width-1;i>=0;i--){
  const n=j*width+i;
  if(i+1<width)d[n]=Math.min(d[n],d[n+1]+dx);
  if(j+1<height){d[n]=Math.min(d[n],d[n+width]+dz);if(i)d[n]=Math.min(d[n],d[n+width-1]+diagonal);if(i+1<width)d[n]=Math.min(d[n],d[n+width+1]+diagonal);}
 }
 for(let n=0;n<d.length;n++){const t=Math.max(0,Math.min(1,(d[n]-2)/4));d[n]=1-t*t*(3-2*t);}
 return d;
}
