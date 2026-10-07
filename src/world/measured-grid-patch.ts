import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';

export interface GridVector {x:number;z:number}
export interface MeasuredGrid {
  width:number;height:number;heights:Float32Array;valid?:Uint8Array;
  origin:GridVector;column:GridVector;row:GridVector;
}
export interface MeasuredPatchOptions {chunkCells?:number;blendStartMetres?:number;blendEndMetres?:number;cutInsetMetres?:number}
export interface MeasuredPoint extends GridVector {y:number}
export interface MeasuredPatchDiagnostics {
  vertices:number;triangles:number;chunks:number;unknownSamples:number;
  nativeSamples:number;fullResolutionOnly:true;maxUnblendedHeightError:number;
  /** No absolute surveying accuracy is inferred by this helper. */
  kind:'measured-heightfield';
}
export interface MeasuredGridPatch {
  group:THREE.Group;geometries:THREE.BufferGeometry[];diagnostics:MeasuredPatchDiagnostics;
  surfaceHeightAt(x:number,z:number):number|null;
  coversOriginalTriangle(points:readonly [MeasuredPoint,MeasuredPoint,MeasuredPoint]):boolean;
  dispose():void;
}
interface Chunk {i:number;j:number;nx:number;nz:number;x:number;z:number;geometry:THREE.BufferGeometry}
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
/** Native affine heightfield, full resolution at every distance. Geometry is owned;
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
  if(!Number.isInteger(cells)||cells<1||cells>256||start<0||end<=start||inset<0)throw new Error('Invalid measured patch options');
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
  const group=new THREE.Group();group.name='native-measured-grid-patch';group.userData.recon_part='native-measured-heightfield';
  const geometries:THREE.BufferGeometry[]=[],chunks=new Map<string,Chunk>();
  const diagnostics:MeasuredPatchDiagnostics={vertices:0,triangles:0,chunks:0,unknownSamples,nativeSamples:total,fullResolutionOnly:true,maxUnblendedHeightError,kind:'measured-heightfield'};
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
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData.nativeCellOrigin={i:i0,j:j0};geometry.userData.nativeCellSize={width:nx,height:nz};
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,0,z);mesh.name=`measured-grid-${i0}-${j0}`;mesh.frustumCulled=true;group.add(mesh);geometries.push(geometry);chunks.set(`${Math.floor(i0/cells)},${Math.floor(j0/cells)}`,{i:i0,j:j0,nx,nz,x,z,geometry});diagnostics.vertices+=positions.length/3;diagnostics.triangles+=indices.length/3;
  }
  diagnostics.chunks=geometries.length;
  const inverse=(x:number,z:number)=>{const dx=x-o.x,dz=z-o.z;return {i:(dx*r.z-dz*r.x)/det,j:(dz*c.x-dx*c.z)/det};};
  let disposed=false;
  const surfaceHeightAt=(x:number,z:number):number|null=>{
    if(disposed||!Number.isFinite(x)||!Number.isFinite(z))return null;
    const q=inverse(x,z),eps=2e-4;if(q.i< -eps||q.j< -eps||q.i>w-1+eps||q.j>h-1+eps)return null;
    const ii=Math.min(w-2,Math.max(0,Math.floor(q.i))),jj=Math.min(h-2,Math.max(0,Math.floor(q.j)));
    // Float32 XZ rounding can put a native edge in the neighboring cell. Inspect only
    // the local 3x3 neighborhood, using actual render coordinates rather than extrapolating.
    for(const [di,dj] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
    const i=ii+di,j=jj+dj;if(i<0||j<0||i>=w-1||j>=h-1)continue;
    const chunk=chunks.get(`${Math.floor(i/cells)},${Math.floor(j/cells)}`)!;
    const p=chunk.geometry.getAttribute('position'),a=(j-chunk.j)*(chunk.nx+1)+(i-chunk.i),b=a+1,d=a+chunk.nx+1,e=d+1;
    const px=x-chunk.x,pz=z-chunk.z;
    for(const [va,vb,vc] of [[a,d,b],[b,d,e]]){
      const ax=p.getX(va),az=p.getZ(va),bx=p.getX(vb),bz=p.getZ(vb),cx=p.getX(vc),cz=p.getZ(vc),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const wa=((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/den,wb=((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/den,wc=1-wa-wb;
      if(wa>=-1e-8&&wb>=-1e-8&&wc>=-1e-8)return wa*p.getY(va)+wb*p.getY(vb)+wc*p.getY(vc);
    }}return null;
  };
  return {group,geometries,diagnostics,surfaceHeightAt,coversOriginalTriangle(points){return !disposed&&points.every(p=>{if(![p.x,p.y,p.z].every(Number.isFinite))return false;const q=inverse(p.x,p.z);return border(q.i,q.j)>inset;});},dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();group.clear();chunks.clear();}};
}
