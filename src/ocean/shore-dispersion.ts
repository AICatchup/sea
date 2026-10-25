/** Weakly dispersive pressure closure for the unbroken, wet coastal field.
 * Flat-bottom linear symbol: c²/(gd)=(1+(kd)²/15)/(1+2(kd)²/5).
 * This matches tanh(kd)/(kd) through fourth order. It is not a full nonlinear
 * Boussinesq/3D solver: bed-gradient and vertical vorticity terms are omitted.
 * The pressure solve changes momentum, never overwrites the water depth.
 */
export const DISPERSION_PRESSURE_FRACTION=5/6;
export function dispersivePhaseSpeed(depth:number,waveNumber:number):number{
  if(!Number.isFinite(depth)||!Number.isFinite(waveNumber)||depth<=0)return 0;
  const kd2=(depth*waveNumber)**2;
  return Math.sqrt(9.81*depth*(1+kd2/15)/(1+.4*kd2));
}
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function dispersionCoefficient(restDepth:number,minimumWetDepth:number,bedSlope:number):number{
  if(![restDepth,minimumWetDepth,bedSlope].every(Number.isFinite))return 0;
  return .4*Math.max(0,Math.min(12,restDepth))**2*smooth(.35,1,minimumWetDepth)*(1-smooth(.5,1.5,Math.abs(bedSlope)));
}
export const dispersionCoefficientGLSL=/* glsl */`
float dispersionCoefficient(float restDepth,float minimumWetDepth,float bedSlope){
  return .4*pow(clamp(restDepth,0.,12.),2.)*smoothstep(.35,1.,minimumWetDepth)*(1.-smoothstep(.5,1.5,abs(bedSlope)));
}
`;

/** Periodic CPU reference for the same four-neighbour GPU Jacobi operator.
 * n*n input, constant dx. Used for plane-wave phase and residual checks. */
export function solveDispersivePressure(eta:Float64Array,coefficient:Float64Array,n:number,dx:number,iterations:number,initial?:Float64Array):Float64Array{
  let pressure=initial?initial.slice():eta.slice(),next=new Float64Array(eta.length);
  for(let step=0;step<iterations;step++){
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const i=y*n+x,a=coefficient[i]/(dx*dx);
      const sum=pressure[y*n+(x+n-1)%n]+pressure[y*n+(x+1)%n]+pressure[((y+n-1)%n)*n+x]+pressure[((y+1)%n)*n+x];
      next[i]=(eta[i]+a*sum)/(1+4*a);
    }
    [pressure,next]=[next,pressure];
  }
  return pressure;
}

/** Include with the same bed() and state() functions as the transport pass.
 * R=filtered pressure potential, G=eta, B=coefficient/dx², A=wet support.
 * Coefficients are prepared once per RK stage; iterations need only 5 taps.
 */
export const dispersivePressureMain=/* glsl */`
uniform sampler2D uPressure;
uniform float uPressureMode;
${dispersionCoefficientGLSL}
void main(){
  vec2 uv=gl_FragCoord.xy/uSize,e=vec2(1./uSize,0),p=world(uv);
  if(uPressureMode<1.5){
    vec4 c=state(uv),r=state(uv+e),l=state(uv-e),t=state(uv+e.yx),b=state(uv-e.yx);
    float z=bed(p),eta=c.r+z;
    float minWet=min(c.r,min(min(r.r,l.r),min(t.r,b.r)));
    vec2 bedGradient=vec2(bed(p+vec2(uDx,0))-bed(p-vec2(uDx,0)),bed(p+vec2(0,uDx))-bed(p-vec2(0,uDx)))/(2.*uDx);
    float coefficient=dispersionCoefficient(-z,minWet,length(bedGradient));
    #ifndef SHORE_PERIODIC_PROBE
    float edge=min(min(gl_FragCoord.x,gl_FragCoord.y),min(uSize-gl_FragCoord.x,uSize-gl_FragCoord.y));
    coefficient*=smoothstep(2.,8.,edge);
    #endif
    float start=uPressureMode<.5?eta:texture2D(uPressure,uv).r;
    gl_FragColor=vec4(coefficient>0.?start:eta,eta,coefficient/(uDx*uDx),step(.01,c.r));return;
  }
  vec4 c=texture2D(uPressure,uv);
  #ifdef SHORE_PERIODIC_PROBE
  float sum=texture2D(uPressure,fract(uv+e)).r+texture2D(uPressure,fract(uv-e)).r+texture2D(uPressure,fract(uv+e.yx)).r+texture2D(uPressure,fract(uv-e.yx)).r;
  #else
  float sum=texture2D(uPressure,uv+e).r+texture2D(uPressure,uv-e).r+texture2D(uPressure,uv+e.yx).r+texture2D(uPressure,uv-e.yx).r;
  #endif
  gl_FragColor=vec4((c.g+c.b*sum)/(1.+4.*c.b),c.gba);
}
`;
