import * as THREE from 'three';
import type {FoliageLevels} from '../../src/world/foliage.ts';
export function levels(distant=true):FoliageLevels {
  const make=(band:number)=>Array.from({length:3},(_,v)=>({parts:Array.from({length:3},(_,p)=>{const geometry=new THREE.BoxGeometry(2+v,4+band,2+p);geometry.computeBoundingBox();const material=new THREE.MeshStandardMaterial();material.userData.branchClusters=p===2;return {geometry,material};}),triangles:108-band*24}));
  return {near:make(0),mid:make(1),far:make(2),...(distant?{distant:make(3)}:{})};
}
export function placements(n:number){const lists:THREE.Matrix4[][]=[[],[],[]];for(let i=0;i<n;i++)lists[i%3].push(new THREE.Matrix4().compose(new THREE.Vector3((i%101-50)*7,0,(Math.floor(i/101)%101-50)*7),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),i*.17),new THREE.Vector3(1+i%4*.1,1+i%7*.1,1)));return lists;}
export function snapshot(group:THREE.Group){return {diagnostics:structuredClone(group.userData),meshes:group.children.map(o=>{const m=o as THREE.InstancedMesh;return {name:m.name,count:m.count,visible:m.visible,castShadow:m.castShadow,receiveShadow:m.receiveShadow,geometry:m.geometry.uuid,material:(m.material as THREE.Material).uuid,matrices:Array.from(m.instanceMatrix.array.slice(0,m.count*16)),box:m.boundingBox?{min:m.boundingBox.min.toArray(),max:m.boundingBox.max.toArray()}:null,sphere:m.boundingSphere?{center:m.boundingSphere.center.toArray(),radius:m.boundingSphere.radius}:null};})};}

