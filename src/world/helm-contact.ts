import * as THREE from 'three';

/** Shared metre-scale wheel geometry and authored hand contact. */
export const HELM_WHEEL=Object.freeze({x:.26,y:1.065,z:.23,radius:.15,tube:.017,tilt:-.26});
export const HELM_FINGER_CURL=Object.freeze([1.02,1.10,1.06,.90]);
const tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),HELM_WHEEL.tilt);
const poses=([-1,1] as const).map(side=>{
 const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,side,0),new THREE.Vector3(0,0,1),new THREE.Vector3(side,0,0));
 const orientation=tilt.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(basis));
 // Palmar surface near the distal transverse crease, in the sculpted hand.
 const pad=new THREE.Vector3(0,-.070,-.020).applyQuaternion(orientation);
 const wrist=new THREE.Vector3(side*(HELM_WHEEL.radius+HELM_WHEEL.tube),0,0).applyQuaternion(tilt)
  .add(new THREE.Vector3(HELM_WHEEL.x,HELM_WHEEL.y,HELM_WHEEL.z)).sub(pad);
 return {wrist,orientation};
});

/** Copies the wrist's vessel-local pose; callers retain and blend their outputs. */
export function helmHandPose(side:-1|1,wrist:THREE.Vector3,orientation:THREE.Quaternion):void{
 const pose=poses[side===-1?0:1];wrist.copy(pose.wrist);orientation.copy(pose.orientation);
}
