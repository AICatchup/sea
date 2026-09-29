export const atmosphere = /* glsl */ `
  uniform vec3 uSunDirection, uSunColor, uZenith, uHorizon, uCloudColor;
  uniform float uTime, uCloudCoverage, uExposure, uStorm;
  const float PI = 3.14159265359;
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float sum=0.0, amplitude=0.5;
    mat2 rotate = mat2(0.8,0.6,-0.6,0.8);
    for(int i=0;i<5;i++) { sum += amplitude * noise(p); p=rotate*p*2.03+17.1; amplitude*=0.49; }
    return sum;
  }
  vec3 clearSkyRadiance(vec3 ray) {
    float elevation = max(ray.y,0.0);
    float horizon = exp(-pow(elevation,0.72)*4.6);
    vec3 sky = mix(uZenith,uHorizon,horizon);
    float sunDot = max(dot(ray,uSunDirection),0.0);
    sky += uSunColor * pow(sunDot,9.0) * 0.065 * exp(-elevation*2.0);
    sky += uSunColor * pow(sunDot,180.0) * 0.045;
    return sky;
  }
  // A relief cloud layer: broad volumes, smaller billows and light-side thickness.
  // Four noise taps per field keep the same cloud formation affordable in reflections.
  float cloudField(vec2 p) {
    float warp = noise(p*0.24+vec2(19.1,7.8));
    p += vec2(warp,-warp)*1.8;
    float broad = noise(p*0.38+vec2(6.4,1.8));
    float billows = noise(p*0.93+vec2(broad*1.7,13.9));
    float edge = noise(p*2.65+vec2(4.1,billows));
    return broad*0.57+billows*0.31+edge*0.12;
  }
  float volumeNoise(vec3 p) {
    vec3 i=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    vec2 uv=i.xz+vec2(37.0,17.0)*i.y;
    float lower=mix(mix(hash(uv),hash(uv+vec2(1,0)),f.x),
      mix(hash(uv+vec2(0,1)),hash(uv+vec2(1,1)),f.x),f.z);
    uv+=vec2(37.0,17.0);
    float upper=mix(mix(hash(uv),hash(uv+vec2(1,0)),f.x),
      mix(hash(uv+vec2(0,1)),hash(uv+vec2(1,1)),f.x),f.z);
    return mix(lower,upper,f.y);
  }
  float volumeDensity(vec3 p,float detail) {
    float weather=noise(p.xz*0.34+vec2(6.4,1.8));
    float billows=volumeNoise(p*1.25+vec3(0.0,weather*0.55,0.0));
    float fine=volumeNoise(p*3.9+11.7);
    float shape=weather*0.53+mix(0.5,billows,0.3+0.7*sqrt(detail))*0.35+mix(0.5,fine,detail)*0.12;
    float threshold=mix(0.68,0.32,uCloudCoverage);
    float height=(p.y-1.43)/1.04;
    float profile=smoothstep(0.0,0.16,height)*(1.0-smoothstep(0.52,1.0,height));
    return max(shape-threshold,0.0)*profile*3.6;
  }
  vec3 volumeClouds(vec3 ray,vec3 sky) {
    vec2 projectedRay=ray.xz/max(ray.y,0.015);
    float projectionWidth=max(length(dFdx(projectedRay)),length(dFdy(projectedRay)));
    if(ray.y < 0.015) return sky;
    float start=2200.0/ray.y;
    float end=min(3800.0/ray.y,70000.0);
    if(end<=start) return sky;
    float stepSize=(end-start)/32.0;
    vec3 sum=vec3(0.0);
    float transmittance=1.0;
    float sunDot=max(dot(ray,uSunDirection),0.0);
    float forward=pow(sunDot,16.0)*0.13;
    for(int i=0;i<32;i++) {
      float distance=start+(float(i)+0.5)*stepSize;
      vec3 p=ray*distance*0.00065;
      p.xz+=vec2(uTime*0.0025,-uTime*0.0012);
      float pixelWidth=projectionWidth*(distance*ray.y*0.00065);
      // Filter along the ray as well as across the pixel. Sub-step details
      // otherwise form visible bands on distant cloud bases.
      float sampleWidth=max(pixelWidth,stepSize*0.00065);
      float detail=1.0-smoothstep(0.025,0.22,sampleWidth);
      float density=volumeDensity(p,detail);
      if(density>0.001) {
        float opticalDepth=density*stepSize*0.0031;
        float opacity=1.0-exp(-opticalDepth);
        // One light-cone probe gives sunlit billows and darker, thicker bases.
        float lightDensity=volumeDensity(p+uSunDirection*0.52,detail);
        float sunlight=exp(-lightDensity*3.8);
        float height=clamp((p.y-1.43)/1.04,0.0,1.0);
        vec3 ambient=mix(uHorizon*0.22+uZenith*0.20,uCloudColor*0.38,height);
        vec3 illumination=ambient+uCloudColor*sunlight*0.42;
        illumination+=uSunColor*(0.028+forward)*sunlight*(1.0-uStorm*0.65);
        // Far cloud volumes merge with marine haze, preserving the horizon.
        float haze=1.0-exp(-distance*0.000015);
        illumination=mix(illumination,uHorizon,haze*0.60);
        sum+=transmittance*opacity*illumination;
        transmittance*=1.0-opacity;
      }
    }
    return sky*transmittance+sum;
  }
  vec3 skyRadiance(vec3 ray, bool disk) {
    vec3 sky = clearSkyRadiance(ray);
    float sunDot = max(dot(ray,uSunDirection),0.0);
    float cloud=0.0;
    if(ray.y > 0.006 && !disk) {
      vec2 p = ray.xz * (1.8 / max(ray.y,0.055));
      p += vec2(uTime*0.0025,-uTime*0.0012);
      float density = cloudField(p);
      float threshold = mix(0.69,0.29,uCloudCoverage);
      float thickness = max(density-threshold,0.0);
      cloud = smoothstep(threshold-0.025,threshold+0.14,density);
      // The lower edge dissolves into aerial perspective instead of a hard ceiling.
      cloud *= smoothstep(0.012,0.12,ray.y);
      vec2 toLight = uSunDirection.xz/(0.35+max(uSunDirection.y,0.0));
      float lightDensity = cloudField(p+toLight*(0.28+thickness*0.9));
      float sunlit = clamp(0.57+(density-lightDensity)*4.7-thickness*1.2,0.0,1.0);
      vec3 shadow = uHorizon*0.23+uZenith*0.20;
      vec3 light = uCloudColor*(0.66+0.16*max(uSunDirection.y,0.0));
      light += uSunColor*0.052*pow(sunDot,5.0);
      vec3 clouds = mix(shadow,light,smoothstep(0.05,0.90,sunlit));
      float silver = pow(1.0-cloud,2.0)*pow(sunDot,12.0);
      clouds += uSunColor*silver*0.10*(1.0-uStorm*0.75);
      // Cloud bases are darker than their soft, sunlit shoulders.
      clouds *= 1.0-thickness*mix(0.40,0.78,uStorm);
      float atmosphere = 1.0-exp(-max(0.0,0.16-ray.y)*12.0);
      clouds = mix(clouds,uHorizon,atmosphere*0.75);
      sky = mix(sky,clouds,cloud*0.97);
    }
    if(disk) {
      vec3 withClouds=volumeClouds(ray,sky);
      // Local extinction also masks the solar disk through the cloud volume.
      float cloudAtSun=volumeDensity(ray*(3000.0/max(ray.y,0.015))*0.00065,0.0);
      cloud=1.0-exp(-cloudAtSun*9.0);
      sky=withClouds;
    }
    if(disk) {
      float angularRadius = 0.00465;
      float sun = smoothstep(cos(angularRadius*1.4),cos(angularRadius),sunDot);
      sky += uSunColor * sun * 15.0 * (1.0-cloud*0.985);
      sky += uSunColor * pow(sunDot,2600.0) * 0.25 * (1.0-cloud*0.8);
    }
    return sky;
  }
  vec3 displayColor(vec3 color) {
    color *= uExposure;
    color = clamp((color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14),0.0,1.0);
    return pow(color,vec3(1.0/2.2));
  }
`;

