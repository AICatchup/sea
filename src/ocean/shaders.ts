import { photographicSkySampling } from './photographic-sky';
import { capillarySampling, shoreWaveSampling } from './surface-detail';
import { shoreSolverSampling } from './shore-solver.ts';
import {surfaceFoamGLSL} from './surface-foam.ts';

export const atmosphere = /* glsl */ `
  ${photographicSkySampling}
  uniform float uUseSky;
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
    float start=(2200.0-cameraPosition.y)/ray.y;
    float end=min((3800.0-cameraPosition.y)/ray.y,70000.0);
    if(end<=start) return sky;
    float stepSize=(end-start)/32.0;
    vec3 sum=vec3(0.0);
    float transmittance=1.0;
    float sunDot=max(dot(ray,uSunDirection),0.0);
    float forward=pow(sunDot,16.0)*0.13;
    for(int i=0;i<32;i++) {
      float distance=start+(float(i)+0.5)*stepSize;
      vec3 p=(cameraPosition+ray*distance)*0.00065;
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
    if(uUseSky>0.5)return photographicSkyRadiance(ray);
    vec3 sky = clearSkyRadiance(ray);
    float sunDot = max(dot(ray,uSunDirection),0.0);
    float cloud=0.0;
    if(ray.y > 0.006 && !disk) {
      vec2 p = ray.xz * (1.8 / max(ray.y,0.055));
      p += cameraPosition.xz*0.00065;
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
      float cloudAtSun=volumeDensity((cameraPosition+ray*((3000.0-cameraPosition.y)/max(ray.y,0.015)))*0.00065,0.0);
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
    gl_FragColor=vec4(sky,1.0);
  }
`;

