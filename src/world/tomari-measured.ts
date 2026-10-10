import * as THREE from 'three';
import {TOMARI_SURVEY as data} from './tomari-survey.generated.ts';
import {createMeasuredGridPatch,type MeasuredGridPatch} from './measured-grid-patch.ts';
import type {IslandElevation} from './geodata.ts';

/** Survey-derived land, on a grid aligned with the existing terrain cells.
 * One triangle surface drives visible ground, feet and ocean depth. */
export class TomariMeasuredCoast {
 readonly patch:MeasuredGridPatch;
 readonly group:THREE.Group;
 readonly ready=Promise.resolve();
 readonly bounds={minX:data.origin.x,minZ:data.origin.z,maxX:data.origin.x+(data.width-1)*data.column.x,maxZ:data.origin.z+(data.height-1)*data.row.z};
 readonly diagnostics={id:data.id,sourceURL:data.sourceURL,sourceZipSha256:data.sourceZipSha256,nativeSpacingMetres:data.nativeSpacingMetres,runtimeReprojected:true,centimetreSurveyAccuracyEstablished:false};
 private readonly material:THREE.MeshStandardMaterial;
 constructor(elevation:IslandElevation,terrain:THREE.MeshStandardMaterial){
  // The original renderer uses this diagonal, so boundary subdivisions lie on
  // its existing triangles rather than opening hairline cracks at the seam.
  const fallback=(x:number,z:number)=>{
   const g=elevation.beach?.contains(x,z)?elevation.beach:elevation.coast!;
   const i=Math.floor((x-g.minX)/g.dx),j=Math.floor((z-g.minZ)/g.dz),px=g.minX+i*g.dx,pz=g.minZ+j*g.dz;
   const u=(x-px)/g.dx,v=(z-pz)/g.dz,a=elevation.heightAt(px,pz),b=elevation.heightAt(px+g.dx,pz),c=elevation.heightAt(px,pz+g.dz),d=elevation.heightAt(px+g.dx,pz+g.dz);
   return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  };
  const bytes=Uint8Array.from(atob(data.heightsCentimetres),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
  if(bytes.length!==data.width*data.height*2)throw new Error('Incomplete Tomari survey');
  const heights=new Float32Array(data.width*data.height),valid=new Uint8Array(heights.length);
  for(let j=0;j<data.height;j++)for(let i=0;i<data.width;i++){
   const k=j*data.width+i,value=view.getInt16(k*2,true),x=data.origin.x+i*data.column.x,z=data.origin.z+j*data.row.z;
   if(value===-32768)continue;
   const y=value*.01,old=fallback(x,z);
   // Retain the inferred bed only where the new survey is low/wet. The older
   // authored beach cannot veto measured dry rock: doing so carved a false
   // strand through the cliff's measured foot and created a vertical step.
   const blend=THREE.MathUtils.smoothstep(y,.3,2.0);
   heights[k]=old+(y-old)*blend;valid[k]=1;
  }
  this.material=terrain.clone();this.material.vertexColors=false;
  this.material.onBeforeCompile=terrain.onBeforeCompile;
  this.material.customProgramCacheKey=terrain.customProgramCacheKey;
  this.patch=createMeasuredGridPatch({...data,heights,valid},{heightAt:fallback},this.material,{blendStartMetres:1,blendEndMetres:12,cutInsetMetres:0});
  this.group=this.patch.group;this.group.name='Tomari western 25cm survey-derived coast';
  this.group.userData.tomariSurvey=this.diagnostics;
  this.group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
 }
 contains(x:number,z:number):boolean {const b=this.bounds;return x>=b.minX-1e-7&&x<=b.maxX+1e-7&&z>=b.minZ-1e-7&&z<=b.maxZ+1e-7;}
 heightAt(x:number,z:number):number|null{
  if(!this.contains(x,z))return null;
  // Render coordinates are Float32 relative to the shared origin. Snap only
  // the micrometre-wide outer rounding strip onto that actual boundary.
  const b=this.bounds;
  return this.patch.surfaceHeightAt(THREE.MathUtils.clamp(x,b.minX,b.minX+Math.fround(b.maxX-b.minX)),THREE.MathUtils.clamp(z,b.minZ,b.minZ+Math.fround(b.maxZ-b.minZ)));
 }
 dispose():void{this.patch.dispose();this.material.dispose();}
}
