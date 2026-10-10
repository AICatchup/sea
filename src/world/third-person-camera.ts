import * as THREE from 'three';

export type ViewMode='first'|'third';
interface PoseInput {
  /** The first-person eye the body and gameplay already use. */
  eye:THREE.Vector3;yaw:number;pitch:number;mode:'walk'|'swim'|'dive'|'boat';
  heightAt:(x:number,z:number)=>number;waterAt:(x:number,z:number)=>number;
  /** Optional solids (scanned cliffs, rocks, boat): first-hit fraction along pivot→lens. */
  blocked?:(from:THREE.Vector3,to:THREE.Vector3)=>number;
}
/** Over-the-shoulder follow camera. Distances in metres; the boat uses a wider frame. */
export const THIRD_PERSON={walk:{distance:3.3,lift:.38,shoulder:.42},water:{distance:2.9,lift:.3,shoulder:.32},boat:{distance:8.5,lift:1.6,shoulder:0},
  /** Clearance kept above ground and away from the moving water interface. */
  ground:.35,surface:.28,samples:20} as const;

/** Largest fraction of the eye→camera segment that stays above ground (heightfield march). */
export function unobstructedFraction(from:THREE.Vector3,to:THREE.Vector3,heightAt:(x:number,z:number)=>number,clearance:number,samples:number):number{
  for(let i=1;i<=samples;i++){
    const t=i/samples,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,z=from.z+(to.z-from.z)*t;
    if(y<heightAt(x,z)+clearance)return Math.max(0,(i-1)/samples);
  }
  return 1;
}

/** Writes the desired camera position and aim point; pure apart from the outputs. */
export function thirdPersonPose(input:PoseInput,position:THREE.Vector3,aim:THREE.Vector3,maxDistance=Infinity):number{
  const {eye,yaw,pitch,mode}=input,frame=mode==='boat'?THIRD_PERSON.boat:mode==='walk'?THIRD_PERSON.walk:THIRD_PERSON.water;
  const cp=Math.cos(pitch),forward=new THREE.Vector3(Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp);
  const right=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
  const pivot=eye.clone().addScaledVector(right,frame.shoulder).add(new THREE.Vector3(0,frame.lift,0));
  const wanted=Math.min(frame.distance,maxDistance);
  position.copy(pivot).addScaledVector(forward,-wanted);
  const terrain=unobstructedFraction(pivot,position,input.heightAt,THIRD_PERSON.ground,THIRD_PERSON.samples);
  // Stop short of a solid by a lens clearance so the near plane cannot cut into it.
  const solid=input.blocked?input.blocked(pivot,position):1;
  const distance=Math.max(0,Math.min(wanted*terrain,solid<1?wanted*solid-THIRD_PERSON.ground:Infinity));
  position.copy(pivot).addScaledVector(forward,-distance);
  position.y=Math.max(position.y,input.heightAt(position.x,position.z)+THIRD_PERSON.ground);
  // A lens straddling the waterline shows a split frame; stay on the player's side of it.
  const water=input.waterAt(position.x,position.z);
  if(mode==='dive')position.y=Math.min(position.y,water-THIRD_PERSON.surface);
  else position.y=Math.max(position.y,water+THIRD_PERSON.surface);
  aim.copy(eye).addScaledVector(forward,8).addScaledVector(right,frame.shoulder);
  return distance;
}

/** Fraction along from→to where the segment enters an oriented box (1 when it never does).
 * `inverse` maps world into the box's local frame. Used for the vessel, which is not a
 * registered world solid. */
export function segmentBoxFraction(from:THREE.Vector3,to:THREE.Vector3,box:THREE.Box3,inverse:THREE.Matrix4):number{
  const a=from.clone().applyMatrix4(inverse),b=to.clone().applyMatrix4(inverse),d=b.sub(a);
  let t0=0,t1=1;
  for(const axis of ['x','y','z'] as const){
    if(Math.abs(d[axis])<1e-12){if(a[axis]<box.min[axis]||a[axis]>box.max[axis])return 1;continue;}
    let n=(box.min[axis]-a[axis])/d[axis],f=(box.max[axis]-a[axis])/d[axis];if(n>f)[n,f]=[f,n];
    t0=Math.max(t0,n);t1=Math.min(t1,f);if(t0>t1)return 1;
  }
  // Starting inside (on deck) means the lens may leave through the far side freely.
  return t0===0?1:t0;
}

/** Smooths distance: pulls in at once when blocked, eases back out when clear. */
export class ThirdPersonCamera {
  mode:ViewMode='first';
  private distance=0;
  private readonly position=new THREE.Vector3();
  private readonly aim=new THREE.Vector3();
  toggle():ViewMode{this.mode=this.mode==='first'?'third':'first';this.distance=0;return this.mode;}
  apply(camera:THREE.PerspectiveCamera,input:PoseInput,delta:number):void{
    if(this.mode!=='third')return;
    const target=thirdPersonPose(input,this.position,this.aim);
    this.distance=target<this.distance?target:this.distance+(target-this.distance)*(1-Math.exp(-Math.max(0,delta)*4));
    thirdPersonPose(input,this.position,this.aim,this.distance);
    camera.position.copy(this.position);camera.lookAt(this.aim);camera.updateMatrixWorld();
  }
}
