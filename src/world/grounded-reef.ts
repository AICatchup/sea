import * as THREE from 'three';
import {smoothNormalsByPosition} from './models/procedural.ts';

type HeightAt=(x:number,z:number)=>number;
const boundaryCache=new WeakMap<THREE.BufferGeometry,readonly [number,number][]>();
function sedimentVariation(x:number,z:number):number{
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  const hash=(a:number,b:number)=>{let n=Math.imul(a,374761393)^Math.imul(b,668265263)^0x34ef091;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;};
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),sx),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),sx),sz);
}

/** Weld position seams only for boundary discovery. The scan's UV seams,
 * photographed maps, indices and vertex ownership are retained in the result. */
export function scanBoundaryEdges(source:THREE.BufferGeometry):readonly [number,number][]{
  const cached=boundaryCache.get(source);if(cached)return cached;
  const p=source.getAttribute('position'),index=source.index;
  if(!p||p.itemSize!==3||p.count<3)throw new Error('A positioned scan is required');
  const keys:string[]=[],edges=new Map<string,{count:number;ends:[number,number]}>();
  for(let i=0;i<p.count;i++){
    const point=[p.getX(i),p.getY(i),p.getZ(i)];
    if(!point.every(Number.isFinite))throw new Error('Nonfinite scan position');
    keys.push(point.map(n=>Math.round(n*1e5)).join(','));
  }
  const count=index?.count??p.count;
  if(count%3)throw new Error('Triangular scan indices are required');
  for(let t=0;t<count;t+=3){
    const ids=[0,1,2].map(k=>index?index.getX(t+k):t+k);
    if(ids.some(i=>!Number.isInteger(i)||i<0||i>=p.count))throw new Error('Invalid scan index');
    for(let k=0;k<3;k++){
      const a=ids[k],b=ids[(k+1)%3],ka=keys[a],kb=keys[b];if(ka===kb)continue;
      const key=ka<kb?ka+'|'+kb:kb+'|'+ka,edge=edges.get(key);
      if(edge)edge.count++;else edges.set(key,{count:1,ends:[a,b]});
    }
  }
  const result=[...edges.values()].filter(e=>e.count===1).map(e=>e.ends);boundaryCache.set(source,result);return result;
}

/** An open photogrammetry shelf is a surface, not a solid rock placed at its
 * global minimum. Retain its relief and bury the actual irregular perimeter.
 * The broad seabed height field remains unchanged; the returned mesh is also
 * bound to the existing solid registry by its owner. Placement is inferred. */
export function groundScannedShelf(source:THREE.BufferGeometry,matrix:THREE.Matrix4,heightAt:HeightAt,
  {apron=.55,embed=.08,reliefScale=2}:{apron?:number;embed?:number;reliefScale?:number}={}){
  if(!matrix.elements.every(Number.isFinite)||![apron,embed,reliefScale].every(v=>Number.isFinite(v)&&v>0))throw new Error('Finite positive shelf dimensions are required');
  const edges=scanBoundaryEdges(source),geometry=source.clone().applyMatrix4(matrix),p=geometry.getAttribute('position'),original=source.getAttribute('position');
  const sy=Math.hypot(matrix.elements[4],matrix.elements[5],matrix.elements[6]);
  // The source's photographed ground is sloped: its global lowest vertex is
  // not the base beneath every stone. Fit that datum from the open perimeter
  // before draping its rock relief, avoiding a raised rectangular carpet.
  const ids=[...new Set(edges.flat())];
  const normal=new THREE.Matrix3(),sum=new THREE.Vector3(),datum=new THREE.Vector3();
  let xx=0,xz=0,xs=0,zz=0,zs=0;
  for(const i of ids){const x=original.getX(i),y=original.getY(i),z=original.getZ(i);xx+=x*x;xz+=x*z;xs+=x;zz+=z*z;zs+=z;sum.add(new THREE.Vector3(x*y,z*y,y));}
  normal.set(xx,xz,xs,xz,zz,zs,xs,zs,ids.length);
  if(ids.length>=3&&Math.abs(normal.determinant())>1e-12)datum.copy(sum).applyMatrix3(normal.invert());
  else {let low=Infinity;for(let i=0;i<original.count;i++)low=Math.min(low,original.getY(i));datum.z=low;}
  const perimeter=edges.map(([a,b])=>[p.getX(a),p.getZ(a),p.getX(b),p.getZ(b)]);
  let minRelief=Infinity,maxRelief=-Infinity;
  try{
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),ground=heightAt(x,z);
      if(!Number.isFinite(ground))throw new Error('Nonfinite shelf ground');
      let distance=Infinity;
      for(const [ax,az,bx,bz] of perimeter){
        const dx=bx-ax,dz=bz-az,len=dx*dx+dz*dz,t=len>1e-16?THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/len,0,1):0;
        distance=Math.min(distance,Math.hypot(x-ax-t*dx,z-az-t*dz));
      }
      // A cut scan outline must not turn into a straight exposed platform.
      // World-fixed unequal sediment tongues bury different widths at each
      // placement; the central scanned stones keep their source relief.
      const burial=apron*(.25+1.55*sedimentVariation(x*.68,z*.68));
      const transition=apron*(.6+.8*sedimentVariation(x*1.37+17,z*1.37-9));
      const t=THREE.MathUtils.clamp((distance-burial)/transition,0,1),weight=t*t*(3-2*t);
      const base=datum.x*original.getX(i)+datum.y*original.getZ(i)+datum.z;
      const relief=(original.getY(i)-base)*sy*reliefScale*weight-embed;
      p.setY(i,ground+relief);minRelief=Math.min(minRelief,relief);maxRelief=Math.max(maxRelief,relief);
    }
    p.needsUpdate=true;smoothNormalsByPosition(geometry);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let maxBoundaryExposure=-Infinity;
    for(const [a,b] of edges)for(const t of [0,.25,.5,.75,1]){
      const x=THREE.MathUtils.lerp(p.getX(a),p.getX(b),t),z=THREE.MathUtils.lerp(p.getZ(a),p.getZ(b),t);
      maxBoundaryExposure=Math.max(maxBoundaryExposure,THREE.MathUtils.lerp(p.getY(a),p.getY(b),t)-heightAt(x,z));
    }
    const diagnostics={boundaryEdges:edges.length,maxBoundaryExposure,minRelief,maxRelief,apron,embed,reliefScale,sourceGroundPlane:datum.toArray(),triangles:(geometry.index?.count??p.count)/3};
    geometry.userData.groundedShelf=diagnostics;
    return {geometry,diagnostics};
  }catch(error){geometry.dispose();throw error;}
}
