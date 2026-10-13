import * as THREE from 'three';

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
