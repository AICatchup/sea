import * as THREE from 'three';
import type {MeasuredGridPatch,MeasuredInteriorSurface,MeasuredPoint} from './measured-grid-patch.ts';
import {measuredReplacementFootprintSha256} from './measured-grid-patch.ts';
import {decodeReconstructedMeshBuffer} from './reconstructed-mesh-buffer.ts';
import {createProjectedMeshSurface} from './projected-mesh-surface.ts';
import {stitchNativeSurfaceBoundary,type NativeSurfaceStitchDiagnostics} from './native-surface-stitch.ts';

const sourceURL=new URL('../assets/niijima/point-cliff-v54/source.bin',import.meta.url).href;
const renderURL=new URL('../assets/niijima/point-cliff-v54/render.bin',import.meta.url).href;
export const POINT_CLIFF_SOURCE={vertices:291349,triangles:580589,origin:[5880,0,-1015] as const,positionsBytes:3496188,indicesBytes:6967068};
export const POINT_CLIFF_RENDER={vertices:551358,triangles:799066,origin:[5880,0,-1015] as const,positionsBytes:6616296,indicesBytes:9588792};
const sourceHash='563483a3474de29bb445e338ba8d468b1ea2f377f1e860f082e91029e00d9a19';
const renderHash='7412c785684b004eaa1bf4d0ed9ecb67a6d63b9e97acb7344685ea470c9efcda';
const footprintHash='f55b2375218d869b2d71cfbbd9bffdf8bb00796b46d703e33f1f0d2a16cd1449';

/** The mesh is clipped offline to this native triangle footprint. Numeric
 * budgets are explicit, not a claim of surveyed centimetre accuracy. */
export function pointCliffCoverage(projected:MeasuredInteriorSurface):MeasuredInteriorSurface {
  return {surfaceHeightAt:(x,z)=>projected.surfaceHeightAt(x,z),coversOriginalTriangle(q:readonly [MeasuredPoint,MeasuredPoint,MeasuredPoint]){
    const ab=new THREE.Vector3(q[1].x-q[0].x,q[1].y-q[0].y,q[1].z-q[0].z),ac=new THREE.Vector3(q[2].x-q[0].x,q[2].y-q[0].y,q[2].z-q[0].z),normal=ab.cross(ac);
    if(!Number.isFinite(normal.length())||normal.length()===0||Math.abs(normal.y)/normal.length()>.8||q.some(p=>p.y<6||p.y>78||p.z< -1068||p.z> -962))return false;
    if(!projected.coversOriginalTriangle(q))return false;
    return [...q,{x:q.reduce((s,p)=>s+p.x,0)/3,z:q.reduce((s,p)=>s+p.z,0)/3}].every(p=>projected.surfaceHeightAt(p.x,p.z)!==null);
  }};
}

export interface PointCliffOptions {
  colorAt:(x:number,y:number,z:number,target:THREE.Color)=>THREE.Color;
  invalidateWaterMaps:()=>void;
  /** Test seam; ordinary callers use bounded local asset fetches. */
  loadBuffer?:(url:string)=>Promise<ArrayBuffer>;
}

/** Opt-in inferred LiDAR surface. Drawing and static collision borrow exactly
 * the clipped render mesh. Native floor uses the original reconstructed planes
 * only inside its accepted mask, avoiding unstable queries at Float32-clipped
 * edges. This is finite-precision agreement, not exact coverage after rounding,
 * nor support for walking under arbitrary overhangs. No material is owned. */
