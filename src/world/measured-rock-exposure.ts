import * as THREE from 'three';
import {TOMARI_STRAND_POINTS} from './tomari-strand.ts';

/** Photographic substrate inference for the east headland, away from the
 * mapped sandy strand. Low rock shelves do not become sand just by facing up.
 * Underwater ground remains unclassified; this is not a geological survey. */
export function eastHeadlandExposure(x:number,z:number,height:number):number {
  let distance=Infinity;
  for(let i=1;i<TOMARI_STRAND_POINTS.length;i++){
    const [ax,az]=TOMARI_STRAND_POINTS[i-1],[bx,bz]=TOMARI_STRAND_POINTS[i],dx=bx-ax,dz=bz-az;
    const t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
    distance=Math.min(distance,Math.hypot(x-ax-t*dx,z-az-t*dz));
  }
  return THREE.MathUtils.smoothstep(distance,18,30)*THREE.MathUtils.smoothstep(height,.08,.65);
}

/** Authored substrate inference, not a LAS material class. A newly measured
 * dry ledge above the old low strand should not inherit that strand's sand.
 * Equal surfaces and higher inland ground retain their existing materials. */
export function measuredRockExposure(surfaceHeight:number, oldHeight:number):number {
  return THREE.MathUtils.smoothstep(surfaceHeight-oldHeight,.65,2.6)
    * (1-THREE.MathUtils.smoothstep(oldHeight,1.7,3.7))
    * THREE.MathUtils.smoothstep(surfaceHeight,.45,1.4);
}

/** Borrow the same PBR maps and readiness/wetness uniforms as the terrain.
 * One smooth vertex attribute controls every sand channel before texture work. */
export function makeMeasuredCoastMaterial(terrain:THREE.MeshStandardMaterial, exposedRock:boolean):THREE.MeshStandardMaterial {
  const material=terrain.clone();material.vertexColors=false;
  material.userData={...terrain.userData,borrowedTextures:true};
  const compile=terrain.onBeforeCompile,key=terrain.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(terrain,shader,renderer);
    if(!exposedRock)return;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float measuredRockExposure;\nvarying float vMeasuredRockExposure;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvMeasuredRockExposure = measuredRockExposure;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vMeasuredRockExposure;');
    const mask=/float sandMix\s*=[^;]*;/;
    if(!mask.test(shader.fragmentShader))throw new Error('Missing measured coast sand classification');
    shader.fragmentShader=shader.fragmentShader.replace(mask,
      '$&\n      sandMix *= 1.0 - clamp(vMeasuredRockExposure, 0.0, 1.0);');
  };
  material.customProgramCacheKey=()=>key+(exposedRock?'|measured-rock-exposure-v70':'|measured-coast-original');
  return material;
}