export const skyVertex = /* glsl */ `
  varying vec2 vNdc;
  void main() { vNdc = position.xy; gl_Position=vec4(position.xy,1.0,1.0); }
`;

export const skyFragment = /* glsl */ `
  precision highp float;
  varying vec2 vNdc;
  uniform mat4 uCameraWorld, uInverseProjection;
  ${atmosphere}
  void main() {
    vec4 projected = uInverseProjection * vec4(vNdc,1.0,1.0);
    vec3 direction = normalize(mat3(uCameraWorld) * (projected.xyz / projected.w));
    vec3 sky = skyRadiance(direction,true);
    gl_FragColor=vec4(displayColor(sky),1.0);
  }
`;

export const oceanVertex = /* glsl */ `
  uniform sampler2D uLongWaves, uShortWaves;
  uniform float uSwell, uChoppiness;
  varying vec3 vWorld;
  varying vec2 vOcean;
  varying float vDistance;
  void main() {
    vec2 origin = position.xz + cameraPosition.xz;
    float distanceToEye = length(position.xz);
    float shortFade = 1.0-smoothstep(110.0,500.0,distanceToEye);
    vec3 displacement = texture2D(uLongWaves,origin/384.0).xyz
      + texture2D(uShortWaves,origin/24.0).xyz*shortFade;
    vec3 world=vec3(origin.x,0.0,origin.y);
    world.xz += displacement.xz*uChoppiness*uSwell;
    world.y = displacement.y*uSwell;
    // Earth's curvature keeps the far mesh below a true, softly hazed horizon.
    world.y -= distanceToEye*distanceToEye/(2.0*6371000.0);
    vWorld=world;
    vOcean=origin;
    vDistance=distanceToEye;
    gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
  }
`;

