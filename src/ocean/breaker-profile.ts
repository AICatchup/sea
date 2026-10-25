/** Sub-grid front reconstruction shared by visible water and jet contact.
 * A heightfield cannot overturn. Its broad resolved shoulder must release
 * space for the separately tracked falling jet, rather than lifting that jet
 * above an unchanged broad mound. This is a bounded visual closure, not VOF. */
export const BREAKER_PROFILE_LIMIT=24;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export class BreakerProfiles {
  readonly crests=new Float32Array(BREAKER_PROFILE_LIMIT*4);
  readonly axes=new Float32Array(BREAKER_PROFILE_LIMIT*4);
  count=0;
  height(x:number,z:number,raw:number):number{
    let result=raw;
    for(let i=0;i<this.count;i++){
      const k=i*4,c=this.crests,a=this.axes,dx=x-c[k],dz=z-c[k+1],q=dx*a[k]+dz*a[k+1],across=-dx*a[k+1]+dz*a[k];
      const reach=3+c[k+3]*3;
      if(q<=0||q>=reach||Math.abs(across)>=a[k+2])continue;
      const edge=1-smooth(a[k+2]*.55,a[k+2],Math.abs(across));
      const strength=a[k+3]*edge*(1-smooth(reach*.6,reach,q));
      const width=.55+c[k+3]*.18,target=c[k+2]-c[k+3]*(1-Math.exp(-q*q/(width*width)));
      result=Math.min(result,raw+(target-raw)*strength);
    }
    return result;
  }
}
export const breakerProfileSampling=/*glsl*/`
uniform int uBreakerProfileCount;
uniform vec4 uBreakerProfileCrests[${BREAKER_PROFILE_LIMIT}],uBreakerProfileAxes[${BREAKER_PROFILE_LIMIT}];
float reconstructedBreakerSurface(vec2 world,float raw){
  float result=raw;
  for(int i=0;i<${BREAKER_PROFILE_LIMIT};i++){
    if(i>=uBreakerProfileCount)break;
    vec4 c=uBreakerProfileCrests[i],a=uBreakerProfileAxes[i];vec2 delta=world-c.xy;
    float q=dot(delta,a.xy),across=dot(delta,vec2(-a.y,a.x)),reach=3.+c.w*3.;
    if(q<=0.||q>=reach||abs(across)>=a.z)continue;
    float edge=1.-smoothstep(a.z*.55,a.z,abs(across));
    float strength=a.w*edge*(1.-smoothstep(reach*.6,reach,q));
    float width=.55+c.w*.18,target=c.z-c.w*(1.-exp(-q*q/(width*width)));
    result=min(result,mix(raw,target,strength));
  }
  return result;
}
`;
