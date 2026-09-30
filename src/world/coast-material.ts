import * as THREE from 'three';
import { SAND_SURFACE, type SandTextureSet } from './sand-material.ts';

/** Standard lit material. Only texture projection and grain are extended; the renderer owns grading. */
function makeLegacyTerrainMaterial(texture: THREE.DataTexture, atlas: THREE.Texture, sand:SandTextureSet): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0, bumpMap: texture, bumpScale: 0 });
  material.name = 'GSI coast: rhyolite / sand / evergreen';
  const sandReady={value:0};
  void sand.ready.then(()=>{sandReady.value=1;}).catch(error=>console.warn('Scanned sand unavailable; authored strand retained',error));
  material.onBeforeCompile = shader => {
    shader.uniforms.uCoastDetail = { value: texture };
    shader.uniforms.uCoastAtlas = { value: atlas };
    shader.uniforms.uSandAlbedo={value:sand.albedo};shader.uniforms.uSandNormal={value:sand.normalGL};
    shader.uniforms.uSandARM={value:sand.arm};shader.uniforms.uSandReady=sandReady;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoastPoint;\nvarying vec3 vCoastAxis;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoastPoint = position; vCoastAxis = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uCoastDetail;
      uniform sampler2D uCoastAtlas;
      uniform sampler2D uSandAlbedo, uSandNormal, uSandARM;
      uniform float uSandReady;
      varying vec3 vCoastPoint;
      varying vec3 vCoastAxis;
      vec3 coastTile(vec2 p, vec2 tile) {
        vec2 uv=fract(p), alt=fract(uv+.5);
        float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));
        vec2 a=(tile+clamp(uv,.004,.996))*.5,b=(tile+clamp(alt,.004,.996))*.5;
        return mix(texture2D(uCoastAtlas,a).rgb,texture2D(uCoastAtlas,b).rgb,1.0-smoothstep(0.0,.09,edge));
      }
      vec3 cliffAlbedo(vec3 p, vec3 axis) {
        vec3 w=pow(abs(normalize(axis)),vec3(5.0));w/=w.x+w.y+w.z;
        return coastTile(p.zy*.095,vec2(0,1))*w.x+coastTile(p.xz*.095,vec2(0,1))*w.y+coastTile(p.xy*.095,vec2(0,1))*w.z;
      }
      float coastGrain(vec3 p, vec3 axis, float scale) {
        vec3 weights = pow(abs(normalize(axis)), vec3(4.0));
        weights /= max(weights.x + weights.y + weights.z, 0.0001);
        return texture2D(uCoastDetail, p.zy * scale).r * weights.x
          + texture2D(uCoastDetail, p.xz * scale).r * weights.y
          + texture2D(uCoastDetail, p.xy * scale).r * weights.z;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float axisUp=abs(normalize(vCoastAxis).y);
      float sandMix=(1.0-smoothstep(1.7,7.0,vCoastPoint.y))*smoothstep(.58,.88,axisUp);
      float greenMix=smoothstep(5.0,18.0,vCoastPoint.y)*smoothstep(.65,.92,axisUp);
      vec3 stoneColor=cliffAlbedo(vCoastPoint,vCoastAxis)*.34;
      vec3 drySand=coastTile(vCoastPoint.xz*2.7,vec2(1,1))*.55;
      vec3 wetSand=coastTile(vCoastPoint.xz*2.7,vec2(1,0))*.74;
      float dryFactor=smoothstep(-.25,.8,vCoastPoint.y);
      vec2 sandUV=vec2(vCoastPoint.x,-vCoastPoint.z)*${SAND_SURFACE.tilesPerMeter};
      vec3 sandPhoto=texture2D(uSandAlbedo,sandUV).rgb;
      float sandLuma=dot(sandPhoto,vec3(.2126,.7152,.0722));
      vec3 scannedSand=mix(sandPhoto,vec3(sandLuma)*vec3(1.05,1.025,.94),.7)*2.2;
      scannedSand*=mix(.62,1.0,dryFactor);
      vec3 sandColor=mix(mix(wetSand,drySand,dryFactor),scannedSand,uSandReady);
      vec3 greenColor=coastTile(vCoastPoint.xz*.18,vec2(0,0))*.58;
      diffuseColor.rgb=mix(mix(stoneColor,greenColor,greenMix),sandColor,sandMix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float stoneRelief = dot(cliffAlbedo(vCoastPoint,vCoastAxis),vec3(.3,.5,.2));
      float microRelief=coastGrain(vCoastPoint,vCoastAxis,.75);
      float relief=stoneRelief*.8+microRelief*.2;
      vec3 rockNormal=perturbNormalArb(-vViewPosition, normal, vec2(dFdx(relief), dFdy(relief)) * .62, faceDirection);
      vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);
      vec2 st0=dFdx(sandUV),st1=dFdy(sandUV);
      vec3 tangent=cross(q1,normal)*st0.x+cross(normal,q0)*st1.x;
      vec3 bitangent=cross(q1,normal)*st0.y+cross(normal,q0)*st1.y;
      float frameScale=inversesqrt(max(max(dot(tangent,tangent),dot(bitangent,bitangent)),1e-12));
      vec3 microNormal=texture2D(uSandNormal,sandUV).xyz*2.0-1.0;
      microNormal.xy*=mix(.32,.60,dryFactor);
      vec3 sandNormal=normalize(tangent*frameScale*microNormal.x+bitangent*frameScale*microNormal.y+normal*microNormal.z);
      normal=normalize(mix(rockNormal,sandNormal,sandMix*uSandReady));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      vec3 sandARM=texture2D(uSandARM,sandUV).rgb;
      roughnessFactor=mix(roughnessFactor,mix(.36,.92,dryFactor)*mix(.82,1.0,sandARM.g),sandMix*uSandReady);`);
  };
  material.customProgramCacheKey = () => 'gsi-coast-generated-photographic-v2';
  return material;
}

export const COAST_ROCK_SURFACE = Object.freeze({
  tileSpanMeters: 2.7,
  normalStrength: 0.86,
  albedoGain: 1.35,
  paletteDesaturation: 0.90,
  dryRoughnessRange: [0.70, 0.96] as const,
  wetRoughnessRange: [0.27, 0.53] as const,
  source: 'https://polyhaven.com/a/rock_face_03',
  license: 'CC0-1.0',
});

export const COAST_ROCK_TEXTURE_URLS = Object.freeze({
  albedo: new URL('../assets/coast/rock_face_03_diff_4k.jpg', import.meta.url).href,
  normalGL: new URL('../assets/coast/rock_face_03_nor_gl_4k.jpg', import.meta.url).href,
  arm: new URL('../assets/coast/rock_face_03_arm_1k.jpg', import.meta.url).href,
  height: new URL('../assets/coast/rock_face_03_disp_2k.jpg', import.meta.url).href,
});

/** World-anchored scanned rock; caller-owned sand, grain and atlas stay caller-owned. */
function makeScannedTerrainMaterial(atlas: THREE.Texture, sand: SandTextureSet): THREE.MeshStandardMaterial {
  const baselineGain=typeof location!=='undefined'&&new URLSearchParams(location.search).get('coast')==='v4-white';
  const albedoGain=baselineGain?2.2:COAST_ROCK_SURFACE.albedoGain;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0 });
  material.name = 'Tomari: scanned fractured cliff / physical coastal sand';
  const loader = typeof document === 'undefined' ? undefined : new THREE.TextureLoader();
  const pending: Promise<void>[] = [];
  const rockReady = { value: 0 }, sandReady = { value: 0 };
  const load = (role: keyof typeof COAST_ROCK_TEXTURE_URLS) => {
    let image = new THREE.Texture();
    if (loader) pending.push(new Promise<void>((resolve, reject) => {
      image = loader.load(COAST_ROCK_TEXTURE_URLS[role], () => resolve(), undefined, reject);
    }));
    image.name = `Poly Haven Rock Face 03 / ${role}`;
    image.colorSpace = role === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    image.wrapS = image.wrapT = THREE.RepeatWrapping;
    image.minFilter = THREE.LinearMipmapLinearFilter;
    image.magFilter = THREE.LinearFilter;
    image.anisotropy = 8;
    image.generateMipmaps = true;
    image.userData = { ...COAST_ROCK_SURFACE, role, normalConvention: 'OpenGL +Y' };
    return image;
  };
  const albedo = load('albedo'), normalGL = load('normalGL'), arm = load('arm'), height = load('height');
  const ownedTextures = [albedo, normalGL, arm, height];
  const rockPromise = Promise.all(pending).then(() => { rockReady.value = loader ? 1 : 0; });
  const sandPromise = sand.ready.then(() => { sandReady.value = loader ? 1 : 0; });
  const ready = Promise.all([rockPromise, sandPromise]).then(() => {});
  // Keep the rejection visible to the readiness owner without an unhandled rejection during construction.
  void ready.catch(error => console.warn('Coastal PBR image load failed', error));
  const waterLevel = { value: 0 }, splashHeight = { value: 0.65 };
  material.userData.ready = ready;
  material.userData.coastRockTextures = ownedTextures;
  material.userData.coastWetness = { waterLevel, splashHeight };
  material.userData.coastSurface = COAST_ROCK_SURFACE;
  let disposed = false;
  material.addEventListener('dispose', () => {
    if (disposed) return;
    disposed = true;
    ownedTextures.forEach(image => image.dispose());
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uCoastRockAlbedo: { value: albedo }, uCoastRockNormal: { value: normalGL },
      uCoastRockARM: { value: arm }, uCoastRockHeight: { value: height }, uCoastRockReady: rockReady,
      uCoastAtlas: { value: atlas }, uSandAlbedo: { value: sand.albedo },
      uSandNormal: { value: sand.normalGL }, uSandARM: { value: sand.arm }, uSandReady: sandReady,
      uCoastWaterLevel: waterLevel, uCoastSplashHeight: splashHeight,
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vCoastPoint;
      varying vec3 vCoastAxis;`);
    // The renderer may wrap project_vertex for earth curvature. Material coordinates remain the
    // uncurved world coordinates, independent of camera movement and object transforms.
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 coastWorldPoint = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        coastWorldPoint = batchingMatrix * coastWorldPoint;
      #endif
      #ifdef USE_INSTANCING
        coastWorldPoint = instanceMatrix * coastWorldPoint;
      #endif
      vCoastPoint = (modelMatrix * coastWorldPoint).xyz;
      vCoastAxis = inverseTransformDirection(transformedNormal, viewMatrix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uCoastRockAlbedo, uCoastRockNormal, uCoastRockARM, uCoastRockHeight;
      uniform sampler2D uCoastAtlas, uSandAlbedo, uSandNormal, uSandARM;
      uniform float uCoastRockReady, uSandReady, uCoastWaterLevel, uCoastSplashHeight;
      varying vec3 vCoastPoint;
      varying vec3 vCoastAxis;

      vec3 coastCellHash(vec2 p) {
        vec3 h = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
        h += dot(h, h.yxz + 33.33);
        return fract((h.xxy + h.yzz) * h.zyx);
      }
      struct CoastRockSample { vec3 color; vec3 tangent; float ao; float rough; float height; };
      CoastRockSample coastRockCell(vec2 uv, vec2 cell, vec2 gradX, vec2 gradY) {
        vec3 seed = coastCellHash(cell);
        float angle = floor(seed.z * 4.0) * 1.5707963268;
        float c = cos(angle), s = sin(angle);
        mat2 rotation = mat2(c, s, -s, c);
        vec2 sampleUV = rotation * uv + seed.xy * 19.0;
        vec2 dx = rotation * gradX, dy = rotation * gradY;
        CoastRockSample a;
        // Explicit gradients prevent hash-cell boundaries from contaminating mip selection.
        a.color = textureGrad(uCoastRockAlbedo, sampleUV, dx, dy).rgb;
        vec3 n = normalize(textureGrad(uCoastRockNormal, sampleUV, dx, dy).xyz * 2.0 - 1.0);
        n.xy = vec2(c * n.x + s * n.y, -s * n.x + c * n.y);
        a.tangent = n;
        vec3 data = textureGrad(uCoastRockARM, sampleUV, dx, dy).rgb;
        a.ao = data.r; a.rough = data.g;
        a.height = textureGrad(uCoastRockHeight, sampleUV, dx, dy).r;
        return a;
      }
      CoastRockSample coastRockPlane(vec2 uv, vec2 gradX, vec2 gradY) {
        vec2 lattice = vec2(uv.x - .5773502692 * uv.y, 1.1547005384 * uv.y);
        vec2 base = floor(lattice), f = fract(lattice);
        vec2 c0, c1, c2;
        vec3 blend;
        if (f.x + f.y < 1.0) {
          c0 = base; c1 = base + vec2(1, 0); c2 = base + vec2(0, 1);
          blend = vec3(1.0 - f.x - f.y, f.x, f.y);
        } else {
          c0 = base + vec2(1, 1); c1 = base + vec2(0, 1); c2 = base + vec2(1, 0);
          blend = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
        }
        // Sharpen barycentric transitions to retain the photographed fissures.
        blend = pow(max(blend, vec3(0)), vec3(5));
        blend /= max(dot(blend, vec3(1)), 1e-7);
        CoastRockSample a = coastRockCell(uv, c0, gradX, gradY);
        CoastRockSample b = coastRockCell(uv, c1, gradX, gradY);
        CoastRockSample c = coastRockCell(uv, c2, gradX, gradY);
        CoastRockSample result;
        result.color = a.color * blend.x + b.color * blend.y + c.color * blend.z;
        result.tangent = a.tangent * blend.x + b.tangent * blend.y + c.tangent * blend.z;
        result.ao = a.ao * blend.x + b.ao * blend.y + c.ao * blend.z;
        result.rough = a.rough * blend.x + b.rough * blend.y + c.rough * blend.z;
        result.height = a.height * blend.x + b.height * blend.y + c.height * blend.z;
        return result;
      }
      // Derivative cotangent frame uses the same signed UV projection as each map. All
      // decoded normals enter view space before blending, including opposite cliff faces.
      vec3 coastProjectedNormal(vec3 mapNormal, vec2 uv, vec3 surfaceNormal, float strength) {
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(uv), st1 = dFdy(uv);
        vec3 q1perp = cross(q1, surfaceNormal), q0perp = cross(surfaceNormal, q0);
        vec3 tangent = q1perp * st0.x + q0perp * st1.x;
        vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
        float frameScale = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
        return normalize(tangent * frameScale * mapNormal.x * strength
          + bitangent * frameScale * mapNormal.y * strength + surfaceNormal * max(mapNormal.z, .05));
      }
      vec3 coastCover(vec2 point) {
        vec2 uv = vec2(0, 0) + clamp(fract(point), .004, .996);
        return texture2D(uCoastAtlas, uv * .5).rgb;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 coastAxis = normalize(vCoastAxis);
      vec3 coastWeights = pow(abs(coastAxis), vec3(6));
      coastWeights /= max(dot(coastWeights, vec3(1)), 1e-7);
      // Remove imperceptible projections continuously before selecting texture work.
      coastWeights = max(coastWeights - vec3(.006), vec3(0));
      coastWeights /= max(dot(coastWeights, vec3(1)), 1e-7);
      vec3 coastSigns = mix(vec3(-1), vec3(1), step(vec3(0), coastAxis));
      vec2 cliffUVX = vec2(-coastSigns.x * vCoastPoint.z, vCoastPoint.y) / ${COAST_ROCK_SURFACE.tileSpanMeters};
      vec2 cliffUVY = vec2(vCoastPoint.x, -coastSigns.y * vCoastPoint.z) / ${COAST_ROCK_SURFACE.tileSpanMeters};
      vec2 cliffUVZ = vec2(coastSigns.z * vCoastPoint.x, vCoastPoint.y) / ${COAST_ROCK_SURFACE.tileSpanMeters};
      vec2 rockDxX = dFdx(cliffUVX), rockDyX = dFdy(cliffUVX);
      vec2 rockDxY = dFdx(cliffUVY), rockDyY = dFdy(cliffUVY);
      vec2 rockDxZ = dFdx(cliffUVZ), rockDyZ = dFdy(cliffUVZ);
      float sandMix = (1.0 - smoothstep(1.7, 7.0, vCoastPoint.y)) * smoothstep(.58, .88, abs(coastAxis.y));
      float greenMix = smoothstep(5.0, 18.0, vCoastPoint.y) * smoothstep(.65, .92, abs(coastAxis.y));
      CoastRockSample rockX = CoastRockSample(vec3(.16), vec3(0, 0, 1), .91, .82, .58);
      CoastRockSample rockY = rockX, rockZ = rockX;
      // Gradients are evaluated above the branches. A horizontal strand needs no rock
      // samples; typical cliff faces use one or two projections instead of all three.
      if ((1.0 - sandMix) * (1.0 - greenMix) > .002 && uCoastRockReady > .5) {
        if (coastWeights.x > 0.0) rockX = coastRockPlane(cliffUVX, rockDxX, rockDyX);
        if (coastWeights.y > 0.0) rockY = coastRockPlane(cliffUVY, rockDxY, rockDyY);
        if (coastWeights.z > 0.0) rockZ = coastRockPlane(cliffUVZ, rockDxZ, rockDyZ);
      }
      vec3 rockPhoto = rockX.color * coastWeights.x + rockY.color * coastWeights.y + rockZ.color * coastWeights.z;
      float rockAO = dot(vec3(rockX.ao, rockY.ao, rockZ.ao), coastWeights);
      float rockRough = dot(vec3(rockX.rough, rockY.rough, rockZ.rough), coastWeights);
      float rockHeight = dot(vec3(rockX.height, rockY.height, rockZ.height), coastWeights);
      float coastalCavity = clamp((1.0 - rockAO) * 1.1 + (1.0 - rockHeight) * .22, 0.0, 1.0);
      float waterHeight = vCoastPoint.y - uCoastWaterLevel;
      float immersed = 1.0 - smoothstep(-.12, .16, waterHeight);
      float splash = 1.0 - smoothstep(.06, uCoastSplashHeight + coastalCavity * .33, waterHeight);
      float rockWetness = max(immersed, splash * (.64 + .36 * coastalCavity));
      float sandDry = smoothstep(-.18, .83, waterHeight);
      float rockLuma = dot(rockPhoto, vec3(.2126, .7152, .0722));
      vec3 paleRock = min(mix(rockPhoto, vec3(rockLuma) * vec3(1.04, 1.025, .99), ${COAST_ROCK_SURFACE.paletteDesaturation}) * ${albedoGain}, vec3(.86));
      paleRock *= mix(1.0, .57, rockWetness);
      vec3 stoneColor = mix(vec3(.34, .335, .315) * mix(1.0, .57, rockWetness), paleRock, uCoastRockReady);
      vec2 sandUV = vec2(vCoastPoint.x, -vCoastPoint.z) * ${SAND_SURFACE.tilesPerMeter};
      vec3 sandPhoto = texture2D(uSandAlbedo, sandUV).rgb;
      float sandLuma = dot(sandPhoto, vec3(.2126, .7152, .0722));
      vec3 sandColor = mix(sandPhoto, vec3(sandLuma) * vec3(1.055, 1.025, .94), .7) * 2.25;
      sandColor *= mix(${SAND_SURFACE.wetAlbedoMultiplier}, 1.0, sandDry);
      sandColor = mix(vec3(.46, .43, .37) * mix(.62, 1.0, sandDry), sandColor, uSandReady);
      vec3 greenColor = coastCover(vCoastPoint.xz * .18) * .58;
      diffuseColor.rgb = mix(mix(stoneColor, greenColor, greenMix), sandColor, sandMix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 coastBaseNormal = normal;
      float rockNormalStrength = ${COAST_ROCK_SURFACE.normalStrength} * mix(1.0, .88, rockWetness);
      vec3 rockViewNormal = normalize(
        coastProjectedNormal(rockX.tangent, cliffUVX, coastBaseNormal, rockNormalStrength) * coastWeights.x
        + coastProjectedNormal(rockY.tangent, cliffUVY, coastBaseNormal, rockNormalStrength) * coastWeights.y
        + coastProjectedNormal(rockZ.tangent, cliffUVZ, coastBaseNormal, rockNormalStrength) * coastWeights.z);
      vec3 sandTangentNormal = texture2D(uSandNormal, sandUV).xyz * 2.0 - 1.0;
      vec3 sandViewNormal = coastProjectedNormal(sandTangentNormal, sandUV, coastBaseNormal,
        mix(${SAND_SURFACE.wetNormalStrength}, ${SAND_SURFACE.dryNormalStrength}, sandDry));
      normal = normalize(mix(coastBaseNormal, rockViewNormal, (1.0 - greenMix) * uCoastRockReady));
      normal = normalize(mix(normal, sandViewNormal, sandMix * uSandReady));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      vec3 sandARM = texture2D(uSandARM, sandUV).rgb;
      float dryStoneRough = mix(.70, .96, rockRough);
      float wetStoneRough = mix(.27, .53, rockRough);
      float stoneRough = mix(dryStoneRough, wetStoneRough, rockWetness);
      float sandRough = mix(mix(.27, .48, sandARM.g), mix(.78, .96, sandARM.g), sandDry);
      roughnessFactor = mix(mix(stoneRough, .94, greenMix), sandRough, sandMix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      float coastOcclusion = mix(mix(1.0, mix(.60, 1.0, rockAO), uCoastRockReady) , 1.0, greenMix);
      coastOcclusion = mix(coastOcclusion, mix(.86, 1.0, sandARM.r), sandMix * uSandReady);
      reflectedLight.indirectDiffuse *= coastOcclusion;
      #if defined(USE_ENVMAP) && defined(STANDARD)
        reflectedLight.indirectSpecular *= computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), coastOcclusion, material.roughness);
      #endif`);
  };
  material.customProgramCacheKey = () => `tomari-scanned-coast-world-stochastic-pbr-v5-${albedoGain}`;
  return material;
}

export function makeTerrainMaterial(texture: THREE.DataTexture, atlas: THREE.Texture, sand: SandTextureSet): THREE.MeshStandardMaterial {
  const legacy = typeof location !== 'undefined' && new URLSearchParams(location.search).get('material') === 'legacy';
  if (legacy) {
    const material = makeLegacyTerrainMaterial(texture, atlas, sand);
    material.userData.ready = sand.ready;
    return material;
  }
  return makeScannedTerrainMaterial(atlas, sand);
}
