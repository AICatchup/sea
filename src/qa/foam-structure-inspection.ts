import * as THREE from 'three';
import {atmosphere} from '../ocean/shaders.ts';
import {foamFilmGLSL} from '../ocean/foam-film.ts';
import {foamStructureGLSL} from '../ocean/foam-structure.ts';
import {surfaceFoamGLSL} from '../ocean/surface-foam.ts';

/** Actual shared GLSL on a controlled optical tile, independent of scene cameras. */
export function inspectFoamStructure(renderer:THREE.WebGLRenderer){
  if(!renderer.extensions.has('EXT_color_buffer_float'))return {available:false,pass:false};
  const size=96,target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false,stencilBuffer:false});
  const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:/* glsl */`
    ${atmosphere}
    ${foamFilmGLSL}
    ${surfaceFoamGLSL}
    ${foamStructureGLSL}
    uniform float uSize,uFootprint,uConcentration,uCoverage,uStructured;
    uniform vec2 uOffset;
    void main(){
      vec2 world=vec2(5888,-986)+uOffset+(gl_FragCoord.xy/uSize-.5)*4.;
      float c=foamMaterialConcentration(uConcentration,0.);
      vec2 film=uStructured>.5?structuredFoamFilm(world,uFootprint,c,foamPocketField(world)):foamFilm(world,uFootprint,max(c,uCoverage));
      gl_FragColor=vec4(film,uCoverage*film.x,c);
    }`,uniforms:{uSize:{value:size},uFootprint:{value:.002},uConcentration:{value:.42},uCoverage:{value:1},uStructured:{value:0},uOffset:{value:new THREE.Vector2()},uSunDirection:{value:new THREE.Vector3(.4,.8,.3).normalize()}}});
  const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material),camera=new THREE.Camera();quad.frustumCulled=false;scene.add(quad);
  const before={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),xr:renderer.xr.enabled};
  const cases=[];
  const specs:readonly(readonly[string,number,number,number,number,number])[]=[
    ['legacy-thresholded',0,.42,1,.002,0],['actual-concentration',1,.42,1,.002,0],['dense-resolved',1,1,1,.002,0],
    ['dense-mid',1,1,1,.04,0],['dense-unresolved',1,1,1,4,0],['dense-unresolved-shifted',1,1,1,4,.013],['empty',1,0,0,.002,0],
  ];
  try{
    renderer.xr.enabled=false;
    for(const [name,enabled,c,coverage,footprint,offset] of specs){
      material.uniforms.uStructured.value=enabled;material.uniforms.uConcentration.value=c;material.uniforms.uCoverage.value=coverage;material.uniforms.uFootprint.value=footprint;material.uniforms.uOffset.value.set(offset,offset);
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      const channels=Array.from({length:4},()=>({min:Infinity,max:-Infinity,mean:0,sd:0}));let nonfinite=0;
      for(let i=0;i<pixels.length;i++){const v=pixels[i],s=channels[i%4];if(!Number.isFinite(v)){nonfinite++;continue;}s.min=Math.min(s.min,v);s.max=Math.max(s.max,v);s.mean+=v;s.sd+=v*v;}
      for(const ch of channels){ch.mean/=size*size;ch.sd=Math.sqrt(Math.max(0,ch.sd/(size*size)-ch.mean*ch.mean));}
      cases.push({name,concentration:c,coverage,footprint,offset,nonfinite,opacity:channels[0],shade:channels[1],covered:channels[2],materialConcentration:channels[3]});
    }
    const failures:string[]=[];
    for(const c of cases){if(c.nonfinite||c.opacity.min<0||c.opacity.max>1.000001||c.shade.min<=0||c.shade.max>2||Math.abs(c.materialConcentration.mean-c.concentration)>1e-5)failures.push(c.name);}
    if(cases[0].opacity.sd>1e-6)failures.push('legacy dense pore control');
    if(cases[2].opacity.sd<.025)failures.push('dense resolved structure lost');
    if(cases[4].opacity.sd>1e-6||cases[4].shade.sd>1e-6||Math.abs(cases[4].opacity.mean-cases[5].opacity.mean)>1e-6)failures.push('unresolved shimmer');
    if(cases[6].covered.max!==0)failures.push('foam appeared on empty water');
    return {available:true,pass:failures.length===0,failures,size,cases,scope:'Isolated actual shared shader statistics; optical structure only, not measured bubble density or full-scene acceptance'};
  }finally{target.dispose();material.dispose();geometry.dispose();renderer.setRenderTarget(before.target);renderer.setViewport(before.viewport);renderer.xr.enabled=before.xr;}
}