export const oceanFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uLongWaves, uShortWaves;
  uniform float uSwell, uChoppiness, uWind;
  uniform vec3 uWaterTint;
  varying vec3 vWorld;
  varying vec2 vOcean;
  varying float vDistance;
  ${atmosphere}

  vec3 longDisplacement(vec2 p) { return texture2D(uLongWaves,p/384.0).xyz; }
  vec3 shortDisplacement(vec2 p) { return texture2D(uShortWaves,p/24.0).xyz; }

  void main() {
    float footprint = max(length(dFdx(vOcean)),length(dFdy(vOcean)));
    // Widen the slope stencil with the pixel footprint: distant waves retain
    // their swell while unresolved capillary and whitecap detail falls away.
    float longStep = max(1.5,min(14.0,footprint*0.65));
    float shortStep = max(0.1875,min(1.5,footprint*0.55));
    float shortFade = (1.0-smoothstep(90.0,480.0,vDistance))*exp(-footprint*0.85);
    vec3 dx=(longDisplacement(vOcean+vec2(longStep,0))-longDisplacement(vOcean-vec2(longStep,0)))/(2.0*longStep);
    vec3 dz=(longDisplacement(vOcean+vec2(0,longStep))-longDisplacement(vOcean-vec2(0,longStep)))/(2.0*longStep);
    dx+=(shortDisplacement(vOcean+vec2(shortStep,0))-shortDisplacement(vOcean-vec2(shortStep,0)))/(2.0*shortStep)*shortFade;
    dz+=(shortDisplacement(vOcean+vec2(0,shortStep))-shortDisplacement(vOcean-vec2(0,shortStep)))/(2.0*shortStep)*shortFade;
    float chop = uChoppiness*uSwell;
    vec3 tangentX=vec3(1.0+dx.x*chop,dx.y*uSwell,dx.z*chop);
    vec3 tangentZ=vec3(dz.x*chop,dz.y*uSwell,1.0+dz.z*chop);
    vec3 normal=normalize(cross(tangentZ,tangentX));
    normal.y=max(abs(normal.y),0.14);
    normal.xz*=1.0/(1.0+footprint*0.022);
    // Band-limit capillary detail to the pixel footprint to avoid distant shimmer.
    float microFade=1.0-smoothstep(0.035,0.36,footprint);
    float microTime=uTime*2.1;
    float irregularity=noise(vOcean*0.42+vec2(uTime*0.025,0.0))*3.8;
    vec2 ripple=vec2(0.0);
    ripple += vec2(0.80,0.60)*cos(dot(vOcean,vec2(0.80,0.60))*19.0+microTime+irregularity)*0.030;
    ripple += vec2(-0.36,0.93)*cos(dot(vOcean,vec2(-0.36,0.93))*31.0-microTime*1.37+irregularity)*0.021;
    ripple += vec2(0.93,-0.37)*cos(dot(vOcean,vec2(0.93,-0.37))*47.0+microTime*1.61-irregularity)*0.012;
    normal.xz-=ripple*microFade*(0.45+uWind*0.035);
    normal=normalize(normal);

    vec3 view=normalize(cameraPosition-vWorld);
    float nV=max(dot(normal,view),0.001);
    vec3 reflected=reflect(-view,normal);
    float skyVisibility=smoothstep(-0.10,0.09,reflected.y);
    // A downward reflection sees the shaded water between waves. Avoid
    // reflecting a bright horizon into every steep, inward-facing slope.
    vec3 interreflection=vec3(0.008,0.025,0.031)*uWaterTint;
    reflected.y=max(reflected.y,0.012);
    reflected=normalize(reflected);
    float fresnel=0.02037+0.97963*pow(1.0-nV,5.0);
    vec3 reflection=mix(interreflection,skyRadiance(reflected,false),skyVisibility);
    float crest=clamp(vWorld.y/(0.35+uWind*uWind*0.010)+0.38,0.0,1.0);
    float sunFacing=max(dot(normal,uSunDirection),0.0);
    float backlight=pow(max(dot(view,-uSunDirection),0.0),4.0);
    vec3 deep=vec3(0.003,0.018,0.026)*uWaterTint;
    vec3 scattering=vec3(0.007,0.069,0.058)*uWaterTint;
    float translucent=pow(crest,2.0)*(0.25+backlight*0.75);
    vec3 body=deep + scattering*(0.15+sunFacing*0.30+translucent*0.70);
    body*=mix(1.0,0.60,uStorm);
    vec3 color=mix(body,reflection,fresnel);

    // GGX direct solar reflection. The surface micro-normal controls the glitter.
    vec3 halfVector=normalize(view+uSunDirection);
    float nH=max(dot(normal,halfVector),0.0);
    float nL=max(dot(normal,uSunDirection),0.0001);
    float vH=max(dot(view,halfVector),0.0);
    float roughness=0.145+0.035*uStorm+min(0.16,footprint*0.045);
    // Include the finite solar disk and unresolved normal variance. This
    // creates a broad, broken sun road instead of clipped needle-like stripes.
    float alpha=roughness*roughness+0.003;
    float a2=alpha*alpha;
    float denominator=nH*nH*(a2-1.0)+1.0;
    float distribution=a2/(PI*denominator*denominator+0.0000005);
    float geometryV=2.0*nV/(nV+sqrt(a2+(1.0-a2)*nV*nV));
    float geometryL=2.0*nL/(nL+sqrt(a2+(1.0-a2)*nL*nL));
    float solarF=0.02037+0.97963*pow(1.0-vH,5.0);
    float specular=distribution*geometryV*geometryL*solarF/(4.0*nV);
    float lit=smoothstep(-0.01,0.035,dot(normal,uSunDirection));
    color+=uSunColor*min(specular,5.0)*1.55*lit*mix(1.0,0.10,uStorm);

    float foam0=texture2D(uLongWaves,vOcean/384.0).a;
    float foam1=texture2D(uShortWaves,vOcean/24.0).a*shortFade;
    float jacobian=(1.0+dx.x*chop)*(1.0+dz.z*chop)-dx.z*dz.x*chop*chop;
    float breaking=1.0-smoothstep(0.05,0.46,jacobian);
    float memory=smoothstep(0.38,0.95,max(foam0,foam1*0.85));
    float foamScale=max(0.6,footprint*1.1);
    float foamDetail=noise(vOcean*1.7/foamScale+vec2(uTime*0.035,-uTime*0.026));
    float pores=smoothstep(0.28,0.73,foamDetail);
    float foam=max(breaking*0.90,memory*0.32);
    foam*=mix(0.22,1.0,pores)*smoothstep(4.0,12.0,uWind);
    foam*=1.0-smoothstep(0.35,3.2,footprint);
    vec3 foamColor=mix(uHorizon,uCloudColor,0.55)*0.57+vec3(0.035);
    color=mix(color,foamColor,clamp(foam,0.0,0.85));

    // Air scattering uses the same atmosphere as the visible sky.
    float fog=1.0-exp(-vDistance*mix(0.00017,0.00062,uStorm));
    vec3 horizon=clearSkyRadiance(normalize(vec3(-view.x,0.005,-view.z)));
    color=mix(color,horizon,clamp(fog,0.0,0.995));
    gl_FragColor=vec4(displayColor(color),1.0);
  }
`;
