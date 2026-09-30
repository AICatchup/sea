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
  const candidates:{x:number;z:number;y:number;gx:number;gz:number;slope:number;ix:number;iz:number}[]=[];
  for(let iz=0,z=bounds.minZ+8;z<bounds.maxZ-8;z+=6.8,iz++)for(let ix=0,x=bounds.minX+8;x<bounds.maxX-8;x+=6.8,ix++){
    const px=x+(jointRandom(ix,iz,3)-.5)*3,pz=z+(jointRandom(ix,iz,5)-.5)*3;
    const y=ground.heightAt(px,pz),g=gradient(px,pz);
    if(!Number.isFinite(y) || !Number.isFinite(g.slope) || y<2.2 || y>44 || g.slope<.65)continue;
    // Avoid crowns: the support must continue uphill for at least one scan footprint.
    if(ground.heightAt(px+g.gx/g.slope*5,pz+g.gz/g.slope*5)<y+2)continue;
    candidates.push({x:px,z:pz,y,...g,ix,iz});
  }
  // Interleave the whole coast deterministically before spending the budget, rather than
  // exhausting it on the first western row. No camera state participates.
  candidates.sort((a,b)=>jointRandom(a.ix,a.iz,91)-jointRandom(b.ix,b.iz,91));
  for(const c of candidates){
    diagnostics.eligible++;
    const role:PhotoCoastPatch['role']=c.y<7?'talus':c.slope>1.25?'scarp':'shelf';
    const pool=valid.filter(s=>s.v.kind===(role==='talus'?'boulder':'shelf'));
    if(!pool.length)continue;
    const source=pool[Math.floor(jointRandom(c.ix,c.iz,11)*pool.length)%pool.length];
    if(diagnostics.triangles+source.triangles>budget){diagnostics.rejectedBudget++;continue;}
    // Shelf scans retain their broad real topology, at 0.85–1.45 normalized physical scale.
    // Talus is kept small; it cannot become an inflated spherical mountain.
    const scale=role==='talus'?.8+jointRandom(c.ix,c.iz,17)*.5:.85+jointRandom(c.ix,c.iz,17)*.6;
    const normal=new THREE.Vector3(-c.gx,1,-c.gz).normalize();
    const tangent=new THREE.Vector3(-c.gz,0,c.gx).normalize();
    tangent.applyAxisAngle(normal,(jointRandom(c.ix,c.iz,19)-.5)*.65);
    const along=new THREE.Vector3().crossVectors(tangent,normal).normalize();
    const basis=new THREE.Matrix4().makeBasis(tangent,normal,along);
    const rotation=new THREE.Quaternion().setFromRotationMatrix(basis);
    const center=source.box.getCenter(new THREE.Vector3());
    const anchor=new THREE.Vector3(c.x,c.y,c.z);
    const matrixAt=(offset:number)=>new THREE.Matrix4().compose(anchor.clone().addScaledVector(normal,offset),rotation,new THREE.Vector3(scale,scale,scale))
      .multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
    // Search along the physical support normal for an embedded back and exposed relief.
    // This cannot guarantee exact watertight contact; diagnostics expose the residual.
    let best: {matrix:THREE.Matrix4;exposed:number;embedded:number;error:number}|undefined;
    for(let offset=-3;offset<=3;offset+=.25){
      const matrix=matrixAt(offset); let exposed=0,embedded=0,finite=true;
      for(const vertex of source.samples){const p=vertex.clone().applyMatrix4(matrix),h=ground.heightAt(p.x,p.z);
        if(!Number.isFinite(h)){finite=false;break;} if(p.y>h+.06)exposed++;else embedded++;}
      if(!finite)continue;
      const fraction=exposed/source.samples.length,error=Math.abs(fraction-.64);
      if(!best || error<best.error)best={matrix,exposed:fraction,embedded:embedded/source.samples.length,error};
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
    patches.push({variant:source.v.id,role,bounds:actualBox,exposedFraction:best.exposed,embeddedFraction:best.embedded,scale});
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
  let disposed=false;
  return {group,diagnostics,dispose(){if(disposed)return;disposed=true;
    // InstancedMesh.dispose frees instance resources only; borrowed geometry/material stay alive.
    meshes.forEach(mesh=>mesh.dispose());group.clear();}};
}
