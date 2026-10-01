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

/** Actual barycentric bathymetry height-field, independent of camera visibility. */
export const refractedBedGLSL=`
bool traceRefractedBed(vec3 origin,vec3 ray,out float distance,out vec3 hit){
  distance=0.;hit=origin;if(ray.y>=-.08)return false;float previous=0.;bool found=false;
  for(int i=0;i<11;i++){float current=min(90.,.125*exp2(float(i)));vec3 p=origin+ray*current;vec2 uv=(p.xz-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return false;if(p.y<=coastAt(p.xz).x){distance=current;found=true;break;}previous=current;}
  if(!found)return false;for(int i=0;i<8;i++){float t=(previous+distance)*.5;vec3 p=origin+ray*t;if(p.y<=coastAt(p.xz).x)distance=t;else previous=t;}
  hit=origin+ray*distance;return true;
}
vec3 refractedBedNormal(vec3 p){float e=.25;return normalize(vec3(coastAt(p.xz-vec2(e,0)).x-coastAt(p.xz+vec2(e,0)).x,2.*e,coastAt(p.xz-vec2(0,e)).x-coastAt(p.xz+vec2(0,e)).x));}
`;
