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

export function makeTerrainMaterial(texture:THREE.DataTexture,atlas:THREE.Texture,sand:SandTextureSet):THREE.MeshStandardMaterial{ return makeLegacyTerrainMaterial(texture,atlas,sand); }
