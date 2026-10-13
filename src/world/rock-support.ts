import * as THREE from 'three';

/** Seat an intact scan into its support along the local ground normal. Only the
 * instance transform changes. Work is bounded and performed once while loading. */
export function seatCoastalRock(geometry:THREE.BufferGeometry, matrix:THREE.Matrix4,
  heightAt:(x:number,z:number)=>number, normal:THREE.Vector3, maxInset:number) {
  const source=geometry.getAttribute('position'), point=new THREE.Vector3();
  const result={moved:0,embeddedBefore:0,embeddedAfter:0,samples:0,unresolved:false};
  if(!source||!matrix.elements.every(Number.isFinite)||!Number.isFinite(maxInset)||maxInset<=0||!normal.toArray().every(Number.isFinite)||normal.lengthSq()<.1)return {...result,unresolved:true};
  const axis=normal.clone().normalize(), points:THREE.Vector3[]=[];
  const stride=Math.max(1,Math.ceil(source.count/256));
  for(let i=0;i<source.count;i+=stride)points.push(new THREE.Vector3().fromBufferAttribute(source,i).applyMatrix4(matrix));
  result.samples=points.length;
  const embedded=(inset:number)=>{
    let count=0;
    for(const p of points){
      point.copy(p).addScaledVector(axis,-inset);
      const h=heightAt(point.x,point.z);
      if(!Number.isFinite(h))return NaN;
      if(point.y<=h-.035)count++;
    }
    return count/points.length;
  };
  const before=embedded(0);
  if(!Number.isFinite(before))return {...result,unresolved:true};
  result.embeddedBefore=result.embeddedAfter=before;
  // A tilted scan's bounding-box bottom alone can touch the support while most
  // of the underside hangs free. Require 32% of sampled surface vertices to be
  // embedded; this is a support estimate, not a solid-volume certificate.
  if(before>=.32)return result;
  let inset=0;
  for(let step=1;step<=12;step++){
    const amount=maxInset*step/12, fraction=embedded(amount);
    if(!Number.isFinite(fraction))return {...result,unresolved:true};
    if(fraction>result.embeddedAfter){inset=amount;result.embeddedAfter=fraction;}
    if(fraction>=.32)break;
  }
  matrix.elements[12]-=axis.x*inset;matrix.elements[13]-=axis.y*inset;matrix.elements[14]-=axis.z*inset;
  result.moved=inset;result.unresolved=result.embeddedAfter<.32;
  return result;
}
