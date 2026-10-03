import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';
import type {FoliageVariant} from './foliage.ts';
import {randomSeed} from './models/procedural.ts';

/** Geometry is already baked in source coordinates; never apply guessed node transforms. */
export function measurePlant(variant:FoliageVariant){
  const bounds=new THREE.Box3(), leaves:THREE.Vector3[]=[]; let trunk:THREE.BufferGeometry|undefined;
  for(const part of variant.parts){
    const points=part.geometry.getAttribute('position');
    bounds.union(new THREE.Box3().setFromBufferAttribute(points as THREE.BufferAttribute));
    if(part.material.userData.foliageRole==='trunk'||part.material.name.includes('bark'))trunk=part.geometry;
    else if(part.material.userData.foliageRole!=='branches') for(let i=0;i<points.count;i++)leaves.push(new THREE.Vector3().fromBufferAttribute(points,i));
  }
  const foot=new THREE.Vector3(0,bounds.min.y,0);
  if(trunk){
    const p=trunk.getAttribute('position');let min=Infinity;
    for(let i=0;i<p.count;i++)min=Math.min(min,p.getY(i));
    foot.set(0,min,0);let n=0;
    for(let i=0;i<p.count;i++)if(p.getY(i)<=min+.16){foot.x+=p.getX(i);foot.z+=p.getZ(i);n++;}
    foot.x/=Math.max(1,n);foot.z/=Math.max(1,n);
  }
  // A native lower envelope bounds support cost independently of GLB leaf tessellation.
  // Retain the actual lowest source vertex in each 0.35m cell; no proxy crown dimensions.
  const cells=new Map<string,THREE.Vector3>();
  for(const leaf of leaves){const key=`${Math.floor(leaf.x/.35)}:${Math.floor(leaf.z/.35)}`;const old=cells.get(key);if(!old||leaf.y<old.y)cells.set(key,leaf);}
  return {bounds,foot,leaves:[...cells.values()],sourceLeafVertices:leaves.length};
}

export function soilPocket(ground:GroundSampler,x:number,z:number,radius=0){
  if(Math.hypot(x+36,z-27)+radius>320||Math.hypot(x+25,z-36)<6+radius||Math.hypot(x+36,z-27)<8+radius)return false;
  // Keep the beach access corridor and the landmark approach clear.
  if(z>10-radius&&z<50+radius&&x>-66-radius&&x<10+radius)return false;
  const h=ground.heightAt(x,z);
  const slope=Math.hypot(ground.heightAt(x+1.5,z)-ground.heightAt(x-1.5,z),ground.heightAt(x,z+1.5)-ground.heightAt(x,z-1.5))/3;
  return Number.isFinite(h)&&h>7&&h<68&&slope<1.05;
}

/** Supported native leaf vertices, rooted woody plants, deterministic irregular crown clusters. */
export function crownSupportedPlacements(ground:GroundSampler,pines:FoliageVariant[],shrubs:FoliageVariant[]){
  const random=randomSeed(0x52313439),trees:THREE.Matrix4[][]=[[],[],[]],understory:THREE.Matrix4[][]=[[],[],[]];
  const measured=[pines.map(measurePlant),shrubs.map(measurePlant)];
  const diagnostics={tested:0,accepted:0,rejectedSupport:0,leafClearanceMin:Infinity,crownArea:0,sourceBounds:measured.map(list=>list.map(m=>({min:m.bounds.min.toArray(),max:m.bounds.max.toArray(),foot:m.foot.toArray(),supportSamples:m.leaves.length,sourceLeafVertices:m.sourceLeafVertices})))};
  for(let stratum=0;stratum<2;stratum++){
    const nativeWidth=measured[stratum].reduce((sum,m)=>sum+m.bounds.getSize(new THREE.Vector3()).x,0)/3;
    const pitch=Math.max(stratum===0?6:3.8,Math.min(stratum===0?11:6,nativeWidth*(stratum===0?.65:1.15)));
    for(let gz=-290;gz<280;gz+=pitch)for(let gx=-340;gx<310;gx+=pitch){
      const x=gx+(random()-.5)*pitch*.85,z=gz+(random()-.5)*pitch*.85,variant=Math.floor(random()*3),yaw=random()*Math.PI*2;
      const cluster=.55+.25*Math.sin(x*.033+Math.sin(z*.023)*2)+.2*Math.cos(z*.037-x*.015);
      if(random()>(stratum===0?.55+cluster*.4:.48+cluster*.5))continue;
      const native=measured[stratum][variant],size=stratum===0?.82+random()*.26:.9+random()*.35;
      const scale=new THREE.Vector3(size*(stratum===0?1.35:1.15),size,size*(stratum===0?1.25:1.05));
      const radius=Math.max(native.bounds.max.x-native.bounds.min.x,native.bounds.max.z-native.bounds.min.z)*Math.max(scale.x,scale.z)*.5;
      if(!soilPocket(ground,x,z,radius))continue;
      diagnostics.tested++;
      const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(),rotation,scale);
      const foot=native.foot.clone().applyMatrix4(matrix),h=ground.heightAt(x,z);
      matrix.setPosition(x-foot.x,h-foot.y,z-foot.z);
      let correction=0,minClearance=Infinity;const point=new THREE.Vector3();
      // Native lower-envelope samples; alpha-empty corners count conservatively.
      for(const leaf of native.leaves){point.copy(leaf).applyMatrix4(matrix);const pad=.5*Math.max(scale.x,scale.z);const terrain=Math.max(ground.heightAt(point.x,point.z),...[[pad,pad],[-pad,pad],[pad,-pad],[-pad,-pad]].map(([dx,dz])=>ground.heightAt(point.x+dx,point.z+dz)));if(!Number.isFinite(terrain)){correction=Infinity;break;}const clearance=point.y-terrain;minClearance=Math.min(minClearance,clearance);correction=Math.max(correction,.035-clearance);}
      // Pines cannot float their physical root; shrubs have a bounded root embed allowance.
      if(correction>(stratum===0?.08:.45)){diagnostics.rejectedSupport++;continue;}
      matrix.elements[13]+=correction;
      (stratum===0?trees:understory)[variant].push(matrix);diagnostics.accepted++;
      diagnostics.leafClearanceMin=Math.min(diagnostics.leafClearanceMin,minClearance+correction);
      if(stratum===0)diagnostics.crownArea+=Math.PI*radius*radius;
    }
  }
  const buckets=new Map<string,THREE.Box3[]>();
  trees.forEach((list,variant)=>list.forEach(matrix=>{
    const box=measured[0][variant].bounds.clone().applyMatrix4(matrix);
    for(let iz=Math.floor(box.min.z/12);iz<=Math.floor(box.max.z/12);iz++)for(let ix=Math.floor(box.min.x/12);ix<=Math.floor(box.max.x/12);ix++){
      const key=`${ix}:${iz}`;const list=buckets.get(key)??[];list.push(box);buckets.set(key,list);
    }
  }));
  let soilSamples=0,crownFootprintSamples=0;
  for(let z=-290;z<280;z+=4)for(let x=-340;x<310;x+=4)if(soilPocket(ground,x,z)){
    soilSamples++;if((buckets.get(`${Math.floor(x/12)}:${Math.floor(z/12)}`)??[]).some(b=>x>=b.min.x&&x<=b.max.x&&z>=b.min.z&&z<=b.max.z))crownFootprintSamples++;
  }
  return {trees,shrubs:understory,diagnostics:{...diagnostics,soilSamples,crownFootprintSamples,nativeBoundsFootprintCoverage:crownFootprintSamples/Math.max(1,soilSamples)}};
}