export const oceanVertex = /* glsl */ `
  uniform sampler2D uLongWaves, uShortWaves;
  uniform sampler2D uBathymetry;
  uniform vec4 uBathyBounds;
  uniform vec2 uBathyResolution;
  uniform float uSwell, uChoppiness, uWind;
  varying vec3 vWorld;
  varying vec2 vOcean;
  varying float vDistance;
  ${shoreWaveSampling}
  ${shoreSolverSampling}
  vec3 vertexCoast(vec2 p){
    vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return vec3(-110.0,1.0,0.0);
    return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rgb;
  }
  void main() {
    vec2 origin = position.xz + cameraPosition.xz;
    float distanceToEye = length(position.xz);
    float shortFade = 1.0-smoothstep(110.0,500.0,distanceToEye);
    vec3 displacement = texture2D(uLongWaves,origin/384.0).xyz
      + texture2D(uShortWaves,origin/24.0).xyz*shortFade;
    vec3 coast=vertexCoast(origin);
    float shoal=shoreWaveScale(coast.rg,uSwell,uWind);
    displacement*=shoal;
    vec3 world=vec3(origin.x,0.0,origin.y);
    world.xz += displacement.xz*uChoppiness*uSwell;
    world.y = displacement.y*uSwell;
    world.y = shoreSolvedSurface(world.xz,world.y,0.).x;
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
  uniform sampler2D uBathymetry, uSceneColor, uSceneDepth, uSceneOcclusion, uReflection;
  uniform sampler2DShadow uSunShadow;
  uniform mat4 uSunShadowMatrix;
  uniform vec2 uSunShadowTexel, uReflectionResolution;
  uniform float uShadowReady;
  uniform mat4 uReflectionMatrix;
  uniform sampler2D uReflectionDepth;
  uniform mat4 uReflectionInverseProjection,uReflectionCameraWorld;
  uniform float uHasReflection;
  uniform float uPointwiseContact;
  uniform float uContactDebug;
  uniform vec4 uBathyBounds;
  uniform vec2 uBathyResolution, uResolution, uNearFar;
  uniform float uUnderwater;
  uniform float uSwell, uChoppiness, uWind;
  uniform vec3 uWaterTint;
  varying vec3 vWorld;
  varying vec2 vOcean;
  varying float vDistance;
  ${atmosphere}
  ${shoreWaveSampling}
  ${shoreSolverSampling}

  vec3 coastAt(vec2 p){
    vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return vec3(-110.0,1.0,0.0);
    return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rgb;
  }
  float shoalAt(vec2 p){return shoreWaveScale(coastAt(p).rg,uSwell,uWind);}
  vec3 longDisplacement(vec2 p) { return texture2D(uLongWaves,p/384.0).xyz*shoalAt(p); }
  vec3 shortDisplacement(vec2 p) { return texture2D(uShortWaves,p/24.0).xyz*shoalAt(p); }
  float renderedSurface(vec2 world){
    vec2 p=world;for(int i=0;i<3;i++)p=world-(longDisplacement(p)+shortDisplacement(p)).xz*uSwell*uChoppiness;
    return shoreSolvedSurface(world,(longDisplacement(p).y+shortDisplacement(p).y)*uSwell,0.).x;
  }
  float linearDepth(float d){float n=uNearFar.x,f=uNearFar.y;return 2.0*n*f/(f+n-(d*2.0-1.0)*(f-n));}
  float surfaceSunVisibility(vec3 p){
    if(uShadowReady<.5)return 1.0;
    vec4 projected=uSunShadowMatrix*vec4(p,1);vec3 q=projected.xyz/projected.w;
    if(any(lessThan(q,vec3(0)))||any(greaterThan(q,vec3(1))))return 1.0;
    vec2 s=uSunShadowTexel*.8;float depth=q.z-.00015;
    return .25*(texture(uSunShadow,vec3(q.xy+s,depth))+texture(uSunShadow,vec3(q.xy-s,depth))
      +texture(uSunShadow,vec3(q.xy+vec2(s.x,-s.y),depth))+texture(uSunShadow,vec3(q.xy+vec2(-s.x,s.y),depth)));
  }
  ${capillarySampling}
  ${surfaceFoamGLSL}

  // Exact unpolarized dielectric interface. Schlick overestimates water's
  // grazing reflectance and misses the underwater critical-angle transition.
  float waterFresnel(float cosine,float eta){
    float c=clamp(cosine,0.0,1.0);
    float transmittedSin2=eta*eta*(1.0-c*c);
    if(transmittedSin2>=1.0)return 1.0;
    float t=sqrt(max(0.0,1.0-transmittedSin2));
    float rs=(eta*c-t)/max(eta*c+t,.000001);
    float rp=(c-eta*t)/max(c+eta*t,.000001);
    return .5*(rs*rs+rp*rp);
  }

  void main() {
    vec2 screenUV=gl_FragCoord.xy/uResolution;
    float opaqueDepth=texture2D(uSceneDepth,screenUV).r;
    if(gl_FragCoord.z>opaqueDepth+0.0000001)discard;
    // The SWE surface is Eulerian: vertices sample it after FFT horizontal
    // displacement. Clip at that same world location, not the FFT origin.
    vec3 coast=coastAt(uPointwiseContact>.5?vWorld.xz:vOcean);
    float contactHeight=vWorld.y;
    if(uPointwiseContact>.5&&uShoreReady>.5&&coast.x> -11.&&coast.y>=.18){
      // Barycentric vertex height alone can bridge locally dry cells and
      // paint a sharp polygon above sand. Recheck the pointwise surface,
      // retaining positive runup whenever it actually clears the local bed.
      contactHeight=renderedSurface(vWorld.xz);
    }
    if(shoreContactDepth(vWorld.y,contactHeight,coast.x)<-.03)discard;
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
    vec2 shoreUV=(vWorld.xz-uShoreBounds.xy)/uShoreBounds.zw;
    if(uShoreReady>.5&&coast.x> -11.&&coast.x<2.&&coast.y>=.18&&all(greaterThan(shoreUV,vec2(.025)))&&all(lessThan(shoreUV,vec2(.975)))){
      float step=max(1.5,footprint*.65);
      vec2 nx=vWorld.xz-vec2(step,0),px=vWorld.xz+vec2(step,0);
      vec2 nz=vWorld.xz-vec2(0,step),pz=vWorld.xz+vec2(0,step);
      // Dry neighbours return the FFT fallback, often mean sea level below
      // emergent sand. Differentiating across that gap creates a fictitious
      // inward face on a valid thin film and near-total dark reflection.
      float sx=shoreWetSurfaceSlope(contactHeight,renderedSurface(nx),coastAt(nx).x,renderedSurface(px),coastAt(px).x,step);
      float sz=shoreWetSurfaceSlope(contactHeight,renderedSurface(nz),coastAt(nz).x,renderedSurface(pz),coastAt(pz).x,step);
      normal=normalize(vec3(-sx,1.,-sz));
    }
    normal.y=max(abs(normal.y),0.14);
    // Metric stochastic detail is shared with the photon caustics. Pixel
    // filtering removes unresolved slopes, while retaining their variance.
    float missingVariance;
    float microScale=.45+uWind*.035;
    // A height gradient modifies -normal.xz/normal.y, not the unit
    // normal directly: preserve metric slope on tilted FFT wave faces.
    normal.xz-=capillarySurfaceSlopeFiltered(vOcean,uTime,footprint,missingVariance)*microScale*normal.y;
    // The vertex surface includes Earth curvature. Its analytic slope must
    // also participate in the optical normal, in the same camera-relative XZ.
    normal.xz+=(vWorld.xz-cameraPosition.xz)/6371000.0*normal.y;
    normal=normalize(normal);
    float normalVariation=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
    float slopeVariance=.0007+.0012*clamp(uWind/12.0,0.0,1.0)+missingVariance*microScale*microScale;
    slopeVariance+=.0030*(1.0-shortFade*shortFade)+normalVariation*.25;
    float roughnessAlpha=clamp(sqrt(slopeVariance),.035,.24);

    vec3 view=normalize(cameraPosition-vWorld);
    if(uUnderwater>0.5){
      vec3 belowNormal=-normal;
      vec3 through=refract(-view,belowNormal,1.333);
      float incidence=max(dot(belowNormal,view),0.0);
      float belowFresnel=waterFresnel(incidence,1.333);
      // TIR reflects the underwater scene, rather than substituting a dark
      // constant that creates a visible ceiling/fog discontinuity.
      vec4 belowPoint=uReflectionMatrix*vec4(vWorld,1.0);
      vec2 belowUV=belowPoint.xy/max(.0001,belowPoint.w)+normal.xz*.012;
      bool belowValid=belowPoint.w>0.0&&all(greaterThan(belowUV,vec2(.002)))&&all(lessThan(belowUV,vec2(.998)))&&uHasReflection>.5;
      float reflectedPath=10000.0;
      vec3 reflectedRadiance=vec3(0);
      if(belowValid){
        float reflectedDepth=texture2D(uReflectionDepth,belowUV).r;
        vec4 reflectedView=uReflectionInverseProjection*vec4(belowUV*2.0-1.0,reflectedDepth*2.0-1.0,1.0);
        vec3 reflectedWorld=(uReflectionCameraWorld*vec4(reflectedView.xyz/reflectedView.w,1.0)).xyz;
        reflectedPath=reflectedDepth<.999999?length(reflectedWorld-vWorld):10000.0;
        reflectedRadiance=texture2D(uReflection,belowUV).rgb;
      }
      vec3 sigma=vec3(.105,.021,.012),reflectedTrans=exp(-sigma*reflectedPath);
      vec3 reflectedDirection=normalize(reflect(-view,belowNormal));
      vec3 waterSun=-refract(-uSunDirection,vec3(0,1,0),.75019);
      float reflectedPhase=(1.0-.76*.76)/pow(max(.035,1.0+.76*.76-2.0*.76*dot(reflectedDirection,waterSun)),1.5);
      vec3 reflectedVolume=vec3(0);float reflectedStep=min(reflectedPath,500.0)/8.0;
      for(int i=0;i<8;i++){
        float a=float(i)*reflectedStep,b=float(i+1)*reflectedStep;
        vec3 point=vWorld+reflectedDirection*(a+b)*.5;
        vec3 lightTrans=exp(-sigma*max(0.0,-point.y)/max(.35,waterSun.y));
        vec3 cameraIntegral=(exp(-sigma*a)-exp(-sigma*b))/sigma;
        reflectedVolume+=cameraIntegral*lightTrans*vec3(.0008,.0028,.0041)*uSunColor*(.12+reflectedPhase*.12)*surfaceSunVisibility(point);
      }
      // Both camera-to-interface and interface-to-reflected-hit legs scatter
      // light. Omitting the second leg darkens the entire TIR ceiling.
      vec3 underwaterColor=reflectedRadiance*reflectedTrans+vec3(.003,.026,.041)*(1.0-reflectedTrans)+reflectedVolume;
      if(dot(through,through)>0.001){
        vec3 skylight=skyRadiance(normalize(through),true);
        underwaterColor=mix(skylight,underwaterColor,belowFresnel);
      }
      gl_FragColor=vec4(underwaterColor,1.0);return;
    }
    float nV=max(dot(normal,view),0.001);
    vec3 reflected=reflect(-view,normal);
    float skyVisibility=smoothstep(-0.10,0.09,reflected.y);
    // A downward reflection sees the shaded water between waves. Avoid
    // reflecting a bright horizon into every steep, inward-facing slope.
    vec3 interreflection=vec3(0.008,0.025,0.031)*uWaterTint;
    reflected.y=max(reflected.y,0.012);
    reflected=normalize(reflected);
    float fresnel=waterFresnel(nV,1.0/1.333);
    vec3 reflection=mix(interreflection,skyRadiance(reflected,false),skyVisibility);
    vec4 reflectedPoint=uReflectionMatrix*vec4(vWorld,1.0);
    vec2 reflectedUV=reflectedPoint.xy/max(reflectedPoint.w,.0001)
      +normal.xz*(.012+.12*(1.0-nV))/max(.35,nV);
    float reflectionValid=reflectedPoint.w>0.0&&all(greaterThan(reflectedUV,vec2(.006)))&&all(lessThan(reflectedUV,vec2(.994)))?1.0:0.0;
    // The reflected cone gets wider with microfacet slope variance and grazing
    // incidence. HDR mip filtering integrates radiance, before tone mapping.
    float coneRadius=roughnessAlpha*(.032+.145*(1.0-nV));
    float pixelCone=max(length(dFdx(reflectedUV)*uReflectionResolution),length(dFdy(reflectedUV)*uReflectionResolution));
    float reflectionLod=clamp(log2(max(pixelCone,coneRadius*max(uReflectionResolution.x,uReflectionResolution.y))),0.0,8.0);
    vec3 reflectedScene=textureLod(uReflection,clamp(reflectedUV,.002,.998),reflectionLod).rgb;
    reflection=mix(reflection,reflectedScene,reflectionValid*uHasReflection*skyVisibility);
    float crest=clamp(vWorld.y/(0.35+uWind*uWind*0.010)+0.38,0.0,1.0);
    float sunFacing=max(dot(normal,uSunDirection),0.0);
    float backlight=pow(max(dot(view,-uSunDirection),0.0),4.0);
    float sunVisibility=surfaceSunVisibility(vWorld+vec3(0,.04,0));
    vec3 deep=vec3(0.002,0.010,0.024)*uWaterTint;
    vec3 scattering=vec3(0.004,0.028,0.040)*uWaterTint;
    float translucent=pow(crest,2.0)*(0.25+backlight*0.75);
    vec3 body=deep + scattering*(0.12+sunFacing*sunVisibility*.35+translucent*.55);
    float surfaceDistance=linearDepth(gl_FragCoord.z);
    vec2 refractionUV=clamp(screenUV+normal.xz*.011*clamp(-coast.x/8.0,0.0,1.0),vec2(.001),vec2(.999));
    float behindDepth=texture2D(uSceneDepth,refractionUV).r;
    if(linearDepth(behindDepth)<surfaceDistance+.06){refractionUV=screenUV;behindDepth=opaqueDepth;}
    float rayCos=max(.12,abs((viewMatrix*vec4(-view,0.0)).z));
    float opticalPath=clamp((linearDepth(behindDepth)-surfaceDistance)/rayCos,0.0,90.0);
    vec3 absorption=vec3(.105,.021,.012);
    vec3 transmission=exp(-absorption*opticalPath);
    vec3 waterScatter=vec3(.003,.026,.041)*uWaterTint;
    float bottomContact=texture2D(uSceneOcclusion,refractionUV).r;
    vec3 refractedColor=texture2D(uSceneColor,refractionUV).rgb*bottomContact*transmission+waterScatter*(1.0-transmission);
    float visibleBottom=behindDepth<.999999?1.0:0.0;
    body=mix(body,refractedColor,visibleBottom);
    body*=mix(1.0,0.60,uStorm);
    vec3 color=mix(body,reflection,fresnel);

    // GGX direct solar reflection. The surface micro-normal controls the glitter.
    vec3 halfVector=normalize(view+uSunDirection);
    float nH=max(dot(normal,halfVector),0.0);
    float nL=max(dot(normal,uSunDirection),0.0001);
    float vH=max(dot(view,halfVector),0.0);
    // Include the finite solar disk and unresolved normal variance. This
    // creates a broad, broken sun road instead of clipped needle-like stripes.
    float alpha=roughnessAlpha+.012*uStorm;
    float a2=alpha*alpha;
    float denominator=nH*nH*(a2-1.0)+1.0;
    float distribution=a2/(PI*denominator*denominator+0.0000005);
    float geometryV=2.0*nV/(nV+sqrt(a2+(1.0-a2)*nV*nV));
    float geometryL=2.0*nL/(nL+sqrt(a2+(1.0-a2)*nL*nL));
    float solarF=waterFresnel(vH,1.0/1.333);
    float specular=distribution*geometryV*geometryL*solarF/(4.0*nV);
    float lit=smoothstep(-0.01,0.035,dot(normal,uSunDirection));
    color+=uSunColor*min(specular,5.0)*1.1*lit*sunVisibility*mix(1.0,0.10,uStorm);

    float foam0=texture2D(uLongWaves,vOcean/384.0).a;
    float foam1=texture2D(uShortWaves,vOcean/24.0).a*shortFade;
    float jacobian=(1.0+dx.x*chop)*(1.0+dz.z*chop)-dx.z*dz.x*chop*chop;
    float breaking=1.0-smoothstep(0.05,0.46,jacobian);
    float memory=smoothstep(0.38,0.95,max(foam0,foam1*0.85));
    vec2 foamDrift=vec2(uTime*0.035,-uTime*0.026);
    float fineResolved=exp(-pow(footprint*1.7*1.55,2.));
    float foamDetail=mix(.5,noise(vOcean*1.7+foamDrift),fineResolved);
    float pores=smoothstep(0.28,0.73,foamDetail);
    float foam=max(breaking*0.90,memory*0.32);
    foam*=mix(0.22,1.0,pores)*smoothstep(4.0,12.0,uWind);
    foam*=1.0-smoothstep(0.35,3.2,footprint);
    float foamPattern=.7*noise(vOcean*.23+foamDrift*.1)+.3*foamDetail;
    float solvedFoam=shoreSolvedSurface(vWorld.xz,vWorld.y,0.).y;
    foam=max(foam,surfaceFoamCoverage(solvedFoam,foamPattern,fwidth(foamPattern)));
    vec3 foamColor=mix(uHorizon,uCloudColor,0.55)*0.57+vec3(0.035);
    color=mix(color,foamColor,clamp(foam,0.0,0.85));
    float shoreDepth=max(0.0,-coast.x);
    float shallowBreaking=(1.0-smoothstep(.6,3.8,shoreDepth))*smoothstep(.10,.38,shoreDepth);
    float crestArrival=smoothstep(.06,.18+shoreDepth*.10,vWorld.y);
    // A shallow positive crest alone is not evidence of breaking. The solved
    // residual foam is already represented above; calm contact has no white rail.
    float shoreFoam=shallowBreaking*crestArrival*coast.y*pores*.48*breaking;
    color=mix(color,uCloudColor*.55,shoreFoam);

    // Air scattering uses the same atmosphere as the visible sky.
    float fog=1.0-exp(-vDistance*mix(0.000045,0.00042,uStorm));
    vec3 horizon=skyRadiance(normalize(vec3(-view.x,0.005,-view.z)),false);
    color=mix(color,horizon,clamp(fog,0.0,0.995));
    if(uContactDebug>.5){
      if(uContactDebug<1.5)gl_FragColor=vec4(fresnel,skyVisibility,visibleBottom,1.);
      else if(uContactDebug<2.5)gl_FragColor=vec4(normal,1.);
      else if(uContactDebug<3.5)gl_FragColor=vec4(opticalPath,bottomContact,nV,1.);
      else if(uContactDebug<4.5)gl_FragColor=vec4(vWorld.y,contactHeight,coast.x,1.);
      else gl_FragColor=vec4(vWorld.xz,reflected.y,1.);
      return;
    }
    gl_FragColor=vec4(color,1.0);
  }
`;

