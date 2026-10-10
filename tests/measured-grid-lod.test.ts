import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {coarseChunkIndices,createMeasuredGridPatch,type MeasuredGrid} from '../src/world/measured-grid-patch.ts';

const material=()=>new THREE.MeshStandardMaterial();
function grid(w:number,h:number,sign=1):MeasuredGrid{
 // Smooth hills; a rough field is covered by the separate cliff test below.
 return {width:w,height:h,heights:Float32Array.from({length:w*h},(_,n)=>Math.sin((n%w)*.02)*Math.cos(Math.floor(n/w)*.015)*6+(n%w)*.01),
  origin:{x:5581.2,z:-1155.5},column:{x:.25*sign,z:-.0014},row:{x:.0014,z:.25}};
}
const edgeKey=(a:number,b:number)=>a<b?`${a},${b}`:`${b},${a}`;
// Boundary edges of a triangle set; a crack-free chunk border uses only native unit steps.
function boundary(indices:readonly number[]){
 const count=new Map<string,number>();
 for(let k=0;k<indices.length;k+=3)for(const [a,b] of [[indices[k],indices[k+1]],[indices[k+1],indices[k+2]],[indices[k+2],indices[k]]]){const key=edgeKey(a,b);count.set(key,(count.get(key)??0)+1);}
 return [...count].filter(([,n])=>n===1).map(([key])=>key.split(',').map(Number));
}

for(const [nx,nz] of [[128,128],[37,64],[33,33]])for(const negative of [true,false])
 test(`coarse ${nx}x${nz} levels keep every native border step, cover the chunk area and keep winding (${negative?'det>0':'det<0'})`,()=>{
  const row=nx+1;
  for(const stride of [2,4,8,16,32,64]){
   const indices=coarseChunkIndices(nx,nz,stride,negative);
   if(Math.ceil(nx/stride)<2||Math.ceil(nz/stride)<2){assert.equal(indices,null);continue;}
   assert.ok(indices&&indices.length%3===0);
   let area=0;
   for(let k=0;k<indices.length;k+=3){
    const [p,q,r]=[indices[k],indices[k+1],indices[k+2]].map(n=>[n%row,Math.floor(n/row)]);
    const cross=(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    assert.notEqual(cross,0);assert.equal(cross<0,negative);area+=Math.abs(cross)/2;
   }
   assert.equal(area,nx*nz,`stride ${stride} covers the chunk exactly once`);
   const edges=boundary(indices);
   assert.equal(edges.length,2*(nx+nz),`stride ${stride} border is the native border`);
   for(const [a,b] of edges){const da=Math.abs(a%row-b%row),db=Math.abs(Math.floor(a/row)-Math.floor(b/row));assert.equal(da+db,1);}
  }
 });

test('drawing camera selects coarser ranges with distance; height queries stay native',()=>{
 const g=grid(513,385),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,{blendStartMetres:0,blendEndMetres:.1});
 try{
  assert.equal(patch.diagnostics.fullResolutionOnly,false);assert.deepEqual(patch.diagnostics.lod.strides,[2,4,8,16,32,64]);
  const native=patch.diagnostics.triangles;assert.equal(patch.diagnostics.lod.drawnTriangles,native);
  patch.group.updateMatrixWorld(true);
  const height=720,renderer={getRenderTarget:()=>null,getContext:()=>({drawingBufferHeight:height})} as unknown as THREE.WebGLRenderer;
  const camera=new THREE.PerspectiveCamera(62,16/9,.1,40000);
  const draw=(x:number,y:number,z:number)=>{camera.position.set(x,y,z);camera.updateMatrixWorld();
   patch.group.traverse(o=>{if(o instanceof THREE.Mesh)o.onBeforeRender(renderer,new THREE.Scene(),camera,o.geometry,o.material,null);});};
  const centre={x:g.origin.x+64,z:g.origin.z+48};
  draw(centre.x,2,centre.z);
  const near=patch.diagnostics.lod.drawnTriangles;
  assert.ok(patch.diagnostics.lod.chunksByStride[1]>0,'chunks under the camera stay native');
  draw(centre.x,30,centre.z+4000);
  const far=patch.diagnostics.lod.drawnTriangles;
  // Edge chunks keep detail where the abrupt fixture blend drops to the fallback.
  assert.ok(far<near/6,`4km view draws ${far} of ${native} native triangles (near ${near})`);
  // Per-chunk counters always agree with the actual selected draw ranges.
  let sum=0;patch.group.traverse(o=>{if(o instanceof THREE.Mesh)sum+=o.geometry.drawRange.count/3;});
  assert.equal(sum,far);
  // Height queries read native triangles whatever level was drawn.
  for(const [i,j] of [[125.4,71.2],[300.5,200.25],[17.8,333.1]]){
   const x=g.origin.x+g.column.x*i+g.row.x*j,z=g.origin.z+g.column.z*i+g.row.z*j,i0=Math.floor(i),j0=Math.floor(j);
   const corners=[[i0,j0],[i0+1,j0],[i0,j0+1],[i0+1,j0+1]].map(([a,b])=>g.heights[b*g.width+a]);
   const y=patch.surfaceHeightAt(x,z)!;assert.ok(y>=Math.min(...corners)-1e-4&&y<=Math.max(...corners)+1e-4);
  }
  // Returning nearby restores native ranges, with hysteresis bounded to one band.
  draw(centre.x,2,centre.z);assert.equal(patch.diagnostics.lod.drawnTriangles,near);
  // Orthographic shadow cameras reuse the perspective choice.
  const shadow=new THREE.OrthographicCamera(-200,200,200,-200,1,1500);shadow.position.set(centre.x,600,centre.z+9000);shadow.updateMatrixWorld();
  patch.group.traverse(o=>{if(o instanceof THREE.Mesh)o.onBeforeRender(renderer,new THREE.Scene(),shadow,o.geometry,o.material,null);});
  assert.equal(patch.diagnostics.lod.drawnTriangles,near);
 }finally{patch.dispose();m.dispose();}
});

