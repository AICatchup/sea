import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';

/** Resolve the final jittered position, not the pre-jitter source height.
 * A single small holdfast is slightly embedded; this is ground support, not
 * a surveyed rock attachment or a biological distribution model. */
export function groundedPlantMatrix(ground:GroundSampler,x:number,z:number,yaw:number,scale:number,height=1):THREE.Matrix4|null{
 if(![x,z,yaw,scale,height].every(Number.isFinite)||scale<=0||height<=0)return null;
 const y=ground.heightAt(x,z);if(!Number.isFinite(y)||y>-.65||y< -24)return null;
 const size=Math.min(scale,(-.12-y)/height);
 return new THREE.Matrix4().compose(new THREE.Vector3(x,y-.018,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(size,size,size));
}
