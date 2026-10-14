/** Bounded optical-density rendering of aerated impact water.
 * The density is authored inside advected impact volumes, not a FLIP solver.
 * Unlike a shaded mesh skin, an empty ray contributes no opaque outer shell. */
export const impactFrothGLSL=/* glsl */`
  varying vec3 vFrothCenter,vFrothRadii;
  varying vec2 vFrothAxis,vFrothSlope;
  vec3 frothLocal(vec3 p){return vec3(p.x*vFrothAxis.x+p.z*vFrothAxis.y,p.y,-p.x*vFrothAxis.y+p.z*vFrothAxis.x)/max(vFrothRadii,vec3(.001));}
  float frothHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
  float frothNoise3(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(frothHash(i),frothHash(i+vec3(1,0,0)),f.x),mix(frothHash(i+vec3(0,1,0)),frothHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(frothHash(i+vec3(0,0,1)),frothHash(i+vec3(1,0,1)),f.x),mix(frothHash(i+vec3(0,1,1)),frothHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float frothDensity(vec3 p,vec3 world){
    float envelope=1.-smoothstep(.62,.86,length(p));
    // Density follows its advected impact centre in three dimensions.
    // No vertically extruded XZ image or stationary painted ground texture.
    vec3 material=world-vFrothCenter+vec3(vSeed*11.,vSeed*7.,vSeed*19.);
    float coarse=frothNoise3(material*3.2),fine=frothNoise3(material*10.7);
    return envelope*smoothstep(.34,.68,coarse*.72+fine*.28);
  }
  vec4 impactFroth(){
    vec3 ray=normalize(vFoamWorld-cameraPosition);
    vec3 ro=frothLocal(cameraPosition-vFrothCenter),rd=frothLocal(ray);
    float a=dot(rd,rd),b=dot(ro,rd),c=dot(ro,ro)-.86*.86;
    float discriminant=b*b-a*c;if(discriminant<=0.)return vec4(0.);
    float root=sqrt(discriminant),start=max(0.,(-b-root)/a),finish=(-b+root)/a;
    if(finish<=start)return vec4(0.);
    float stepLength=(finish-start)/12.,opacity=0.;vec3 radiance=vec3(0.);
    vec3 light=normalize(uSunDirection);
    for(int j=0;j<12;j++){
      float t=start+(float(j)+.5)*stepLength;
      vec3 world=cameraPosition+ray*t,local=ro+rd*t;
      float water=vFrothCenter.y-.56*vFrothRadii.y+dot(vFrothSlope,world.xz-vFrothCenter.xz);
      float density=frothDensity(local,world)*smoothstep(-.025,.14,world.y-water);
      // Beer-Lambert extinction scales with metres travelled, not mesh size
      // in screen pixels. Airy edges and dense centres emerge from thickness.
      float absorb=1.-exp(-density*8.*vAlpha*stepLength);
      float selfShadow=exp(-(frothDensity(local+frothLocal(light)*.12,world+light*.12)+frothDensity(local+frothLocal(light)*.30,world+light*.30))*1.8);
      vec3 irradiance=uHorizon*.22+uSunColor*(.18*selfShadow);
      float resolved=exp(-pow(length(fwidth(vFoamWorld))*18.,2.));
      float micro=mix(.5,frothNoise3((world-vFrothCenter)*32.),resolved);
      radiance+=(1.-opacity)*absorb*uTint*irradiance*(.76+.24*micro);
      opacity+=(1.-opacity)*absorb;
    }
    return vec4(radiance/max(.0001,opacity),opacity);
  }
`;
