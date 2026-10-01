import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import type { ScannedRockVariant } from './scanned-rocks.ts';
import { sandAt } from './geodata.ts';
import { jointRandom } from './coast-structure.ts';

export interface PhotoCoastOptions {
  bounds?: { minX:number;maxX:number;minZ:number;maxZ:number };
  triangleBudget?: number;
}
export interface PhotoCoastPatch {
  variant:string; role:'scarp'|'shelf'|'talus'; bounds:THREE.Box3;
  /** Sampled actual scan vertices; this is an occupancy estimate, not a watertight certificate. */
  exposedFraction:number; embeddedFraction:number; scale:number;
  physicalSpan:number; priority:boolean; family:'broad-shelf'|'raised-shelf'|'joint-body'|'talus';
  /** Vertical signed residuals of actual sampled vertices against the support. */
  supportDepth:number; exposedRelief:number; fractureBand:number;
  projectedSurfaceAreas:number[];
}

/** Rigid CC0 scan assembly. No source UV, normals, topology or materials are changed.
 * These are Poly Haven scans placed on a Tomari support field, NOT surveyed Tomari rock.
 * The caller owns the support field and must register this group's actual meshes for collision.
 */
export function buildPhotoCoastPresentation(
  ground:GroundSampler, variants:readonly ScannedRockVariant[], options:PhotoCoastOptions={},
) {
  const group=new THREE.Group(); group.name='CC0 scan coast presentation (authored placement)';
  const patches:PhotoCoastPatch[]=[], meshes:THREE.InstancedMesh[]=[];
  const diagnostics={provenance:'Poly Haven CC0 scans; authored Tomari placement; not measured Tomari photogrammetry',
    triangles:0,draws:0,instances:0,textureAdditions:0,eligible:0,rejectedSupport:0,rejectedStrand:0,
    rejectedOverlap:0,rejectedBudget:0,invalidVariants:0,patches,bounds:new THREE.Box3(),
    priorityInstances:0,priorityFacingSupportArea:0,priorityFacingPatchArea:0,priorityFacingCoverageEstimate:0,
    // Geometry area facing three fixed coastal viewpoints, without occlusion.
    // Sparse triangle quadrature is an estimate, never image coverage evidence.
    priorityProjectedSurfaceAreas:[0,0,0],instanceBudget:96,
    families:{'broad-shelf':0,'raised-shelf':0,'joint-body':0,talus:0},
    roles:{scarp:0,shelf:0,talus:0},sourceBounds:[] as {id:string;bounds:THREE.Box3;normalizedMetres:THREE.Vector3;originalDimensions:THREE.Vector3}[]};
  group.userData.photoCoast=diagnostics;
  const bounds=options.bounds??{minX:-255,maxX:225,minZ:-190,maxZ:45};
  const requestedBudget=options.triangleBudget??1_500_000;
  const budget=Number.isFinite(requestedBudget)?Math.min(1_500_000,Math.max(0,requestedBudget)):0;
  if(!Object.values(bounds).every(Number.isFinite) || bounds.maxX<=bounds.minX || bounds.maxZ<=bounds.minZ ||
    bounds.maxX-bounds.minX>2000 || bounds.maxZ-bounds.minZ>2000){
    return {group,diagnostics,dispose(){group.clear();}};
  }
  const valid=variants.slice(0,10).flatMap(v=>{
    const p=v.geometry.getAttribute('position');
    // Work on a local box: computing a borrowed geometry's boundingBox would mutate it.
    const box=new THREE.Box3();
    const triangles=(v.geometry.index?.count??p?.count??0)/3;
    if(!p || p.itemSize!==3 || p.count<3 || !Number.isInteger(triangles) || triangles<=0){diagnostics.invalidVariants++;return [];}
    for(let i=0;i<p.count;i++)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,i));
    const size=box.getSize(new THREE.Vector3());
    if(![box.min.x,box.max.x,box.min.y,box.max.y,box.min.z,box.max.z].every(Number.isFinite) || Math.min(size.x,size.y,size.z)<.001){diagnostics.invalidVariants++;return [];}
    const samples:THREE.Vector3[]=[];
    const step=Math.max(1,Math.ceil(p.count/160));
    for(let i=0;i<p.count;i+=step)samples.push(new THREE.Vector3().fromBufferAttribute(p,i));
    diagnostics.sourceBounds.push({id:v.id,bounds:box.clone(),normalizedMetres:size.clone(),originalDimensions:v.nativeDimensions.clone()});
    return [{v,box,size,samples,triangles,matrices:[] as THREE.Matrix4[]}];
  });
  const gradient=(x:number,z:number)=>{
    const gx=(ground.heightAt(x+2,z)-ground.heightAt(x-2,z))/4;
    const gz=(ground.heightAt(x,z+2)-ground.heightAt(x,z-2))/4;
    return {gx,gz,slope:Math.hypot(gx,gz)};
  };
  const candidates:{x:number;z:number;y:number;gx:number;gz:number;slope:number;ix:number;iz:number;priority:boolean}[]=[];
  const priorityAt=(x:number,z:number)=>x>=-160&&x<=-85&&z>=-95&&z<=15;
  const referenceCamera=new THREE.Vector3(-86,ground.heightAt(-86,-22)+1.64,-22);
  const coverageViews=[referenceCamera,new THREE.Vector3(-78,ground.heightAt(-78,-55)+1.64,-55),new THREE.Vector3(-92,ground.heightAt(-92,4)+1.64,4)];
  for(const region of [{...bounds,stride:6.8,priority:false},{minX:-160,maxX:-85,minZ:-95,maxZ:15,stride:2.8,priority:true}]){
  for(let iz=0,z=region.minZ+3;z<region.maxZ-3;z+=region.stride,iz++)for(let ix=0,x=region.minX+3;x<region.maxX-3;x+=region.stride,ix++){
    if(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ || (!region.priority&&priorityAt(x,z)))continue;
    const px=x+(jointRandom(ix,iz,3)-.5)*region.stride*.35,pz=z+(jointRandom(ix,iz,5)-.5)*region.stride*.35;
    const y=ground.heightAt(px,pz),g=gradient(px,pz);
    if(!Number.isFinite(y) || !Number.isFinite(g.slope) || y<2.2 || y>44 || g.slope<.65)continue;
    // Avoid crowns: the support must continue uphill for at least one scan footprint.
    if(ground.heightAt(px+g.gx/g.slope*5,pz+g.gz/g.slope*5)<y+2)continue;
    candidates.push({x:px,z:pz,y,...g,ix,iz,priority:region.priority});
    if(region.priority){const normal=new THREE.Vector3(-g.gx,1,-g.gz).normalize();
      const facing=Math.max(0,normal.dot(referenceCamera.clone().sub(new THREE.Vector3(px,y,pz)).normalize()));
      diagnostics.priorityFacingSupportArea+=region.stride**2*Math.hypot(1,g.slope)*facing;}
  }}
  // Prioritize the geographically bounded west scarp, reserving 22% for the
  // other coasts. No current camera state participates in placement.
  const coveFacing=(c:typeof candidates[number])=>{
    const dx=-58-c.x,dz=-25-c.z;
    return (-c.gx*dx-c.gz*dz)/(Math.max(.001,Math.hypot(dx,dz))*Math.hypot(1,c.slope));
  };
  // Geographic cove-facing priority, independent of the current render camera.
  candidates.sort((a,b)=>Number(b.priority)-Number(a.priority)||(a.priority&&b.priority?
    Math.floor(coveFacing(b)*4)-Math.floor(coveFacing(a)*4):0)||jointRandom(a.ix,a.iz,91)-jointRandom(b.ix,b.iz,91));
  let priorityTriangles=0;
  for(const c of candidates){
    diagnostics.eligible++;
    if(patches.length>=diagnostics.instanceBudget){diagnostics.rejectedBudget++;continue;}
    const role:PhotoCoastPatch['role']=c.y<7?'talus':c.slope>1.25?'scarp':'shelf';
    // Shared metre-scale strata, with thick joint bodies between ledges. A shelf
    // scan is only 0.44–0.91 m thick over 8 m; repeating it as the entire scarp
    // cannot supply geological mass. Use intact volumetric scans for that role.
    const fractureBand=Math.floor((c.y+.055*c.z)/3.6);
    const bandPhase=((c.y+.055*c.z)/3.6-fractureBand);
    const family:PhotoCoastPatch['family']=role==='talus'?'talus':
      role==='scarp'&&bandPhase>.3?'joint-body':bandPhase<.15?'raised-shelf':'broad-shelf';
    const pool=valid.filter(s=>s.v.kind===(family==='talus'||family==='joint-body'?'boulder':'shelf'));
    if(!pool.length)continue;
    // Raised ledges use the thickest available shelf without changing its shape.
    const source=family==='raised-shelf'?pool.reduce((a,b)=>b.size.y/Math.max(b.size.x,b.size.z)>a.size.y/Math.max(a.size.x,a.size.z)?b:a):
      pool[Math.floor(jointRandom(c.ix,c.iz,11)*pool.length)%pool.length];
    if(diagnostics.triangles+source.triangles>budget){diagnostics.rejectedBudget++;continue;}
    if(c.priority&&priorityTriangles+source.triangles>budget*.78){diagnostics.rejectedBudget++;continue;}
    // Derive scale from actual normalized geometry extents, not original GLB dimensions.
    // Broad/raised shelves and distinct joint bodies form a bounded 4–10 m hierarchy.
    const targetSpan=family==='talus'?1.6+jointRandom(c.ix,c.iz,17)*1.6:
      family==='joint-body'?5.6+jointRandom(c.ix,c.iz,17)*2.4:family==='raised-shelf'?6+jointRandom(c.ix,c.iz,17)*2:8+jointRandom(c.ix,c.iz,17)*2;
    const scale=targetSpan/Math.max(source.size.x,source.size.z);
    const normal=new THREE.Vector3(-c.gx,1,-c.gz).normalize();
    const tangent=new THREE.Vector3(-c.gz,0,c.gx).normalize();
    tangent.applyAxisAngle(normal,(jointRandom(fractureBand,0,19)-.5)*.18+(jointRandom(c.ix,c.iz,19)-.5)*.08);
    const along=new THREE.Vector3().crossVectors(tangent,normal).normalize();
    // A raised shelf uses the intact scan's broad face at an oblique dip, giving
    // actual metre-scale thickness/steps rather than a flat skin on a noisy DEM.
    const dip=family==='raised-shelf'?.20+jointRandom(fractureBand,0,31)*.12:family==='joint-body'?(jointRandom(fractureBand,0,31)-.5)*.28:0;
    normal.applyAxisAngle(tangent,dip);along.applyAxisAngle(tangent,dip);
    const basis=new THREE.Matrix4().makeBasis(tangent,normal,along);
    const rotation=new THREE.Quaternion().setFromRotationMatrix(basis);
    const center=source.box.getCenter(new THREE.Vector3());
    const anchor=new THREE.Vector3(c.x,c.y,c.z);
    const matrixAt=(offset:number)=>new THREE.Matrix4().compose(anchor.clone().addScaledVector(normal,offset),rotation,new THREE.Vector3(scale,scale,scale))
      .multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
    // Search along the physical support normal for an embedded back and exposed relief.
    // This cannot guarantee exact watertight contact; diagnostics expose the residual.
    let best: {matrix:THREE.Matrix4;exposed:number;embedded:number;error:number;depth:number;relief:number}|undefined;
    for(let offset=-5;offset<=5;offset+=.25){
      const matrix=matrixAt(offset); let exposed=0,embedded=0,finite=true,depth=0,relief=0;
      for(const vertex of source.samples){const p=vertex.clone().applyMatrix4(matrix),h=ground.heightAt(p.x,p.z);
        if(!Number.isFinite(h)){finite=false;break;} depth=Math.max(depth,h-p.y);relief=Math.max(relief,p.y-h);if(p.y>h+.06)exposed++;else embedded++;}
      if(!finite)continue;
      const fraction=exposed/source.samples.length,error=Math.abs(fraction-(family==='joint-body'?.52:.59));
      if(depth<.25||relief<.15)continue;
      if(!best || error<best.error)best={matrix,exposed:fraction,embedded:embedded/source.samples.length,error,depth,relief};
    }
    if(!best || best.exposed<.38 || best.embedded<.12){diagnostics.rejectedSupport++;continue;}
    const actualBox=source.box.clone().applyMatrix4(best.matrix);
    // Conservative CPU strand guard on actual transformed source vertices, plus AABB corners.
    let strand=false;
    const guard=(p:THREE.Vector3)=>p.y<2 || (p.y<9 && sandAt(p.x,p.z)>.48);
    const sourcePositions=source.v.geometry.getAttribute('position'),vertex=new THREE.Vector3();
    for(let i=0;i<sourcePositions.count;i++)if(guard(vertex.fromBufferAttribute(sourcePositions,i).applyMatrix4(best.matrix))){strand=true;break;}
    for(const x of [actualBox.min.x,actualBox.max.x])for(const z of [actualBox.min.z,actualBox.max.z])
      if(guard(new THREE.Vector3(x,actualBox.min.y,z)))strand=true;
    if(strand){diagnostics.rejectedStrand++;continue;}
    // Reject near-total duplicate occupancy, allow limited joints/embedded overlaps.
    const volume=(b:THREE.Box3)=>{const s=b.getSize(new THREE.Vector3());return s.x*s.y*s.z;};
    if(patches.some(p=>volume(p.bounds.clone().intersect(actualBox))/Math.min(volume(p.bounds),volume(actualBox))>.58)){
      diagnostics.rejectedOverlap++;continue;
    }
    source.matrices.push(best.matrix);
    const projectedSurfaceAreas=[0,0,0];
    const index=source.v.geometry.index;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),v=new THREE.Vector3(),centroid=new THREE.Vector3(),areaNormal=new THREE.Vector3();
    const triangleStep=Math.max(1,Math.ceil(source.triangles/256));
    for(let i=0;i<source.triangles;i+=triangleStep){
      a.fromBufferAttribute(sourcePositions,index?index.getX(i*3):i*3).applyMatrix4(best.matrix);
      b.fromBufferAttribute(sourcePositions,index?index.getX(i*3+1):i*3+1).applyMatrix4(best.matrix);
      v.fromBufferAttribute(sourcePositions,index?index.getX(i*3+2):i*3+2).applyMatrix4(best.matrix);
      centroid.copy(a).add(b).add(v).multiplyScalar(1/3);
      if(centroid.y<=ground.heightAt(centroid.x,centroid.z)+.06)continue;
      areaNormal.crossVectors(b.sub(a),v.sub(a)).multiplyScalar(.5*Math.min(triangleStep,source.triangles-i));
      coverageViews.forEach((camera,j)=>projectedSurfaceAreas[j]+=Math.max(0,areaNormal.dot(camera.clone().sub(centroid).normalize())));
    }
    patches.push({variant:source.v.id,role,bounds:actualBox,exposedFraction:best.exposed,embeddedFraction:best.embedded,scale,
      physicalSpan:targetSpan,priority:c.priority,family,supportDepth:best.depth,exposedRelief:best.relief,fractureBand,projectedSurfaceAreas});
    diagnostics.families[family]++;
    if(c.priority){priorityTriangles+=source.triangles;diagnostics.priorityInstances++;
      projectedSurfaceAreas.forEach((area,i)=>diagnostics.priorityProjectedSurfaceAreas[i]+=area);
      const facing=Math.max(0,normal.dot(referenceCamera.clone().sub(anchor).normalize()));
      // A conservative projected rectangle times sampled exposure, capped by support
      // area below. This is an area estimate; it does not prove pixel coverage/occlusion.
      diagnostics.priorityFacingPatchArea+=source.size.x*source.size.z*scale**2*best.exposed*facing;}
    diagnostics.bounds.union(actualBox);diagnostics.triangles+=source.triangles;diagnostics.roles[role]++;
  }
  for(const source of valid){
    if(!source.matrices.length)continue;
    const mesh=new THREE.InstancedMesh(source.v.geometry,source.v.material,source.matrices.length);
    mesh.name=`fixed coast scan ${source.v.id}`;mesh.receiveShadow=true;
    mesh.userData.photoCoastSource=source.v.id;mesh.userData.borrowedGeometry=true;
    source.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
    meshes.push(mesh);group.add(mesh);
  }
  diagnostics.instances=patches.length;diagnostics.draws=meshes.length;
  diagnostics.priorityFacingCoverageEstimate=Math.min(1,diagnostics.priorityFacingPatchArea/Math.max(1,diagnostics.priorityFacingSupportArea));
  let disposed=false;
  return {group,diagnostics,dispose(){if(disposed)return;disposed=true;
    // InstancedMesh.dispose frees instance resources only; borrowed geometry/material stay alive.
    meshes.forEach(mesh=>mesh.dispose());group.clear();}};
}
