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
  vec3 skyRadiance(vec3 ray, bool disk) {
    float elevation = max(ray.y,0.0);
    float horizon = exp(-elevation*4.5);
    vec3 sky = mix(uZenith,uHorizon,horizon);
    float sunDot = max(dot(ray,uSunDirection),0.0);
    sky += uSunColor * pow(sunDot,9.0) * 0.075 * exp(-elevation*2.0);
    sky += uSunColor * pow(sunDot,160.0) * 0.035;
    float cloud=0.0;
    if(ray.y > 0.006) {
      vec2 p = ray.xz * (1.25 / max(ray.y,0.045));
      p += vec2(uTime*0.003, -uTime*0.0015);
      float base = fbm(p*0.92 + vec2(6.4,1.8));
      float detail = fbm(p*2.3+base*1.4);
      float density = base*0.8 + detail*0.2;
      float threshold = mix(0.67,0.30,uCloudCoverage);
      cloud = smoothstep(threshold, threshold+0.16, density);
      cloud *= smoothstep(0.012,0.09,ray.y);
      float lightDensity = fbm(p*0.92 + vec2(6.4,1.8) + uSunDirection.xz*0.18);
      float rim = clamp((base-lightDensity)*6.0+0.60,0.18,1.0);
      vec3 shadow = mix(uHorizon*0.48,uZenith*0.38,uStorm);
      vec3 light = uCloudColor + uSunColor * pow(sunDot,12.0)*0.11;
      vec3 clouds = mix(shadow,light,rim);
      float veil = smoothstep(0.47,0.73,fbm(p*0.27+31.0)) * 0.13;
      sky = mix(sky,uCloudColor,veil*(1.0-uStorm));
      sky = mix(sky,clouds,cloud*0.94);
    }
    if(disk) {
      float angularRadius = 0.00465;
      float sun = smoothstep(cos(angularRadius*1.4),cos(angularRadius),sunDot);
      sky += uSunColor * sun * 18.0 * (1.0-cloud*0.97);
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
    float longStep = 1.5;
    float shortStep = 0.1875;
    float shortFade = 1.0-smoothstep(110.0,500.0,vDistance);
    vec3 dx=(longDisplacement(vOcean+vec2(longStep,0))-longDisplacement(vOcean-vec2(longStep,0)))/(2.0*longStep);
    vec3 dz=(longDisplacement(vOcean+vec2(0,longStep))-longDisplacement(vOcean-vec2(0,longStep)))/(2.0*longStep);
    dx+=(shortDisplacement(vOcean+vec2(shortStep,0))-shortDisplacement(vOcean-vec2(shortStep,0)))/(2.0*shortStep)*shortFade;
    dz+=(shortDisplacement(vOcean+vec2(0,shortStep))-shortDisplacement(vOcean-vec2(0,shortStep)))/(2.0*shortStep)*shortFade;
    float chop = uChoppiness*uSwell;
    vec3 tangentX=vec3(1.0+dx.x*chop,dx.y*uSwell,dx.z*chop);
    vec3 tangentZ=vec3(dz.x*chop,dz.y*uSwell,1.0+dz.z*chop);
    vec3 normal=normalize(cross(tangentZ,tangentX));
    normal.y=max(normal.y,0.12);
    float footprint = max(length(dFdx(vOcean)),length(dFdy(vOcean)));
    // Band-limit capillary detail to the pixel footprint to avoid distant shimmer.
    float microFade=1.0-smoothstep(0.025,0.42,footprint);
    float microTime=uTime*2.3;
    vec2 ripple=vec2(0.0);
    ripple += vec2(0.80,0.60)*cos(dot(vOcean,vec2(0.80,0.60))*19.0+microTime)*0.040;
    ripple += vec2(-0.36,0.93)*cos(dot(vOcean,vec2(-0.36,0.93))*31.0-microTime*1.37)*0.025;
    ripple += vec2(0.93,-0.37)*cos(dot(vOcean,vec2(0.93,-0.37))*47.0+microTime*1.61)*0.016;
    normal.xz-=ripple*microFade*(0.5+uWind*0.055);
    normal=normalize(normal);

    vec3 view=normalize(cameraPosition-vWorld);
    float nV=max(dot(normal,view),0.001);
    vec3 reflected=reflect(-view,normal);
    float skyVisibility=smoothstep(-0.025,0.12,reflected.y);
    reflected.y=max(reflected.y,0.012);
    reflected=normalize(reflected);
    float fresnel=0.02037+0.97963*pow(1.0-nV,5.0);
    vec3 reflection=mix(vec3(0.008,0.029,0.035)*uWaterTint,skyRadiance(reflected,false),skyVisibility);
    float crest=clamp(vWorld.y/(0.6+uWind*uWind*0.008)+0.45,0.0,1.0);
    float sunFacing=max(dot(normal,uSunDirection),0.0);
    float backlight=pow(max(dot(view,-uSunDirection),0.0),3.0);
    vec3 deep=vec3(0.004,0.026,0.037)*uWaterTint;
    vec3 scattering=vec3(0.010,0.105,0.080)*uWaterTint;
    vec3 body=deep + scattering*(crest*0.50+0.22)*(0.30+sunFacing*0.7+backlight*1.2);
    body*=mix(1.0,0.52,uStorm);
    vec3 color=mix(body,reflection,fresnel);

    // GGX direct solar reflection. The surface micro-normal controls the glitter.
    vec3 halfVector=normalize(view+uSunDirection);
    float nH=max(dot(normal,halfVector),0.0);
    float nL=max(dot(normal,uSunDirection),0.001);
    float vH=max(dot(view,halfVector),0.0);
    float roughness=0.085+0.012*uStorm+min(0.1,footprint*0.012);
    float alpha=roughness*roughness;
    float a2=alpha*alpha;
    float denominator=nH*nH*(a2-1.0)+1.0;
    float distribution=a2/(PI*denominator*denominator+0.0000001);
    float geometryV=2.0*nV/(nV+sqrt(a2+(1.0-a2)*nV*nV));
    float geometryL=2.0*nL/(nL+sqrt(a2+(1.0-a2)*nL*nL));
    float solarF=0.02037+0.97963*pow(1.0-vH,5.0);
    float specular=distribution*geometryV*geometryL*solarF/(4.0*nV);
    color+=uSunColor*specular*2.8*mix(1.0,0.14,uStorm);

    float foam0=texture2D(uLongWaves,vOcean/384.0).a;
    float foam1=texture2D(uShortWaves,vOcean/24.0).a*shortFade;
    float foam=clamp(foam0+foam1*0.85,0.0,1.0);
    float foamDetail=fbm(vOcean*2.8+vec2(uTime*0.08,-uTime*0.06));
    float pores=smoothstep(0.27,0.63,foamDetail);
    foam*=mix(0.4,1.0,pores);
    vec3 foamColor=mix(uHorizon,uCloudColor,0.65)*0.8+vec3(0.075);
    color=mix(color,foamColor,foam*0.8);

    // Air scattering uses the same atmosphere as the visible sky.
    float fog=1.0-exp(-vDistance*mix(0.00023,0.00080,uStorm));
    vec3 horizon=skyRadiance(normalize(vec3(-view.x,0.015,-view.z)),false);
    color=mix(color,horizon,clamp(fog,0.0,0.995));
    gl_FragColor=vec4(displayColor(color),1.0);
  }
`;
