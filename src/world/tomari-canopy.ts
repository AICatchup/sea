import * as THREE from 'three';
import {TOMARI_CANOPY as data} from './tomari-canopy.generated.ts';
import {measurePlant} from './crown-support.ts';
import type {GroundSampler} from './contracts.ts';
import type {FoliageLevels} from './foliage.ts';
import {randomSeed} from './models/procedural.ts';

export function withinSurveyCanopy(x:number,z:number):boolean{const b=data.bounds;return x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ;}
/** Real point colours/height constrain clump envelopes. Identity, stem location,
 * orientation and within-envelope foliage remain inferred CC0 models. */
export function surveyCanopyPlacements(ground:Pick<GroundSampler,'heightAt'>,source:FoliageLevels){
 // Use the source's three-dimensional leaves and wood, excluding supplementary atlas cards.
 const levels=Object.fromEntries(['near','mid','far'].map(level=>[level,source[level as 'near'|'mid'|'far'].map(v=>{
  const parts=v.parts.filter(p=>p.material.userData.branchClusters!==true);
  return{parts,triangles:parts.reduce((sum,p)=>sum+(p.geometry.index?.count??p.geometry.getAttribute('position').count)/3,0)};
 })])) as unknown as FoliageLevels;
 const native=levels.near.map(measurePlant),matrices:THREE.Matrix4[][]=[[],[],[]],random=randomSeed(0x54535959);
 let rejected=0;
 const occupied:{x:number;z:number;radius:number}[]=[];
 // Tall canopy observations claim their natural footprint first. A raster bin
 // is not an individual narrow tree; stretching each bin produced an orchard.
 for(const [x,z,top] of [...data.plants].sort((a,b)=>(b[2]-b[3])-(a[2]-a[3]))){
  const floor=ground.heightAt(x,z),height=top-floor;
  if(!Number.isFinite(floor)||floor<6||height<1||height>12){rejected++;continue;}
  const variant=Math.floor(random()*native.length),shape=native[variant],size=shape.bounds.getSize(new THREE.Vector3());
  const factor=height/(shape.bounds.max.y-shape.foot.y),scale=new THREE.Vector3(factor,factor,factor);
  const radius=Math.max(size.x,size.z)*factor*.5;
  if(occupied.some(p=>Math.hypot(x-p.x,z-p.z)<Math.min(radius,p.radius)*.8)){rejected++;continue;}
  occupied.push({x,z,radius});
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*Math.PI*2),scale);
  const foot=shape.foot.clone().applyMatrix4(matrix);matrix.setPosition(x-foot.x,floor-foot.y-.02,z-foot.z);
  matrices[variant].push(matrix);
 }
 return{levels,matrices,diagnostics:{source:data.source,sourceZipSha256:data.sourceZipSha256,sourcePoints:data.points,inferredClumps:data.count,accepted:matrices.flat().length,rejected,speciesVerified:false,stemPositionsMeasured:false}};
}
