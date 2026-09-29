import * as THREE from 'three';

export function prepareWorldMaterials(group:THREE.Object3D,time:THREE.IUniform):void {
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
          vec2 causticHash(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
          float seaCaustic(vec2 p){
            vec2 cell=floor(p),f=fract(p);float first=8.0,second=8.0;
            for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){
              vec2 g=vec2(float(x),float(z));vec2 h=causticHash(cell+g);
              vec2 point=.5+.32*sin(uWorldTime*.65+6.28318*h);
              float d=length(g+point-f);
              if(d<first){second=first;first=d;}else second=min(second,d);
            }
            return pow(1.0-smoothstep(.012,.16,second-first),2.0);
          }
        `);
        shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`
          if(vSeaWorld.y<-.1){
            float caustic=seaCaustic(vSeaWorld.xz*.55);
            gl_FragColor.rgb*=1.0+caustic*.48*exp(vSeaWorld.y*.06);
          }
          #include <dithering_fragment>
        `);
      };
      material.customProgramCacheKey=()=>originalKey+'|shikine-earth-caustic-v1';material.needsUpdate=true;
    }
  });
}