export class NiijimaPointCliff {
  readonly group=new THREE.Group();
  readonly ready:Promise<void>;
  readonly diagnostics={state:'loading' as 'loading'|'ready'|'fallback'|'disposed',reason:'',inputTriangles:POINT_CLIFF_SOURCE.triangles,renderTriangles:0,removedNativeTriangles:0,
    numericalCoverageAreaToleranceM2:1e-12,footprintSha256:'',stitch:null as NativeSurfaceStitchDiagnostics|null,kind:'inferred-poisson-surface',watertight:false,centimetreAccuracyEstablished:false};
  private readonly abort=new AbortController();
  private geometry:THREE.BufferGeometry|null=null;
  private stitchGeometry:THREE.BufferGeometry|null=null;
  private projected:ReturnType<typeof createProjectedMeshSurface>|null=null;
  private disposed=false;
  constructor(native:MeasuredGridPatch,material:THREE.MeshStandardMaterial,options:PointCliffOptions){
    this.group.name='Niijima inferred point cliff';this.group.userData.recon_part='niijima-point-cliff';this.group.userData.worldSolid=true;
    const load=options.loadBuffer??(async(url:string)=>{
      const response=await fetch(url,{signal:this.abort.signal});if(!response.ok)throw new Error(`Cliff asset HTTP ${response.status}`);
      const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>20_000_000)throw new Error('Cliff asset byte budget exceeded');
      const data=await response.arrayBuffer();if(data.byteLength>20_000_000)throw new Error('Cliff asset byte budget exceeded');return data;
    });
    this.ready=Promise.all([load(sourceURL),load(renderURL)]).then(async buffers=>{
      if(this.disposed)return;
      for(let i=0;i<2;i++){
        const digest=await crypto.subtle.digest('SHA-256',buffers[i]);
        const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
        if(hash!==[sourceHash,renderHash][i])throw new Error('Cliff asset hash differs from the clipped study');
      }
      if(this.disposed)return;
      const source=decodeReconstructedMeshBuffer(buffers[0],POINT_CLIFF_SOURCE);
      let render:ReturnType<typeof decodeReconstructedMeshBuffer>|null=null;
      let stitchGeometry:THREE.BufferGeometry|null=null;
      let projected:ReturnType<typeof createProjectedMeshSurface>|null=null;
      try{
        render=decodeReconstructedMeshBuffer(buffers[1],POINT_CLIFF_RENDER);
        projected=createProjectedMeshSurface(source.geometry,source.origin,{maxTriangles:1_000_000,maxGridEntries:8_000_000,numericalAreaTolerance:1e-12});
        if(projected.diagnostics.buildLimitExceeded||projected.diagnostics.invalidTriangles)throw new Error('Cliff projected query is unavailable');
        const bounds=source.geometry.boundingBox!.clone().translate(source.origin);bounds.min.y=-100;bounds.max.y=200;
        const surface=pointCliffCoverage(projected),plan=native.prepareInteriorReplacement(surface,bounds);
        try{
          if(plan.diagnostics.removedTriangles!==102818)throw new Error('Clipped cliff no longer matches the native footprint');
          const hash=await measuredReplacementFootprintSha256(plan);
          if(hash!==footprintHash)throw new Error('Clipped cliff native footprint hash mismatch');
          if(this.disposed)return;
          const stitch=stitchNativeSurfaceBoundary(plan.coverageGeometry,plan.origin,projected.surfaceHeightAt,{subdivisionM:.2,maxBoundaryEdges:60_000,maxOutputTriangles:250_000});
          stitchGeometry=stitch.geometry;stitchGeometry.computeBoundingBox();stitchGeometry.computeBoundingSphere();
          const p=render.geometry.getAttribute('position'),colors=new Float32Array(p.count*3),uv=new Float32Array(p.count*2),color=new THREE.Color();
          for(let i=0;i<p.count;i++){
            const x=p.getX(i)+render.origin.x,y=p.getY(i)+render.origin.y,z=p.getZ(i)+render.origin.z;
            options.colorAt(x,y,z,color);colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;uv[i*2]=x/2.7;uv[i*2+1]=z/2.7;
          }
          render.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));render.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
          const mesh=new THREE.Mesh(render.geometry,material);mesh.position.copy(render.origin);mesh.name='Niijima reconstructed cliff surface';mesh.castShadow=mesh.receiveShadow=true;
          mesh.userData.worldSolid=true;mesh.userData.recon_part='niijima-point-cliff';
          const sp=stitchGeometry.getAttribute('position'),sc=new Float32Array(sp.count*3),su=new Float32Array(sp.count*2);
          for(let i=0;i<sp.count;i++){const x=sp.getX(i)+plan.origin.x,y=sp.getY(i)+plan.origin.y,z=sp.getZ(i)+plan.origin.z;
            options.colorAt(x,y,z,color);sc[i*3]=color.r;sc[i*3+1]=color.g;sc[i*3+2]=color.b;su[i*2]=x/2.7;su[i*2+1]=z/2.7;
          }
          stitchGeometry.setAttribute('color',new THREE.BufferAttribute(sc,3));stitchGeometry.setAttribute('uv',new THREE.BufferAttribute(su,2));
          const seam=new THREE.Mesh(stitchGeometry,material);seam.position.copy(plan.origin);seam.name='Niijima inferred native contact seam';seam.castShadow=seam.receiveShadow=true;seam.userData.worldSolid=true;
          if(this.disposed)return;
          options.invalidateWaterMaps();plan.commit();this.geometry=render.geometry;this.projected=projected;projected=null;
          this.stitchGeometry=stitchGeometry;this.group.add(mesh,seam);this.diagnostics.stitch=stitch.diagnostics;this.diagnostics.renderTriangles=render.geometry.index!.count/3;
          this.diagnostics.removedNativeTriangles=plan.diagnostics.removedTriangles;this.diagnostics.state='ready';
          this.diagnostics.footprintSha256=hash;
        }finally{plan.dispose();}
      }finally{source.geometry.dispose();projected?.dispose();if(render&&this.geometry!==render.geometry)render.geometry.dispose();if(stitchGeometry&&this.stitchGeometry!==stitchGeometry)stitchGeometry.dispose();}
    }).catch(error=>{
      if(this.disposed)return;this.diagnostics.state='fallback';this.diagnostics.reason=String(error instanceof Error?error.message:error);
      console.warn('Inferred cliff unavailable; native surface retained',error);
    });
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.abort.abort();this.projected?.dispose();this.geometry?.dispose();this.stitchGeometry?.dispose();this.group.clear();this.diagnostics.state='disposed';}
}
