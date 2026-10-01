import * as THREE from 'three';
import {WaveCaustics} from '../ocean/caustics.ts';

/** Operator-only independent flat-plane control. No live FFT/solver texture is changed. */
export function inspectFlatCaustics(renderer:THREE.WebGLRenderer){
  const saved={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),test:renderer.getScissorTest(),auto:renderer.autoClear,color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha()};
  const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);
  const ground=new THREE.DataTexture(new Float32Array([-4,1,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);
  zero.needsUpdate=ground.needsUpdate=true;
  const control=new WaveCaustics(renderer,{span:32});
  const material=(control as unknown as {photons:THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>}).photons.material;
  const capillary='normal.xz-=capillarySurfaceSlope(parameter,uTime)*(.45+uWind*.035);normal=normalize(normal);';
  const cases=[];
  try{
    if(!material.vertexShader.includes(capillary))throw new Error('Flat control source changed; do not guess a replacement');
    // This OWNED temporary shader suppresses the capillary perturbation, leaving
    // a perfectly flat optical interface. Production shader remains untouched.
    material.vertexShader=material.vertexShader.replace(capillary,'normal=vec3(0.,1.,0.);');material.needsUpdate=true;
    renderer.setScissorTest(false);
    for(const sample of [{name:'shallow-vertical',depth:1,sun:[0,1,0]}, {name:'reef-oblique',depth:5,sun:[.6,.8,0]}, {name:'deep-low-sun',depth:20,sun:[.99679486,.08,0]}, {name:'dry',depth:-1,sun:[0,1,0]}]){
      (ground.image.data as Float32Array)[0]=-sample.depth;ground.needsUpdate=true;
      const sun=new THREE.Vector3(...sample.sun as [number,number,number]).normalize();
      const rayY=-Math.sqrt(1-(1-sun.y*sun.y)/(1.333*1.333));
      const reflection=.02037+.97963*(1-sun.y)**5;
      const t=THREE.MathUtils.clamp((sun.y-.025)/(.12-.025),0,1);
      const modelFlux=sample.depth>0?(1-reflection)*t*t*(3-2*t):0;
      for(const density of [256,512] as const){
        control.setPhotonResolution(density);
        control.update(34,0,zero,zero,{texture:ground,origin:new THREE.Vector2(-1000,-1000),size:new THREE.Vector2(2000,2000)},new THREE.Vector3(),sun,0,0,0);
        cases.push({name:sample.name,depth:sample.depth,sun:sun.toArray(),density,rayY,modelFlux,energy:control.readEnergy()});
      }
    }
    return {cases,scope:'Actual GPU constant-wave/flat-normal control; modelFlux uses the current Schlick/daylight approximation, not exact dielectric or measured sunlight. Dry is a negative control.'};
  }finally{
    control.dispose();zero.dispose();ground.dispose();
    renderer.setRenderTarget(saved.target,saved.face,saved.mip);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.test);renderer.autoClear=saved.auto;renderer.setClearColor(saved.color,saved.alpha);
  }
}
