import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';

export interface GridVector {x:number;z:number}
export interface MeasuredGrid {
  width:number;height:number;heights:Float32Array;valid?:Uint8Array;
  origin:GridVector;column:GridVector;row:GridVector;
}
/** lodPixels: largest projected cell edge (drawing-buffer px) a coarser level may
 * draw; 0 keeps every chunk at native resolution. */
export interface MeasuredPatchOptions {chunkCells?:number;blendStartMetres?:number;blendEndMetres?:number;cutInsetMetres?:number;lodPixels?:number}
export interface MeasuredPoint extends GridVector {y:number}
export interface MeasuredPatchDiagnostics {
  vertices:number;triangles:number;chunks:number;unknownSamples:number;
  /** False when distant chunks may draw a coarser index over the same vertices. */
  nativeSamples:number;fullResolutionOnly:boolean;maxUnblendedHeightError:number;
  /** No absolute surveying accuracy is inferred by this helper. */
  kind:'measured-heightfield';
  replacement?:{checkedTriangles:number;removedTriangles:number};
  lod:MeasuredPatchLodDiagnostics;
}
export interface MeasuredPatchLodDiagnostics {
  pixels:number;strides:number[];lockedChunks:number;
  /** Most recent selection; render-side only, height queries stay native. */
  drawnTriangles:number;chunksByStride:Record<number,number>;
}
/** Coverage promises a finite query across the entire accepted triangle, not
 * just its corners. The replacement and its resources remain caller-owned. */
export interface MeasuredInteriorSurface {
  surfaceHeightAt(x:number,z:number):number|null;
  coversOriginalTriangle(points:readonly [MeasuredPoint,MeasuredPoint,MeasuredPoint]):boolean;
}
export interface MeasuredGridPatch {
  group:THREE.Group;geometries:THREE.BufferGeometry[];diagnostics:MeasuredPatchDiagnostics;
  surfaceHeightAt(x:number,z:number):number|null;
  coversOriginalTriangle(points:readonly [MeasuredPoint,MeasuredPoint,MeasuredPoint]):boolean;
  replaceInteriorSurface(surface:MeasuredInteriorSurface,bounds:THREE.Box3):void;
  prepareInteriorReplacement(surface:MeasuredInteriorSurface,bounds:THREE.Box3):MeasuredReplacementPlan;
  dispose():void;
}
/** Caller owns the footprint geometry; preparing never changes visible ground.
 * A committed plan cannot be reused. Replacement resources remain borrowed. */
export interface MeasuredReplacementPlan {
  coverageGeometry:THREE.BufferGeometry;origin:THREE.Vector3;
  diagnostics:{checkedTriangles:number;removedTriangles:number};
  commit(surface?:MeasuredInteriorSurface):void;
  dispose():void;
}
/** Little-endian digest of the selected triangle coordinates, winding
 * and shared origin. Unused chunk vertices are deliberately excluded. */
