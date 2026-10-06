import * as THREE from 'three';
import {SkinnedReceivers} from '../ocean/skinned-receivers.ts';
import {GPUSkinnedReceivers} from '../ocean/gpu-skinned-receivers.ts';

/** Negative tests use their own unmounted canvas/context. The game's context is untouched. */
export function inspectGpuSkinLifecycle(){
 const canvas=document.createElement('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:false});renderer.setSize(32,32,false);
 const g=new THREE.BoxGeometry(),position=g.getAttribute('position'),weights=new Float32Array(position.count*4);
 for(let i=0;i<position.count;i++)weights[i*4]=1;
 g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(weights.length),4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.SkinnedMesh(g,material),bone=new THREE.Bone();mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.updateMatrixWorld(true);mesh.skeleton.update();mesh.skeleton.computeBoneTexture();
 const oracle=new SkinnedReceivers(mesh),gpu=new GPUSkinnedReceivers(renderer,oracle),target=new THREE.WebGLRenderTarget(16,16,{type:THREE.FloatType});
 const gl=renderer.getContext(),results:{name:string;pass:boolean;detail?:unknown}[]=[];
 const assert=(name:string,pass:boolean,detail?:unknown)=>{results.push({name,pass,detail});if(!pass)throw new Error(name);};
 const snapshot=()=>({logicalViewport:renderer.getViewport(new THREE.Vector4()).toArray(),logicalScissor:renderer.getScissor(new THREE.Vector4()).toArray(),logicalTest:renderer.getScissorTest(),physicalViewport:renderer.getCurrentViewport(new THREE.Vector4()).toArray(),physicalScissor:Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),physicalTest:gl.isEnabled(gl.SCISSOR_TEST),xr:renderer.xr.enabled,target:renderer.getRenderTarget()===target,auto:renderer.autoClear,tone:renderer.toneMapping});
 try{
  for(const ratio of [1,2,.75]){
   renderer.setPixelRatio(ratio);target.viewport.set(1,2,13,12);target.scissor.set(2,3,9,8);target.scissorTest=true;renderer.setRenderTarget(target);renderer.xr.enabled=true;
   const before=snapshot();assert(`update at DPR ${ratio}`,gpu.update(),gpu.diagnostics.reason);assert(`renderer state at DPR ${ratio}`,JSON.stringify(before)===JSON.stringify(snapshot()));
   const skin=gpu.readback();
   for(const size of [4,16384,16,8192,4,16384]){
    const prefix=Float32Array.from({length:size},(_,i)=>((i%97)-48)*.125),frame=gpu.compose(prefix);assert(`compose ${ratio}/${size}`,frame!==null);
    const composed=gpu.readbackComposed();let exact=true;for(let i=0;i<size;i++)exact&&=prefix[i]===composed.data[i];for(let i=0;i<skin.length;i++)exact&&=skin[i]===composed.data[composed.extraDataOffset*4+i];
    assert(`prefix and suffix ${ratio}/${size}`,exact);assert(`bounded resources ${ratio}/${size}`,gpu.resourceCounts.textures===9&&gpu.resourceCounts.targets===4,gpu.resourceCounts);
   }
   assert(`state after compose ${ratio}`,JSON.stringify(before)===JSON.stringify(snapshot()));
  }
  mesh.matrixWorld.elements[3]=2;assert('projective world selects CPU',!gpu.update()&&gpu.compose(new Float32Array(4))===null,gpu.diagnostics.reason);mesh.updateMatrixWorld(true);
  assert('recovery after supported pose',gpu.update(),gpu.diagnostics.reason);
  const before=snapshot(),callback=renderer.debug.onShaderError;let callbackCalls=0;const sentinel=()=>{callbackCalls++;};renderer.debug.onShaderError=sentinel;renderer.debug.checkShaderErrors=false;
  const bad=(gpu as unknown as {materials:THREE.ShaderMaterial[]}).materials[0];bad.fragmentShader+='\nthis_is_an_intentional_compile_failure';bad.needsUpdate=true;
  assert('shader failure rejects stale result',!gpu.update()&&gpu.compose(new Float32Array(4))===null,gpu.diagnostics.reason);
  assert('shader callback restored',renderer.debug.onShaderError===sentinel&&renderer.debug.checkShaderErrors===false&&callbackCalls===1,{callbackCalls});
  assert('state after shader failure',JSON.stringify(before)===JSON.stringify(snapshot()));renderer.debug.onShaderError=callback;
  gpu.dispose();gpu.dispose();
  const fresh=new GPUSkinnedReceivers(renderer,oracle);
  try{
   assert('fresh instance after shader failure',fresh.update(),fresh.diagnostics.reason);
   const loss=gl.getExtension('WEBGL_lose_context');if(!loss)results.push({name:'context loss',pass:false,detail:'extension unavailable; not run'});
   else{loss.loseContext();assert('lost context never publishes old data',!fresh.update()&&fresh.compose(new Float32Array(4))===null,fresh.diagnostics.reason);}
  }finally{fresh.dispose();}
  return {status:results.every(r=>r.pass)?'GPU_LIFECYCLE_PASS':'GPU_LIFECYCLE_INCOMPLETE',results,scope:'Actual isolated WebGL2 context; DPR, target/scissor/XR flag restoration, composition bytes, bounded ownership, shader failure and context loss. No XR headset session was used.'};
 }catch(error){return {status:'GPU_LIFECYCLE_FAIL',reason:String(error),results};}
 finally{gpu.dispose();oracle.dispose();renderer.setRenderTarget(null);target.dispose();mesh.skeleton.dispose();g.dispose();material.dispose();renderer.dispose();}
}