export const environmentVertex = `varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export const environmentFragment = `precision highp float;varying vec3 vDirection;${atmosphere}
uniform float uEnvironmentSolarRemoval;
void main(){
  vec3 ray=normalize(vDirection);vec3 c=skyRadiance(ray,true);
  // A 64px cubemap cannot integrate the half-degree solar disk accurately.
  // Its direct energy is provided by the matching directional light. Keep the
  // photographed sky/cloud radiance, replacing only the small solar cone with
  // neighboring sky before PMREM convolution; display/reflection sky is intact.
  float cone=1.0-smoothstep(.009,.023,length(ray-uSunDirection));
  if(cone>.001&&uEnvironmentSolarRemoval>.5){
    vec3 axis=normalize(cross(uSunDirection,abs(uSunDirection.y)<.95?vec3(0,1,0):vec3(1,0,0)));
    vec3 other=cross(uSunDirection,axis);
    vec3 sky=(skyRadiance(normalize(ray+axis*.045),true)+skyRadiance(normalize(ray-axis*.045),true)
      +skyRadiance(normalize(ray+other*.045),true)+skyRadiance(normalize(ray-other*.045),true))*.25;
    c=mix(c,sky,cone);
  }
  if(ray.y<0.0)c=mix(c,vec3(.025,.035,.018),smoothstep(0.0,.35,-ray.y));gl_FragColor=vec4(c,1.0);
}`;
