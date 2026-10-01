/** Flat-interface analytical control for the GLSL Snell ray / Beer-Lambert path. */
export function flatWaterPath(depth:number,airCosine:number,waterIndex=1.333):number{
  if(![depth,airCosine,waterIndex].every(Number.isFinite)||depth<0||airCosine<0||airCosine>1||waterIndex<1)throw new Error('Finite depth, incidence cosine and water index required');
  const waterCosine=Math.sqrt(1-(1-airCosine*airCosine)/(waterIndex*waterIndex));
  return waterCosine>0?depth/waterCosine:Infinity;
}
/** Screen-depth ray trace. Visible receivers only; finite bracket and bisection. */
export const refractedSceneGLSL=`
  bool refractedReceiver(vec3 p,out vec2 uv,out float residual){
    vec4 eye=viewMatrix*vec4(p,1),clip=uWaterProjection*eye;
    uv=clip.xy/max(.0001,clip.w)*.5+.5;
    if(clip.w<=0.||any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998))))return false;
    float depth=texture2D(uSceneDepth,uv).r;
    residual=depth<.999999?-eye.z-linearDepth(depth):-100000.;return true;
  }
  bool traceRefractedScene(vec3 origin,vec3 ray,out float distance,out vec3 hit,out vec2 uv){
    distance=0.;hit=origin;uv=vec2(0);
    if(ray.y>=-.08)return false;
    float previous=0.,residual;bool found=false;
    for(int i=0;i<11;i++){
      float current=min(90.,.125*exp2(float(i)));
      if(!refractedReceiver(origin+ray*current,uv,residual))return false;
      if(residual>=0.){distance=current;found=true;break;}previous=current;
    }
    if(!found)return false;
    for(int i=0;i<8;i++){float middle=(previous+distance)*.5;if(!refractedReceiver(origin+ray*middle,uv,residual))return false;if(residual>=0.)distance=middle;else previous=middle;}
    hit=origin+ray*distance;return refractedReceiver(hit,uv,residual);
  }
`;