test('a steep cliff keeps native triangles at distances where flat ground coarsens',()=>{
 const w=257,h=129,heights=new Float32Array(w*h);
 // Left chunk flat, right chunk a 40m wall with a rough face inside its own interior.
 for(let j=0;j<h;j++)for(let i=0;i<w;i++)heights[j*w+i]=i<160?0:Math.min(40,(i-160)*4)+Math.sin(j*1.7)*.8;
 const g:MeasuredGrid={width:w,height:h,heights,origin:{x:0,z:0},column:{x:.25,z:0},row:{x:0,z:.25}};
 const m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,{blendStartMetres:0,blendEndMetres:.1});
 try{
  patch.group.updateMatrixWorld(true);
  const renderer={getRenderTarget:()=>null,getContext:()=>({drawingBufferHeight:720})} as unknown as THREE.WebGLRenderer;
  const camera=new THREE.PerspectiveCamera(62,16/9,.1,40000);camera.position.set(32,20,16+300);camera.updateMatrixWorld();
  const strides:Record<string,number>={};
  patch.group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.onBeforeRender(renderer,new THREE.Scene(),camera,o.geometry,o.material,null);
   strides[o.name]=o.geometry.drawRange.start===0?1:o.geometry.drawRange.count;});
  assert.equal(strides['measured-grid-128-0'],1,'cliff chunk stays native at 300m');
  assert.notEqual(strides['measured-grid-0-0'],1,'flat chunk coarsens at 300m');
 }finally{patch.dispose();m.dispose();}
});

test('lodPixels 0 keeps the previous full-resolution-only contract',()=>{
 const g=grid(300,260),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,{lodPixels:0});
 try{
  assert.equal(patch.diagnostics.fullResolutionOnly,true);
  for(const geometry of patch.geometries)assert.equal(geometry.index!.count,geometry.drawRange.count);
 }finally{patch.dispose();m.dispose();}
});

test('replaced chunks lock to native triangles and leave unreplaced chunks free',()=>{
 const g=grid(300,260,-1),m=material(),patch=createMeasuredGridPatch(g,{heightAt:()=>0},m,{blendStartMetres:0,blendEndMetres:.1,cutInsetMetres:.5});
 try{
  const cx=g.origin.x+g.column.x*40+g.row.x*40,cz=g.origin.z+g.column.z*40+g.row.z*40,bounds=new THREE.Box3(new THREE.Vector3(cx-3,-100,cz-3),new THREE.Vector3(cx+3,100,cz+3));
  patch.replaceInteriorSurface({coversOriginalTriangle:points=>points.every(p=>Math.hypot(p.x-cx,p.z-cz)<2),surfaceHeightAt:()=>1},bounds);
  const removed=patch.diagnostics.replacement!.removedTriangles;assert.ok(removed>0);
  assert.equal(patch.diagnostics.lod.lockedChunks,1);assert.equal(patch.diagnostics.lod.drawnTriangles,patch.diagnostics.triangles-removed);
  patch.group.updateMatrixWorld(true);
  const renderer={getRenderTarget:()=>null,getContext:()=>({drawingBufferHeight:720})} as unknown as THREE.WebGLRenderer;
  const camera=new THREE.PerspectiveCamera(62,16/9,.1,40000);camera.position.set(cx,40,cz+5000);camera.updateMatrixWorld();
  let locked=0,coarse=0;
  patch.group.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.onBeforeRender(renderer,new THREE.Scene(),camera,o.geometry,o.material,null);
   if(o.geometry.drawRange.count===Infinity){locked++;}else if(o.geometry.drawRange.start>0)coarse++;});
  assert.equal(locked,1);assert.ok(coarse>0);
 }finally{patch.dispose();m.dispose();}
});
