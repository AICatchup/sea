import * as THREE from 'three';
import {shoreWaveSampling} from '../ocean/surface-detail.ts';
import {shoreSolverSampling,createShoreSolverUniforms} from '../ocean/shore-solver.ts';

export function wetSandUniforms():Record<string,THREE.IUniform>{
  return {...createShoreSolverUniforms(),uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}};
}

/** Current water contact over a persistent authored damp band. This is a
 * surface-film response, not a simulated moisture/drying-history texture. */
export const wetSandSampling=/* glsl */`
uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;
uniform float uSwell,uWind,uChoppiness;
${shoreWaveSampling}
${shoreSolverSampling}
vec3 sandWaterDisplacement(vec2 p){
  vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
  vec2 coast=sampleCoastalGround(uBathymetry,clamp(uv,vec2(0),vec2(1)),uBathyResolution).rg;
  return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(coast,uSwell,uWind);
}
float sandWaterFilm(vec3 world){
  if(uBathyResolution.x<2.||uBathyResolution.y<2.)return 0.;
  vec2 uv=(world.xz-uBathyBounds.xy)/uBathyBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return 0.;
  vec2 p=world.xz;
  for(int i=0;i<3;i++)p=world.xz-sandWaterDisplacement(p).xz*uChoppiness;
  float surface=shoreSolvedSurface(world.xz,sandWaterDisplacement(p).y,0.).x;
  return 1.-smoothstep(0.,.16,world.y-surface);
}
`;
