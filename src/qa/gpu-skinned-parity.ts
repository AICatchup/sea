import * as THREE from 'three';
import { SkinnedReceivers } from '../ocean/skinned-receivers.ts';
import { GPUSkinnedReceivers } from '../ocean/gpu-skinned-receivers.ts';
/** Real renderer/readback diagnostic; caller supplies live poses including stress transforms. */
export function gpuSkinnedParity(renderer:THREE.WebGLRenderer,oracle:SkinnedReceivers,poses:(()=>void)[],positionTolerance=.002){
 const gpu=new GPUSkinnedReceivers(renderer,oracle);const results:{position:number;normal:number;bounds:number;exact:boolean;finite:boolean;containment:boolean;pass:boolean}[]=[];
 try{for(const pose of poses){pose();oracle.update();if(!oracle.diagnostics.available)throw new Error(oracle.diagnostics.reason);if(!gpu.update())throw new Error(gpu.diagnostics.reason);const actual=gpu.readback(),expected=oracle.packed.data,l=gpu.layout;let position=0,normal=0,bounds=0,exact=true,finite=true,containment=true;
 for(let i=0;i<actual.length;i++)if(!Number.isFinite(actual[i]))finite=false;
 for(let ni=0;ni<l.nodes.length;ni++){const o=ni*12;for(const c of [0,1,2,4,5,6])bounds=Math.max(bounds,Math.abs(actual[o+c]-expected[o+c]));for(const c of [3,7,8,9,10,11])exact&&=actual[o+c]===expected[o+c];const n=l.nodes[ni];if(n.count){for(let j=n.start;j<n.start+n.count;j++)for(let k=0;k<3;k++)for(let c=0;c<3;c++){const v=actual[(l.triangleOffset+j*12+k)*4+c];containment&&=v>=actual[o+c]&&v<=actual[o+4+c];}}else for(const child of [n.left,n.right])for(let c=0;c<3;c++)containment&&=actual[o+c]<=actual[child*12+c]&&actual[o+4+c]>=actual[child*12+4+c];}
 for(let ti=0;ti<l.triangles.length;ti++)for(let t=0;t<12;t++)for(let c=0;c<4;c++){const o=(l.triangleOffset+ti*12+t)*4+c,error=Math.abs(actual[o]-expected[o]);if(t<3&&c<3)position=Math.max(position,error);else if(t<6&&c<3)normal=Math.max(normal,error);else exact&&=actual[o]===expected[o];}
 results.push({position,normal,bounds,exact,finite,containment,pass:finite&&containment&&exact&&position<=positionTolerance&&normal<=.0001});}
 return {status:results.length&&results.every(r=>r.pass)?'GPU_PARITY_PASS':'GPU_PARITY_FAIL',poses:results,triangles:gpu.layout.triangles.length,vertices:gpu.layout.vertices,readbackBytes:gpu.diagnostics.readbackBytes,boundsEpsilon:gpu.diagnostics.boundsEpsilon,positionTolerance};
 }catch(error){return{status:'GPU_PARITY_FAIL',reason:String(error),poses:results,readbackBytes:gpu.diagnostics.readbackBytes};}finally{gpu.dispose();}
}
