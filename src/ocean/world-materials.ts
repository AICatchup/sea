import * as THREE from 'three';
import { waveCausticsSampling } from './caustics';

export function prepareWorldMaterials(group:THREE.Object3D,time:THREE.IUniform,caustics?:{texture:THREE.IUniform;bounds:THREE.IUniform}):void {
  group.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials){
      if(!(material instanceof THREE.MeshStandardMaterial)||material.userData.seaPrepared)continue;
      material.userData.seaPrepared=true;
      const original=material.onBeforeCompile,originalKey=material.customProgramCacheKey();
      material.onBeforeCompile=(shader,renderer)=>{
        original.call(material,shader,renderer);
        shader.uniforms.uWorldTime=time;
        if(caustics){shader.uniforms.uCaustics=caustics.texture;shader.uniforms.uCausticBounds=caustics.bounds;}
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nvarying vec3 vSeaWorld;`);
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
          vec4 mvPosition=vec4(transformed,1.0);
          #ifdef USE_BATCHING
            mvPosition=batchingMatrix*mvPosition;
          #endif
          #ifdef USE_INSTANCING
            mvPosition=instanceMatrix*mvPosition;
          #endif
          vec3 seaWorld=(modelMatrix*mvPosition).xyz;
          vSeaWorld=seaWorld;
          vec2 seaDelta=seaWorld.xz-cameraPosition.xz;
          seaWorld.y-=dot(seaDelta,seaDelta)/(2.0*6371000.0);
          mvPosition=viewMatrix*vec4(seaWorld,1.0);
          gl_Position=projectionMatrix*mvPosition;
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
          varying vec3 vSeaWorld; uniform float uWorldTime;
          ${waveCausticsSampling}
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`
          #include <lights_fragment_end>
          if(vSeaWorld.y<-.1){
            reflectedLight.directDiffuse*=clamp(refractedIrradiance(vSeaWorld),.15,5.0);
            reflectedLight.indirectDiffuse*=exp(-max(0.0,-vSeaWorld.y)*.04);
          }
        `);
      };
      material.customProgramCacheKey=()=>originalKey+'|shikine-earth-photon-caustic-v3';material.needsUpdate=true;
    }
  });
}
