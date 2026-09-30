import * as THREE from 'three';
import { waveCausticsSampling } from './caustics';

export function prepareWorldMaterials(group:THREE.Object3D,time:THREE.IUniform,caustics?:{texture:THREE.IUniform;bounds:THREE.IUniform;sunDirection?:THREE.IUniform}):void {
  group.traverse(object=>{
    if(object instanceof THREE.Points&&object.name==='subtle suspended water particles'&&object.material instanceof THREE.PointsMaterial){
      const material=object.material;
      if(material.userData.seaPrepared)return;
      material.userData.seaPrepared=true;material.size=.008;material.opacity=.16;material.color.setRGB(.18,.22,.20);
      const count=object.geometry.getAttribute('position').count,seeds=new Float32Array(count*3);
      let seed=943721;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<count;i++){seeds[i*3]=(random()-.5)*22;seeds[i*3+1]=(random()-.5)*15;seeds[i*3+2]=(random()-.5)*22;}
      object.geometry.setAttribute('waterParticleSeed',new THREE.BufferAttribute(seeds,3));
      material.onBeforeCompile=shader=>{
        shader.uniforms.uWorldTime=time;
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          attribute vec3 waterParticleSeed;uniform float uWorldTime;varying vec2 vWaterParticle;`);
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`
          vec3 drift=vec3(uWorldTime*.007,uWorldTime*.009,-uWorldTime*.005);
          // Wrapped WORLD cells enter the volume at its far edge; translating
          // the camera no longer carries the same specks in front of the face.
          vec3 transformed=mod(waterParticleSeed+drift-cameraPosition+vec3(11,7.5,11),vec3(22,15,22))
            +cameraPosition-vec3(11,7.5,11);`);
        shader.vertexShader=shader.vertexShader.replace('#include <logdepthbuf_vertex>',`
          gl_PointSize=clamp(gl_PointSize,.4,1.8);vWaterParticle=vec2(transformed.y,-mvPosition.z);
          #include <logdepthbuf_vertex>`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vWaterParticle;`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
          #include <color_fragment>
          if(vWaterParticle.x>-.04)discard;
          vec2 disk=gl_PointCoord*2.0-1.0;float r=dot(disk,disk);if(r>1.0)discard;
          diffuseColor.a*=exp(-r*3.5)*smoothstep(.6,1.8,vWaterParticle.y)*(1.0-smoothstep(7.0,12.0,vWaterParticle.y));`);
      };
      material.customProgramCacheKey=()=> 'shikine-world-water-particles-v4';material.needsUpdate=true;
      return;
    }
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
        shader.uniforms.uWaterSunDirection=caustics?.sunDirection??{value:new THREE.Vector3(0,1,0)};
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
          varying vec3 vSeaWorld; uniform float uWorldTime;uniform vec3 uWaterSunDirection;
          ${waveCausticsSampling}
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`
          #include <lights_fragment_end>
          if(vSeaWorld.y<-.1){
            float waterDepth=max(0.0,-vSeaWorld.y);
            // Caustics carry geometric focusing; spectral absorption is applied
            // once along the refracted sunlight path, in metres.
            float refractedCosine=sqrt(1.0-(1.0-uWaterSunDirection.y*uWaterSunDirection.y)/1.776889);
            vec3 spectralSun=exp(-vec3(.105,.021,.012)*waterDepth/max(.4,refractedCosine));
            reflectedLight.directDiffuse*=clamp(refractedIrradiance(vSeaWorld),.08,5.0)*spectralSun;
            reflectedLight.indirectDiffuse*=exp(-vec3(.07,.018,.009)*waterDepth);
          }
        `);
      };
      material.customProgramCacheKey=()=>originalKey+'|shikine-earth-photon-caustic-v4-spectral';material.needsUpdate=true;
    }
  });
}