export async function measuredReplacementFootprintSha256(plan:Pick<MeasuredReplacementPlan,'coverageGeometry'|'origin'>):Promise<string>{
  const p=plan.coverageGeometry.getAttribute('position'),idx=plan.coverageGeometry.index!;
  if(!idx||idx.count%3!==0||idx.count>6_000_000)throw new Error('Footprint hash budget exceeded');
  const bytes=new ArrayBuffer(28+idx.count*12),view=new DataView(bytes);
  view.setUint32(0,idx.count/3,true);view.setFloat64(4,plan.origin.x,true);view.setFloat64(12,plan.origin.y,true);view.setFloat64(20,plan.origin.z,true);
  for(let i=0;i<idx.count;i++){const n=idx.getX(i);view.setFloat32(28+i*12,p.getX(n),true);view.setFloat32(32+i*12,p.getY(n),true);view.setFloat32(36+i*12,p.getZ(n),true);}
  const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
/** error: largest vertical distance (m) from a native sample to this level's surface. */
interface ChunkLevel {stride:number;start:number;count:number;error:number}
interface Chunk {i:number;j:number;nx:number;nz:number;x:number;z:number;geometry:THREE.BufferGeometry;removed?:Uint8Array;
  /** Native triangles occupy index [0,fine); coarser levels follow in the same buffer. */
  fine:number;levels:ChunkLevel[];level:number;locked:boolean}
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
const LOD_STRIDES=[2,4,8,16,32,64];
/** Smaller chunks save too few triangles to justify extra index ranges. */
const LOD_MIN_CELLS=32;
/** Largest projected vertical error a coarser level may introduce. Steep cliffs keep
 * native triangles far longer than flat ground, which spacing alone cannot tell apart. */
const LOD_ERROR_PIXELS=1;
/** Vertical error of the stride-s surface over native samples (i0..i0+nx, j0..j0+nz).
 * Border fans are approximated by the interior cell split; seams are exact anyway. */
function coarseError(sample:(i:number,j:number)=>number,nx:number,nz:number,stride:number):number{
  let error=0;
  for(let a=0;a<nx;a+=stride)for(let c=0;c<nz;c+=stride){
    const b=Math.min(nx,a+stride),d=Math.min(nz,c+stride);
    const y00=sample(a,c),y10=sample(b,c),y01=sample(a,d),y11=sample(b,d);
    for(let j=c;j<=d;j++)for(let i=a;i<=b;i++){
      if(i===0||j===0||i===nx||j===nz)continue; // native border samples are kept exactly
      const u=(i-a)/(b-a),v=(j-c)/(d-c);
      const y=u+v<=1?y00+u*(y10-y00)+v*(y01-y00):y11+(1-u)*(y01-y11)+(1-v)*(y10-y11);
      error=Math.max(error,Math.abs(sample(i,j)-y));
    }
  }
  return error;
}
/** Coarse triangles over the chunk's own native vertices. The outer ring keeps every
 * native edge vertex, so any mix of neighbouring levels shares identical seams and
 * never opens T-junction cracks. `negative` is the ij orientation of native triangles. */
export function coarseChunkIndices(nx:number,nz:number,stride:number,negative:boolean):number[]|null{
  const axis=(n:number)=>{const v:number[]=[];for(let k=0;k<n;k+=stride)v.push(k);v.push(n);return v;};
  const xs=axis(nx),zs=axis(nz);if(xs.length<3||zs.length<3)return null;
  const row=nx+1,out:number[]=[];
  const tri=(p:readonly number[],q:readonly number[],r:readonly number[])=>{
    const cross=(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(cross===0)return;
    if((cross<0)===negative)out.push(p[1]*row+p[0],q[1]*row+q[0],r[1]*row+r[0]);
    else out.push(p[1]*row+p[0],r[1]*row+r[0],q[1]*row+q[0]);
  };
  for(let cj=0;cj<zs.length-1;cj++)for(let ci=0;ci<xs.length-1;ci++){
    const a=xs[ci],b=xs[ci+1],c=zs[cj],d=zs[cj+1],left=a===0,right=b===nx,bottom=c===0,top=d===nz;
    if(!left&&!right&&!bottom&&!top){tri([a,c],[a,d],[b,c]);tri([b,c],[a,d],[b,d]);continue;}
    const ring:number[][]=[];
    for(let i=a;i<b;i+=bottom?1:b-a)ring.push([i,c]);
    for(let j=c;j<d;j+=right?1:d-c)ring.push([b,j]);
    for(let i=b;i>a;i-=top?1:b-a)ring.push([i,d]);
    for(let j=d;j>c;j-=left?1:d-c)ring.push([a,j]);
    // With at least two cells per axis, one corner touches no subdivided edge.
    const apex=[[a,c,!bottom&&!left],[b,c,!bottom&&!right],[b,d,!right&&!top],[a,d,!top&&!left]].find(v=>v[2])!;
    const k0=ring.findIndex(p=>p[0]===apex[0]&&p[1]===apex[1]);
    for(let k=1;k<ring.length-1;k++)tri(ring[k0],ring[(k0+k)%ring.length],ring[(k0+k+1)%ring.length]);
  }
  return out;
}
/** Native affine heightfield. Height queries, raycasts, replacement and footprints
 * always use native triangles; only rendering may select a coarser index per chunk
 * from the drawing camera (lodPixels). Geometry is owned;
 * input arrays, fallback and material/textures are borrowed and never modified/disposed.
 * It restores neither overhangs nor closed solids, and does not register worldSolid/BVH.
 */
export function createMeasuredGridPatch(grid:MeasuredGrid,fallbackGround:GroundSampler,material:THREE.MeshStandardMaterial,options:MeasuredPatchOptions={}):MeasuredGridPatch {
  const {width:w,height:h,origin:o,column:c,row:r}=grid,total=w*h;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||total>4194304||grid.heights.length!==total||grid.valid&&grid.valid.length!==total)throw new Error('Invalid measured grid dimensions or arrays');
  if(![o.x,o.z,c.x,c.z,r.x,r.z,...Object.values(options).filter(v=>v!==undefined)].every(Number.isFinite))throw new Error('Non-finite measured grid/options');
  for(const y of grid.heights)if(!Number.isFinite(y))throw new Error('Non-finite measured sample');
  const det=c.x*r.z-c.z*r.x,cl=Math.hypot(c.x,c.z),rl=Math.hypot(r.x,r.z);
  if(![cl,rl,det].every(Number.isFinite)||cl<1e-6||rl<1e-6||Math.abs(det)/(cl*rl)<1e-6)throw new Error('Degenerate measured grid affine');
  if(cl*(w-1)+rl*(h-1)>3e38||![o.x+c.x*(w-1)+r.x*(h-1),o.z+c.z*(w-1)+r.z*(h-1)].every(Number.isFinite))throw new Error('Affine exceeds finite render coordinates');
  const cells=options.chunkCells??128,start=options.blendStartMetres??12,end=options.blendEndMetres??32,inset=options.cutInsetMetres??8;
  // terrainlod=0 compares the native-only rendering in the same build.
  const query=typeof location!=='undefined'?new URLSearchParams(location.search).get('terrainlod'):null;
  const lodPixels=options.lodPixels??(query!==null?Math.max(0,Number(query)||0):4);
  if(!Number.isInteger(cells)||cells<1||cells>256||start<0||end<=start||inset<0||lodPixels<0)throw new Error('Invalid measured patch options');
  // Perpendicular distance to the four affine boundary lines, in world metres.
  const ci=Math.abs(det)/rl,rj=Math.abs(det)/cl;
  const border=(i:number,j:number)=>Math.min(i*ci,(w-1-i)*ci,j*rj,(h-1-j)*rj);
  const values=new Float32Array(total);
  let unknownSamples=0,maxUnblendedHeightError=0;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const n=j*w+i,known=!grid.valid||grid.valid[n]!==0,t=known?smooth((border(i,j)-start)/(end-start)):0;
    if(!known)unknownSamples++;
    let y=grid.heights[n];
    if(t<1){const fallback=fallbackGround.heightAt(o.x+c.x*i+r.x*j,o.z+c.z*i+r.z*j);if(!Number.isFinite(fallback))throw new Error('Non-finite fallback height');y=fallback*(1-t)+y*t;}
    values[n]=y;if(!Number.isFinite(values[n]))throw new Error('Height exceeds finite Float32 range');
    if(t===1)maxUnblendedHeightError=Math.max(maxUnblendedHeightError,Math.abs(values[n]-grid.heights[n]));
  }
  const group=new THREE.Group();group.name='native-measured-grid-patch';group.userData.recon_part='native-measured-heightfield';group.userData.heightfieldSurface=true;
  const geometries:THREE.BufferGeometry[]=[],chunks=new Map<string,Chunk>();
  const lod:MeasuredPatchLodDiagnostics={pixels:lodPixels,strides:[],lockedChunks:0,drawnTriangles:0,chunksByStride:{1:0}};
  const diagnostics:MeasuredPatchDiagnostics={vertices:0,triangles:0,chunks:0,unknownSamples,nativeSamples:total,fullResolutionOnly:true,maxUnblendedHeightError,kind:'measured-heightfield',lod};
  // Rendering-only selection. The same drawing camera picks the level for every pass
  // it draws; shadow passes reuse the most recent perspective choice.
  const cellMetres=Math.min(cl,rl),eye=new THREE.Vector3(),worldBox=new THREE.Box3();
  const selectLevel=(chunk:Chunk,mesh:THREE.Mesh,renderer:THREE.WebGLRenderer,camera:THREE.Camera)=>{
    if(chunk.locked||!chunk.levels.length||!(camera as THREE.PerspectiveCamera).isPerspectiveCamera)return;
    const target=renderer.getRenderTarget(),height=target?target.height:renderer.getContext().drawingBufferHeight;
    eye.setFromMatrixPosition(camera.matrixWorld);worldBox.copy(chunk.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    // Drawing-buffer pixels per metre at the chunk's nearest point.
    const scale=camera.projectionMatrix.elements[5]*height*.5/Math.max(.001,worldBox.distanceToPoint(eye)),current=chunk.level;
    // Coarsening needs a 20% margin, so a chunk cannot alternate at a threshold.
    let next=0;
    for(let level=1;level<=chunk.levels.length;level++){
      const l=chunk.levels[level-1],margin=level>current?.8:1;
      if(cellMetres*l.stride*scale>lodPixels*margin||l.error*scale>LOD_ERROR_PIXELS*margin)break;
      next=level;
    }
    if(next!==current)setLevel(chunk,next);
  };
  const levelStart=(chunk:Chunk,level:number)=>level===0?0:chunk.levels[level-1].start;
  const levelCount=(chunk:Chunk,level:number)=>level===0?chunk.fine:chunk.levels[level-1].count;
  const levelStride=(chunk:Chunk,level:number)=>level===0?1:chunk.levels[level-1].stride;
  const setLevel=(chunk:Chunk,level:number)=>{
    const from=levelStride(chunk,chunk.level),to=levelStride(chunk,level);
    chunk.geometry.setDrawRange(levelStart(chunk,level),levelCount(chunk,level));
    lod.drawnTriangles+=(levelCount(chunk,level)-levelCount(chunk,chunk.level))/3;
    lod.chunksByStride[from]--;lod.chunksByStride[to]=(lod.chunksByStride[to]??0)+1;chunk.level=level;
  };
  for(let j0=0;j0<h-1;j0+=cells)for(let i0=0;i0<w-1;i0+=cells){
    const nx=Math.min(cells,w-1-i0),nz=Math.min(cells,h-1-j0),stride=nx+1;
    // One shared origin means duplicated chunk-edge Float32 positions are bit-identical.
    const x=o.x,z=o.z;
    const positions=new Float32Array(stride*(nz+1)*3),normals=new Float32Array(positions.length),uvs=new Float32Array(stride*(nz+1)*2),indices:number[]=[];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const gi=i0+i,gj=j0+j,n=j*stride+i,p=n*3;
      positions[p]=c.x*gi+r.x*gj;positions[p+1]=values[gj*w+gi];positions[p+2]=c.z*gi+r.z*gj;
      const il=Math.max(0,gi-1),ir=Math.min(w-1,gi+1),jl=Math.max(0,gj-1),jr=Math.min(h-1,gj+1);
      const yi=(values[gj*w+ir]-values[gj*w+il])/(ir-il),yj=(values[jr*w+gi]-values[jl*w+gi])/(jr-jl);
      const dx=(yi*r.z-yj*c.z)/det,dz=(yj*c.x-yi*r.x)/det,length=Math.hypot(dx,1,dz);
      normals[p]=-dx/length;normals[p+1]=1/length;normals[p+2]=-dz/length;
      uvs[n*2]=gi*cl/2.7;uvs[n*2+1]=gj*rl/2.7;
    }
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*stride+i,b=a+1,d=a+stride,e=d+1;if(det>0)indices.push(a,d,b,b,d,e);else indices.push(a,b,d,b,e,d);}
    const fine=indices.length,levels:ChunkLevel[]=[];
    if(lodPixels>0&&Math.min(nx,nz)>=LOD_MIN_CELLS)for(const s of LOD_STRIDES){
      const coarse=coarseChunkIndices(nx,nz,s,det>0);if(!coarse)break;
      // Errors never shrink with a coarser stride, so later levels stay monotonic.
      const error=Math.max(levels.at(-1)?.error??0,coarseError((i,j)=>values[(j0+j)*w+i0+i],nx,nz,s));
      levels.push({stride:s,start:indices.length,count:coarse.length,error});for(const n of coarse)indices.push(n);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.setDrawRange(0,fine);geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData.nativeCellOrigin={i:i0,j:j0};geometry.userData.nativeCellSize={width:nx,height:nz};
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,0,z);mesh.name=`measured-grid-${i0}-${j0}`;mesh.userData.heightfieldSurface=true;mesh.frustumCulled=true;group.add(mesh);geometries.push(geometry);
    const chunk:Chunk={i:i0,j:j0,nx,nz,x,z,geometry,fine,levels,level:0,locked:false};chunks.set(`${Math.floor(i0/cells)},${Math.floor(j0/cells)}`,chunk);
    if(levels.length)mesh.onBeforeRender=(renderer,_scene,camera)=>selectLevel(chunk,mesh,renderer,camera);
    diagnostics.vertices+=positions.length/3;diagnostics.triangles+=fine/3;lod.drawnTriangles+=fine/3;lod.chunksByStride[1]++;
  }
  diagnostics.chunks=geometries.length;
  for(const chunk of chunks.values())for(const level of chunk.levels)if(!lod.strides.includes(level.stride))lod.strides.push(level.stride);
  lod.strides.sort((a,b)=>a-b);diagnostics.fullResolutionOnly=lod.strides.length===0;
  const inverse=(x:number,z:number)=>{const dx=x-o.x,dz=z-o.z;return {i:(dx*r.z-dz*r.x)/det,j:(dz*c.x-dx*c.z)/det};};
  let disposed=false,replacement:MeasuredInteriorSurface|null=null;
  const surfaceHeightAt=(x:number,z:number):number|null=>{
    if(disposed||!Number.isFinite(x)||!Number.isFinite(z))return null;
    const q=inverse(x,z),eps=2e-4;if(q.i< -eps||q.j< -eps||q.i>w-1+eps||q.j>h-1+eps)return null;
    const ii=Math.min(w-2,Math.max(0,Math.floor(q.i))),jj=Math.min(h-2,Math.max(0,Math.floor(q.j)));
    // Float32 XZ rounding can put a native edge in the neighboring cell. Inspect only
    // the local 3x3 neighborhood, using actual render coordinates rather than extrapolating.
    let best=-Infinity;
    for(const [di,dj] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
    const i=ii+di,j=jj+dj;if(i<0||j<0||i>=w-1||j>=h-1)continue;
    const chunk=chunks.get(`${Math.floor(i/cells)},${Math.floor(j/cells)}`)!;
    const p=chunk.geometry.getAttribute('position'),a=(j-chunk.j)*(chunk.nx+1)+(i-chunk.i),b=a+1,d=a+chunk.nx+1,e=d+1;
    const px=x-chunk.x,pz=z-chunk.z;
    let half=0;for(const [va,vb,vc] of [[a,d,b],[b,d,e]]){
      const ax=p.getX(va),az=p.getZ(va),bx=p.getX(vb),bz=p.getZ(vb),cx=p.getX(vc),cz=p.getZ(vc),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const wa=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/den,wb=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/den,wc=1-wa-wb;
      if(wa>=-1e-8&&wb>=-1e-8&&wc>=-1e-8){
        const removed=chunk.removed?.[((j-chunk.j)*chunk.nx+i-chunk.i)*2+half];
        // The loose native-edge tolerance is safe for a continuous grid, but
        // must not extend a raised replacement across its actual diagonal.
        const insideReplacement=wa>=-1e-12&&wb>=-1e-12&&wc>=-1e-12;
        const y=removed?(insideReplacement?replacement!.surfaceHeightAt(x,z):null):wa*p.getY(va)+wb*p.getY(vb)+wc*p.getY(vc);
        if(y!==null&&Number.isFinite(y)&&(!replacement||(wa>1e-7&&wb>1e-7&&wc>1e-7)))return y;
        if(y!==null&&Number.isFinite(y))best=Math.max(best,y);
      }
      half++;
    }}return best===-Infinity?null:best;
  };
  const prepareInteriorReplacement=(surface:MeasuredInteriorSurface,bounds:THREE.Box3):MeasuredReplacementPlan=>{
    if(disposed||replacement)throw new Error('Native patch replacement already attached or disposed');
    if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw new Error('Finite replacement bounds required');
    const checked:{chunk:Chunk;indices:number[];mask:Uint8Array;originalIndex:THREE.BufferAttribute;removedIndex:number[]}[]=[];
    let checkedTriangles=0,removedTriangles=0;
    for(const chunk of chunks.values()){
      const g=chunk.geometry,p=g.getAttribute('position'),idx=g.index!;
      const box=g.boundingBox!.clone().translate(new THREE.Vector3(chunk.x,0,chunk.z));
      if(!box.intersectsBox(bounds))continue;
      const mask=new Uint8Array(chunk.nx*chunk.nz*2),kept:number[]=[],removedIndex:number[]=[];
      for(let k=0;k<chunk.fine;k+=3){
        const ids=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)] as const;
        const points=ids.map(n=>({x:p.getX(n)+chunk.x,y:p.getY(n),z:p.getZ(n)+chunk.z})) as [MeasuredPoint,MeasuredPoint,MeasuredPoint];
        let remove=false;
        if(points.every(point=>bounds.containsPoint(new THREE.Vector3(point.x,point.y,point.z)))){
          checkedTriangles++;
          if(surface.coversOriginalTriangle(points)){
            // Validate representative queries before mutating any geometry. The
            // callback's whole-triangle coverage contract is still essential.
            for(const point of [...points,{x:points.reduce((s,v)=>s+v.x,0)/3,z:points.reduce((s,v)=>s+v.z,0)/3}]){
              const y=surface.surfaceHeightAt(point.x,point.z);
              if(y===null||!Number.isFinite(y))throw new Error('Replacement coverage lacks a finite floor');
            }
            remove=true;
          }
        }
        if(remove){
          const localJ=Math.floor(Math.min(...ids)/(chunk.nx+1)),localI=Math.min(...ids.map(n=>n%(chunk.nx+1)));
          const a=localJ*(chunk.nx+1)+localI,half=ids.includes(a)?0:1;
          mask[(localJ*chunk.nx+localI)*2+half]=1;removedTriangles++;
          removedIndex.push(...ids);
        }else kept.push(...ids);
      }
      if(mask.some(v=>v!==0))checked.push({chunk,indices:kept,mask,originalIndex:idx,removedIndex});
    }
    // All native chunks use the same translation. Preserve their actual local
    // Float32 coordinates instead of rounding world coordinates near x=5800.
    const vertexCount=checked.reduce((s,e)=>s+e.chunk.geometry.getAttribute('position').count,0);
    const positions=new Float32Array(vertexCount*3),indices=new Uint32Array(removedTriangles*3);
    let vertexOffset=0,indexOffset=0;
    for(const e of checked){const p=e.chunk.geometry.getAttribute('position');
      for(let n=0;n<p.count;n++){positions[(vertexOffset+n)*3]=p.getX(n);positions[(vertexOffset+n)*3+1]=p.getY(n);positions[(vertexOffset+n)*3+2]=p.getZ(n);}
      for(const id of e.removedIndex)indices[indexOffset++]=id+vertexOffset;
      vertexOffset+=p.count;
    }
    const coverageGeometry=new THREE.BufferGeometry();coverageGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));coverageGeometry.setIndex(new THREE.BufferAttribute(indices,1));
    let consumed=false,released=false;
    return {coverageGeometry,origin:new THREE.Vector3(o.x,0,o.z),diagnostics:{checkedTriangles,removedTriangles},
      commit(chosen=surface){
        if(consumed||released||disposed||replacement)throw new Error('Replacement plan is stale, consumed or disposed');
        if(checked.some(e=>e.chunk.geometry.index!==e.originalIndex))throw new Error('Native topology changed after replacement was prepared');
        if(chosen!==surface)for(const e of checked){const p=e.chunk.geometry.getAttribute('position');
          for(let k=0;k<e.removedIndex.length;k+=3){
            const q=e.removedIndex.slice(k,k+3).map(n=>({x:p.getX(n)+e.chunk.x,y:p.getY(n),z:p.getZ(n)+e.chunk.z})) as [MeasuredPoint,MeasuredPoint,MeasuredPoint];
            if(!chosen.coversOriginalTriangle(q))throw new Error(`Final replacement does not cover the prepared footprint at ${q.map(p=>`${p.x},${p.z}`).join(';')}`);
            for(const point of [...q,{x:q.reduce((s,v)=>s+v.x,0)/3,z:q.reduce((s,v)=>s+v.z,0)/3}]){
              const y=chosen.surfaceHeightAt(point.x,point.z);if(y===null||!Number.isFinite(y))throw new Error('Final replacement lacks a finite floor');
            }
          }
        }
        // Coarse levels cannot honour a partial cut, so replaced chunks stay native.
        for(const e of checked){
          if(e.chunk.level!==0)setLevel(e.chunk,0);
          lod.drawnTriangles+=(e.indices.length-e.chunk.fine)/3;
          e.chunk.geometry.setIndex(e.indices);e.chunk.geometry.setDrawRange(0,Infinity);e.chunk.fine=e.indices.length;e.chunk.levels=[];
          e.chunk.locked=true;lod.lockedChunks++;e.chunk.removed=e.mask;
        }
        replacement=chosen;diagnostics.replacement={checkedTriangles,removedTriangles};consumed=true;
      },
      dispose(){if(released)return;released=true;coverageGeometry.dispose();}
    };
  };
  const replaceInteriorSurface=(surface:MeasuredInteriorSurface,bounds:THREE.Box3)=>{const plan=prepareInteriorReplacement(surface,bounds);try{plan.commit();}finally{plan.dispose();}};
  return {group,geometries,diagnostics,surfaceHeightAt,replaceInteriorSurface,prepareInteriorReplacement,coversOriginalTriangle(points){return !disposed&&points.every(p=>{if(![p.x,p.y,p.z].every(Number.isFinite))return false;const q=inverse(p.x,p.z);return border(q.i,q.j)>inset;});},dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();group.clear();chunks.clear();replacement=null;}};
}
