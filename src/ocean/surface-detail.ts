/** Stochastic metric height derivatives shared by water and photon refraction.
 * Unresolved bands contribute slope variance to the reflection BRDF. */
export const capillarySampling=/* glsl */`
  float capillaryHash(vec2 p){
    vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  vec3 capillaryNoiseGradient(vec2 p){
    vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f),du=6.0*f*(1.0-f);
    float a=capillaryHash(i),b=capillaryHash(i+vec2(1,0));
    float c=capillaryHash(i+vec2(0,1)),d=capillaryHash(i+vec2(1));
    float crossTerm=a-b-c+d;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,
      du.x*((b-a)+crossTerm*u.y),du.y*((c-a)+crossTerm*u.x));
  }
  vec2 capillaryBand(vec2 p,float time,float frequency,float amplitude,mat2 frame,vec2 drift){
    vec3 field=capillaryNoiseGradient(frame*p*frequency+drift*time);
    return (field.yz*frame)*(frequency*amplitude);
  }
  vec2 capillarySurfaceSlopeFiltered(vec2 p,float time,float footprint,out float missingVariance){
    // Differently drifting, rotated bands prevent phase-locked parallel ripples.
    vec4 fade=exp(-pow(vec4(.85,3.1,9.7,27.5)*footprint*1.55,vec4(2)));
    vec2 slope=capillaryBand(p,time,.85,.052,mat2(.91,.28,-.28,.91),vec2(.13,-.09))*fade.x;
    slope+=capillaryBand(p,time,3.1,.018,mat2(.64,-.77,.77,.64),vec2(-.28,.17))*fade.y;
    slope+=capillaryBand(p,time,9.7,.006,mat2(.93,.37,-.37,.93),vec2(.38,.31))*fade.z;
    slope+=capillaryBand(p,time,27.5,.0026,mat2(.46,.89,-.89,.46),vec2(-.45,.62))*fade.w;
    // Mean squared slope of each cubic-noise band (CPU quadrature calibrated).
    missingVariance=dot(vec4(.000530,.000934,.001016,.001536),1.0-fade*fade);
    return slope;
  }
  vec2 capillarySurfaceSlope(vec2 p,float time){
    float unused;return capillarySurfaceSlopeFiltered(p,time,0.0,unused);
  }
`;

/** Finite-depth energy transport with a depth-limited breaker envelope.
 * G remains geographic shelter, so open beaches retain swell unlike bays.
 * Shared verbatim by geometry, shading, photon tracing and CPU-height cache.
 */
export const shoreWaveSampling=/* glsl */`
  uniform float uBathyTriangulated;
  vec4 sampleCoastalGround(sampler2D map,vec2 uv,vec2 resolution){
    vec2 node=clamp(uv,vec2(0),vec2(1))*(resolution-1.0);
    vec4 filtered=texture2D(map,(node+.5)/resolution);
    // Match Niijima's indexed triangle diagonal near the wet contact. A
    // bilinear saddle can sit above/below the actual flat render triangle.
    if(uBathyTriangulated<.5||abs(filtered.r)>3.0)return filtered;
    vec2 base=min(floor(node),max(vec2(0),resolution-2.0)),f=node-base;
    vec4 a=texture2D(map,(base+.5)/resolution),b=texture2D(map,(base+vec2(1.5,.5))/resolution);
    vec4 c=texture2D(map,(base+vec2(.5,1.5))/resolution),d=texture2D(map,(base+1.5)/resolution);
    return f.x+f.y<=1.0?a+(b-a)*f.x+(c-a)*f.y:d+(c-d)*(1.0-f.x)+(b-d)*(1.0-f.y);
  }
  float shoreWaveScale(vec2 coast,float swell,float wind){
    float depth=max(0.0,-coast.x);
    float transport=pow(clamp(18.0/max(depth,1.0),1.0,8.0),.125);
    float nominalAmplitude=max(.08,swell*(.10+wind*wind*.013));
    float breakingCap=min(1.0,depth*.38/nominalAmplitude);
    return transport*breakingCap*smoothstep(.015,.22,depth)*clamp(coast.y,.08,1.0);
  }
`;

/** Optional observable only. Include shoreWaveSampling before this snippet.
 * rawFftHeight is the caller's long+short .y BEFORE shore scale and uSwell.
 * H=2*positive crest is a symmetric-wave proxy, not measured individual H.
 * Does not alter displacement, phase, depth cap or existing J-based energy. */
export const shoreBreakerDissipationSampling=/* glsl */`
  float shoreBreakerDissipation(float rawFftHeight,vec2 coast,float swell,float wind){
    float depth=-coast.x;
    // Existing surf-particle domain and protected-cove boundary. Comparisons
    // also reject NaN; finite physical parameter bounds reject infinities.
    if(!(depth>=.2&&depth<=3.8&&coast.y>=.18&&coast.y<=1.0&&
         rawFftHeight>0.0&&rawFftHeight<1000000.0&&
         swell>0.0&&swell<=4.0&&wind>=0.0&&wind<=35.0))return 0.0;
    float transport=pow(clamp(18.0/max(depth,1.0),1.0,8.0),.125);
    float uncappedScale=transport*smoothstep(.015,.22,depth)*clamp(coast.y,.08,1.0);
    float uncappedCrest=rawFftHeight*swell*uncappedScale;
    float heightProxy=2.0*uncappedCrest;
    float limitingHeight=.73*depth;
    if(!(heightProxy>limitingHeight))return 0.0;
    float retained=clamp(shoreWaveScale(coast,swell,wind)/uncappedScale,0.0,1.0);
    float capLoss=1.0-retained*retained;
    float thresholdRatio=limitingHeight/heightProxy;
    float depthExcess=1.0-thresholdRatio*thresholdRatio;
    // Intersection of energy actually removed by the existing amplitude cap
    // and energy beyond the depth-height envelope; continuous at onset.
    return clamp(min(capLoss,depthExcess),0.0,1.0);
  }
`;
