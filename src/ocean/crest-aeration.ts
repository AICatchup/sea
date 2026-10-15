const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** A narrow spilling crest source, not foam painted on every high wave.
 * Compression, depth-limited steepness and a local crest must agree.
 */
export function crestAeration(height:number,back:number,front:number,bed:number,compression:number):number{
  if(![height,back,front,bed,compression].every(Number.isFinite)||height-bed<.15)return 0;
  const ratio=2*Math.max(0,height)/Math.max(.25,-bed);
  return smooth(.025,.22,compression)*smooth(.65,1.15,ratio)*smooth(.025,.18,height-(back+front)*.5)*smooth(.025,.25,height-front)*(1-smooth(.1,.8,bed));
}
export const crestAerationGLSL=/* glsl */`
float crestAeration(float height,float back,float front,float bed,float compression){
  if(height-bed<.15)return 0.;
  float ratio=2.*max(0.,height)/max(.25,-bed);
  return smoothstep(.025,.22,compression)*smoothstep(.65,1.15,ratio)*smoothstep(.025,.18,height-(back+front)*.5)*smoothstep(.025,.25,height-front)*(1.-smoothstep(.1,.8,bed));
}
`;
