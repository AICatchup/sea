/** Single-scattered sunlight in homogeneous water, before phase/scattering
 * coefficients and shadow visibility. Both the eye path and the sun's depth
 * path attenuate light. Depth varies linearly along each straight ray. */
export function waterLightIntegral(start: number, end: number, originY: number,
  rayY: number, sunY: number, extinction: number): number {
  if (![start,end,originY,rayY,sunY,extinction].every(Number.isFinite)
    || start < 0 || end < start || sunY <= 0 || extinction < 0) throw new RangeError('Finite ordered water path required');
  const piece = (a: number, b: number) => {
    const length=b-a;
    if(length<=0)return 0;
    const da=a+Math.max(0,-originY-rayY*a)/sunY;
    const db=b+Math.max(0,-originY-rayY*b)/sunY;
    const half=extinction*(db-da)*.5;
    if(Math.abs(half)<.01)return Math.exp(-extinction*(da+db)*.5)*length*(1+half*half/6);
    return length*(Math.exp(-extinction*da)-Math.exp(-extinction*db))/(extinction*(db-da));
  };
  const crossing=rayY===0?Infinity:-originY/rayY;
  return crossing>start&&crossing<end?piece(start,crossing)+piece(crossing,end):piece(start,end);
}

/** Fixed metric shadow cells do not jump from sub-metres to 62.5m merely
 * because a reflected ray misses the finite terrain mesh. Eight cells retain
 * the previous shadow-tap budget. The tiny distant tail is unshadowed. */
export const waterVolumeGLSL=/* glsl */`
  float waterLightChannel(float a,float b,float length,float sigma){
    float halfOptical=sigma*(b-a)*.5;
    if(abs(halfOptical)<.01)return exp(-sigma*(a+b)*.5)*length*(1.0+halfOptical*halfOptical/6.0);
    return length*(exp(-sigma*a)-exp(-sigma*b))/(sigma*(b-a));
  }
  vec3 waterLightPiece(float a,float b,float originY,float rayY,float sunY,vec3 sigma){
    float span=max(0.0,b-a);if(span<=0.0)return vec3(0);
    float da=a+max(0.0,-originY-rayY*a)/sunY;
    float db=b+max(0.0,-originY-rayY*b)/sunY;
    return vec3(waterLightChannel(da,db,span,sigma.r),waterLightChannel(da,db,span,sigma.g),waterLightChannel(da,db,span,sigma.b));
  }
  vec3 waterLightIntegral(float a,float b,float originY,float rayY,float sunY,vec3 sigma){
    float crossing=abs(rayY)>1e-7?-originY/rayY:-1.0;
    if(crossing>a&&crossing<b)return waterLightPiece(a,crossing,originY,rayY,sunY,sigma)+waterLightPiece(crossing,b,originY,rayY,sunY,sigma);
    return waterLightPiece(a,b,originY,rayY,sunY,sigma);
  }
  float waterShadowCellStart(int i){return 2.0*(exp2(float(i))-1.0);}
`;
