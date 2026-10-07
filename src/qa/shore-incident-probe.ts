import * as THREE from 'three';
import {shoreTransportFragment} from '../ocean/shore-solver.ts';
import {shoreIncidentDirection} from '../ocean/wave-direction.ts';
import {incidentBoreVelocity} from '../ocean/shore-bore.ts';

/** Full production initialization shader on controlled flat/oblique beds.
 * Actual float GPU readback verifies flux sign, units and the GLSL/CPU seam. */
export function inspectShoreIncident(renderer:THREE.WebGLRenderer){
  if(!renderer.extensions.has('EXT_color_buffer_float'))return {available:false};
  const size=16,span=16,bedSize=33,bounds=new THREE.Vector4(-span/2,-span/2,span,span);
  const before={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),xr:renderer.xr.enabled};
  const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
  const makeTexture=(a:Float32Array,n:number)=>{const t=new THREE.DataTexture(a,n,n,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;t.minFilter=t.magFilter=THREE.LinearFilter;return t;};
  const wave=makeTexture(new Float32Array([0,.6,0,0]),1),zero=makeTexture(new Float32Array(4),1);
  const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,depthBuffer:false,stencilBuffer:false});
  const material=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:shoreTransportFragment,
    uniforms:{uInput:{value:zero},uOriginal:{value:zero},uBathymetry:{value:zero},uLongWaves:{value:wave},uShortWaves:{value:zero},uBathyBounds:{value:bounds},uBathyResolution:{value:new THREE.Vector2(bedSize,bedSize)},uBathyTriangulated:{value:0},uBounds:{value:bounds},uOldBounds:{value:bounds},uSize:{value:size},uDx:{value:span/size},uDt:{value:0},uMode:{value:2},uSwell:{value:1},uChoppiness:{value:0},uMaxDepth:{value:12},uMaxSpeed:{value:12},uMaxHeight:{value:4},uSecondOrder:{value:1},uStage:{value:0},uIncidentDirection:{value:1}}});
  const quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
  const results=[];
  try{
    renderer.xr.enabled=false;
    for(const [label,gx,gz] of [['flat',0,0],['east-facing',-.1,0],['oblique',-.08,-.06],['outgoing',.1,0]] as const){
      const a=new Float32Array(bedSize*bedSize*4);
      for(let z=0;z<bedSize;z++)for(let x=0;x<bedSize;x++){const i=(z*bedSize+x)*4;a[i]=-2+gx*(-8+x*.5)+gz*(-8+z*.5);a[i+1]=1;}
      const bed=makeTexture(a,bedSize);material.uniforms.uBathymetry.value=bed;
      try{for(const enabled of [false,true]){
        material.uniforms.uIncidentDirection.value=enabled?1:0;
        renderer.setRenderTarget(target);renderer.render(scene,camera);
        const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
        const i=(8*size+8)*4,depth=2-.5*gx-.5*gz,n=enabled?shoreIncidentDirection(gx,gz,depth):{x:gx/Math.max(Math.hypot(gx,gz),1e-5),z:gz/Math.max(Math.hypot(gx,gz),1e-5)},h=depth+.6,speed=incidentBoreVelocity(h,depth);
        const expected=[h,h*n.x*speed,h*n.z*speed,0],actual=Array.from(pixels.slice(i,i+4));
        results.push({label,enabled,actual,expected,maxError:Math.max(...actual.map((v,j)=>Math.abs(v-expected[j]))),nonfinite:pixels.filter(v=>!Number.isFinite(v)).length});
      }}finally{bed.dispose();}
    }
  }finally{target.dispose();material.dispose();geometry.dispose();wave.dispose();zero.dispose();renderer.setRenderTarget(before.target);renderer.setViewport(before.viewport);renderer.xr.enabled=before.xr;}
  return {available:true,scope:'Actual production incident initialization on controlled beds; no measured Niijima wave validation',results};
}
