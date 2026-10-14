/** Crest's licensed foam image is a material, never a camera-facing picture.
 * Two phase-shifted material coordinates follow current SWE velocity. Triplanar
 * projection also covers an overturning vertical face without stretched UVs.
 * This flow-map advection is optical; the actual foam history is transported
 * by SWE/marine fields. It is not a 3D particle-fluid solver. */
export const foamAppearanceGLSL=/* glsl */`
uniform sampler2D uFoamAtlas;
uniform float uFoamAtlasReady,uFoamClock;
#ifndef FOAM_FLOW_SHARED
uniform sampler2D uShoreState;
uniform vec4 uShoreBounds;
uniform float uShoreReady;
#endif
struct FoamAppearance {float field;float tone;vec3 normal;};
float foamImage(vec3 p,vec3 n){
  vec3 w=pow(abs(n),vec3(4));w/=max(.0001,w.x+w.y+w.z);
  vec3 x=texture2D(uFoamAtlas,p.zy/3.3).rgb,y=texture2D(uFoamAtlas,p.xz/3.3).rgb,z=texture2D(uFoamAtlas,p.xy/3.3).rgb;
  float macro=dot(x*w.x+y*w.y+z*w.z,vec3(.2126,.7152,.0722));
  // Resolve small flocs inside the metre-scale rafts, using the same licensed
  // image at a second scale. Mip filtering removes this detail at distance.
  vec3 fineX=texture2D(uFoamAtlas,p.zy/.37+vec2(.27,.61)).rgb;
  vec3 fineY=texture2D(uFoamAtlas,p.xz/.37+vec2(.27,.61)).rgb;
  vec3 fineZ=texture2D(uFoamAtlas,p.xy/.37+vec2(.27,.61)).rgb;
  float fine=dot(fineX*w.x+fineY*w.y+fineZ*w.z,vec3(.2126,.7152,.0722));
  return macro*(.45+.55*fine);
}
FoamAppearance foamAppearance(vec3 world,vec3 n,float footprint){
  vec2 flow=vec2(0),uv=(world.xz-uShoreBounds.xy)/uShoreBounds.zw;
  if(uShoreReady>.5&&all(greaterThan(uv,vec2(.025)))&&all(lessThan(uv,vec2(.975)))){
    vec3 s=texture2D(uShoreState,uv).rgb;if(s.r>.05)flow=clamp(s.yz/s.r,vec2(-6),vec2(6));
  }
  float phase=fract(uFoamClock*.25),other=fract(phase+.5),blend=abs(phase*2.-1.);
  float a=foamImage(world-vec3(flow.x,0,flow.y)*phase*4.,n);
  // At rest both phases sample the same place, so the material does not
  // morph globally when there is no flow to carry it.
  float b=foamImage(world-vec3(flow.x,0,flow.y)*other*4.,n);
  float field=mix(a,b,blend);
  vec3 x=dFdx(world),y=dFdy(world),r1=cross(y,n),r2=cross(n,x);
  float determinant=dot(x,r1),inverse=abs(determinant)>1e-9?1./determinant:0.;
  vec3 slope=(dFdx(field)*r1+dFdy(field)*r2)*inverse;
  slope*=min(1.,14./max(.001,length(slope)));
  vec3 bubbleNormal=normalize(n-slope*.012*exp(-pow(footprint*14.,2.)));
  return FoamAppearance(field,.70+.55*field,bubbleNormal);
}
float foamImageCoverage(float concentration,float field,float footprint){
  float c=clamp(concentration,0.,1.);
  // Optical thickness decays continuously with the transported concentration.
  // A sparse remnant must become translucent, not keep an opaque cutout until
  // a moving threshold abruptly deletes it. Dense impact froth remains white.
  float pores=smoothstep(.035,.46,field);
  float density=mix(.42,pores*pores,exp(-pow(footprint*3.,2.)));
  // Coverage is bounded by transported area fraction. A weak remnant must
  // not be optically amplified into a continuous white carpet.
  return c*density;
}
`;
