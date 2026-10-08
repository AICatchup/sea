import * as THREE from 'three';
import {shoreWaveSampling} from '../ocean/surface-detail.ts';
import {shoreSolverSampling,createShoreSolverUniforms} from '../ocean/shore-solver.ts';
import {sandMoistureResponseGLSL} from '../ocean/sand-moisture-response.ts';

export function wetSandUniforms():Record<string,THREE.IUniform>{
  return {...createShoreSolverUniforms(),uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55},uSandMemoryEnabled:{value:0},uSandMoisture:{value:null},uSandMoistureBounds:{value:new THREE.Vector4()},uSandMoistureResolution:{value:256},uSandMoistureReady:{value:0}};
}

/** Both the history pass and the actual sand fragment use the rendered surface. */
export const sandContactSampling=/* glsl */`
uniform sampler2D uLongWaves,uShortWaves,uBathymetry;
uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;
uniform float uSwell,uWind,uChoppiness;
${shoreWaveSampling}
${shoreSolverSampling}
${sandMoistureResponseGLSL}
vec3 sandWaterDisplacement(vec2 p){
  vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;
  vec2 coast=sampleCoastalGround(uBathymetry,clamp(uv,vec2(0),vec2(1)),uBathyResolution).rg;
  return (texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz)*uSwell*shoreWaveScale(coast,uSwell,uWind);
}
float sandWaterClearance(vec3 world){
  if(uBathyResolution.x<2.||uBathyResolution.y<2.)return -10000.;
  vec2 uv=(world.xz-uBathyBounds.xy)/uBathyBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return -10000.;
  vec2 p=world.xz;
  for(int i=0;i<3;i++)p=world.xz-sandWaterDisplacement(p).xz*uChoppiness;
  float surface=shoreSolvedSurface(world.xz,sandWaterDisplacement(p).y,0.).x;
  return surface-world.y;
}
`;

export const wetSandSampling=/* glsl */`
${sandContactSampling}
uniform sampler2D uSandMoisture;
uniform vec4 uSandMoistureBounds;
uniform float uSandMemoryEnabled,uSandMoistureReady,uSandMoistureResolution;
float sandWaterFilm(vec3 world){
  float clearance=sandWaterClearance(world);
  return uSandMemoryEnabled>.5?sandContact(clearance):1.-smoothstep(0.,.16,-clearance);
}
vec3 sandMoistureNode(vec2 uv,float height){
  vec4 history=texture2D(uSandMoisture,uv);
  // Do not blur a low wet cell up a neighbouring cliff or scarp.
  float support=history.a*(1.-smoothstep(.12,.45,abs(height-history.b)));
  return vec3(history.rg*support,support);
}
vec2 sandWetState(vec3 world){
  float contact=sandContact(sandWaterClearance(world));
  if(uSandMoistureReady<.5)return vec2(contact);
  vec2 uv=(world.xz-uSandMoistureBounds.xy)/uSandMoistureBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(contact);
  vec2 node=clamp(uv*uSandMoistureResolution-.5,vec2(0),vec2(uSandMoistureResolution-1.));
  vec2 base=min(floor(node),vec2(uSandMoistureResolution-2.)),f=node-base;
  vec2 a=(base+.5)/uSandMoistureResolution,e=vec2(1./uSandMoistureResolution,0);
  vec3 history=mix(mix(sandMoistureNode(a,world.y),sandMoistureNode(a+e,world.y),f.x),mix(sandMoistureNode(a+e.yx,world.y),sandMoistureNode(a+e+e.yx,world.y),f.x),f.y);
  return max(vec2(contact),history.xy/max(history.z,.00001));
}
`;
