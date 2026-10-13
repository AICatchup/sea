import * as THREE from 'three';
import {scanBoundaryEdges} from './grounded-reef.ts';

const rimCache=new WeakMap<THREE.BufferGeometry,readonly (readonly [THREE.Vector3,THREE.Vector3])[]>();
function rimEdges(geometry:THREE.BufferGeometry){
  const cached=rimCache.get(geometry);if(cached)return cached;
  const p=geometry.getAttribute('position'),points:[THREE.Vector3,THREE.Vector3][]=[];
  for(const [a,b] of scanBoundaryEdges(geometry)){
    const start=new THREE.Vector3().fromBufferAttribute(p,a),end=new THREE.Vector3().fromBufferAttribute(p,b);
    points.push([start,end]);
  }
  rimCache.set(geometry,points);return points;
}

/** Rigidly seat an open scan's crop rim. An impossible site is reported to the
 * placement owner; never stretch the photographed geometry or claim support.
 * Discrete search is intentional: heightfield contact is not monotone on crags. */
export function seatShelfBoundary(geometry:THREE.BufferGeometry,matrix:THREE.Matrix4,
  heightAt:(x:number,z:number)=>number,normal:THREE.Vector3,maxInset=1.5){
  const result={accepted:false,moved:0,samples:0,maxExposureBefore:0,maxExposureAfter:0};
  if(!matrix.elements.every(Number.isFinite)||!Number.isFinite(maxInset)||maxInset<0||!normal.toArray().every(Number.isFinite)||normal.lengthSq()<.1)return result;
  const axis=normal.clone().normalize(),world:THREE.Vector3[]=[],point=new THREE.Vector3();
  for(const [a,b] of rimEdges(geometry)){
    const start=a.clone().applyMatrix4(matrix),end=b.clone().applyMatrix4(matrix);
    // Resolve every actual crop edge at <=10cm in world space, including interiors.
    const steps=Math.max(1,Math.ceil(start.distanceTo(end)/.1));
    for(let i=0;i<=steps;i++)world.push(start.clone().lerp(end,i/steps));
  }
  result.samples=world.length;if(!world.length)return result;
  const exposure=(inset:number)=>{
    let worst=-Infinity;
    for(const p of world){
      point.copy(p).addScaledVector(axis,-inset);const h=heightAt(point.x,point.z);
      if(!Number.isFinite(h))return Infinity;
      worst=Math.max(worst,point.y-h);
    }
    return worst;
  };
  result.maxExposureBefore=result.maxExposureAfter=exposure(0);
  if(!Number.isFinite(result.maxExposureBefore))return result;
  if(result.maxExposureBefore<=-.035){result.accepted=true;return result;}
  const steps=Math.min(64,Math.max(1,Math.ceil(maxInset/.05)));
  for(let step=1;step<=steps;step++){
    const amount=maxInset*step/steps,gap=exposure(amount);
    if(!Number.isFinite(gap))return result;
    if(gap>-.035)continue;
    matrix.elements[12]-=axis.x*amount;matrix.elements[13]-=axis.y*amount;matrix.elements[14]-=axis.z*amount;
    result.accepted=true;result.moved=amount;result.maxExposureAfter=gap;return result;
  }
  return result;
}
