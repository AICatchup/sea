/** Shared centimetre-scale slopes: sunlight and visible water use the same surface. */
export const capillarySampling=/* glsl */`
  float capillaryHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float capillaryNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(capillaryHash(i),capillaryHash(i+vec2(1,0)),f.x),mix(capillaryHash(i+vec2(0,1)),capillaryHash(i+1.0),f.x),f.y);
  }
  float capillaryHeight(vec2 p,float time){
    vec2 drift=vec2(time*.23,-time*.18);
    return capillaryNoise(p*6.3+drift)*.008+capillaryNoise(p*12.7-drift*.7+vec2(9.2,5.7))*.003;
  }
  vec2 capillarySurfaceSlope(vec2 p,float time){
    float phase=capillaryNoise(p*.42+vec2(time*.025,0))*3.8,t=time*2.1;
    vec2 slope=vec2(.80,.60)*cos(dot(p,vec2(.80,.60))*19.0+t+phase)*.03375;
    slope+=vec2(-.36,.93)*cos(dot(p,vec2(-.36,.93))*31.0-t*1.37+phase)*.02070;
    slope+=vec2(.93,-.37)*cos(dot(p,vec2(.93,-.37))*47.0+t*1.61-phase)*.01125;
    slope+=vec2(capillaryHeight(p+vec2(.018,0),time)-capillaryHeight(p-vec2(.018,0),time),capillaryHeight(p+vec2(0,.018),time)-capillaryHeight(p-vec2(0,.018),time))/.036;
    return slope;
  }
`;
