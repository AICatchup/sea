import * as THREE from 'three';
import {MeshSurfaceSampler} from 'three/addons/math/MeshSurfaceSampler.js';
import type {GroundSampler} from './contracts.ts';
import {randomSeed} from './models/procedural.ts';

/** Face-area sampling keeps steep cliffs from becoming sparse like an XZ grid.
 * Plant identity and locations remain inferred from reference photographs. */
export function tomariCliffCover(ground:Pick<GroundSampler,'heightAt'>,surface?:THREE.Object3D){
 const placements:THREE.Matrix4[][]=[[],[],[]],trees:THREE.Matrix4[][]=[[],[],[]],random=randomSeed(0x54435858);
 if(!surface)return {placements,trees,count:0,projected:0};
 surface.updateWorldMatrix(true,true);
 const meshes:THREE.Mesh[]=[];surface.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
 const occupied=new Map<string,THREE.Vector3[]>(),cell=1.7;
 const key=(x:number,y:number,z:number)=>[x,y,z].join(',');
 const clear=(p:THREE.Vector3)=>{
  const ix=Math.floor(p.x/cell),iy=Math.floor(p.y/cell),iz=Math.floor(p.z/cell);
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const other of occupied.get(key(ix+x,iy+y,iz+z))??[])if(other.distanceToSquared(p)<cell*cell)return false;
  const k=key(ix,iy,iz);if(!occupied.has(k))occupied.set(k,[]);occupied.get(k)!.push(p.clone());return true;
 };
 let count=0;
 for(const mesh of meshes){
  // r186 implements this seeded hook; its companion type declaration omits it.
  const sampler=new MeshSurfaceSampler(mesh) as MeshSurfaceSampler&{setRandomGenerator(fn:()=>number):MeshSurfaceSampler};
  sampler.setRandomGenerator(random).build();
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),p=new THREE.Vector3(),n=new THREE.Vector3();
  for(let attempt=0;attempt<16000&&count<320;attempt++){
   sampler.sample(p,n);p.applyMatrix4(mesh.matrixWorld);n.applyNormalMatrix(normalMatrix);
   if(![p.x,p.y,p.z,n.x,n.y,n.z].every(Number.isFinite)||p.y<9||p.y>48||n.x<.20||n.y<-.25)continue;
   if(ground.heightAt(p.x,p.z)>p.y+.16)continue;
   const patch=.55+.22*Math.sin(p.z*.11+p.y*.07)+.20*Math.cos(p.z*.23-p.y*.17);
   if(random()>THREE.MathUtils.smoothstep(p.y,9,18)*THREE.MathUtils.clamp(patch,.15,.95)||!clear(p))continue;
   const direction=n.clone();direction.y=Math.max(direction.y,Math.hypot(direction.x,direction.z)/Math.tan(50*Math.PI/180));direction.normalize();
   const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*Math.PI*2));
   const scale=new THREE.Vector3(1.6+random()*.9,1.0+random()*.65,1.5+random()*.9);
   const variant=Math.floor(random()*3),root=p.clone().addScaledVector(n,-.025);
   if(random()<.28){
    // A small woody canopy retains the source's dense branching, unlike sparse
    // ground scrub. Upright stems use the existing vertical trunk collision contract.
    const size=.32+random()*.15;trees[variant].push(new THREE.Matrix4().compose(root,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*Math.PI*2),new THREE.Vector3(size,size,size)));
   }else placements[variant].push(new THREE.Matrix4().compose(root,orientation,scale));count++;
  }
 }
 return {placements,trees,count,projected:count};
}
