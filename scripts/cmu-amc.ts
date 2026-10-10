import * as THREE from 'three';

/**
 * Minimal Acclaim ASF/AMC reader and forward kinematics for the CMU Graphics Lab
 * Motion Capture Database (http://mocap.cs.cmu.edu). Units stay in ASF length units;
 * callers only use directions, rotations and ratios.
 */
export interface AsfBone {name:string;direction:THREE.Vector3;length:number;axis:THREE.Euler;dof:string[];parent:string|null;children:string[]}
export interface Asf {bones:Map<string,AsfBone>;rootOrder:string[];lengthUnit:number}
export type AmcFrame = Map<string,number[]>;

const deg=THREE.MathUtils.degToRad;
/** ASF `axis ... XYZ` and AMC rotations are static x-y-z rotations: R = Rz·Ry·Rx. */
const staticXYZ=(x:number,y:number,z:number)=>new THREE.Euler(deg(x),deg(y),deg(z),'ZYX');

export function parseAsf(text:string):Asf{
  const bones=new Map<string,AsfBone>();let rootOrder:string[]=[];let lengthUnit=1;
  const lines=text.split(/\r?\n/).map(l=>l.trim());let section='';
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line||line.startsWith('#'))continue;
    if(line.startsWith(':')){section=line.split(/\s+/)[0];
      if(section===':root'||section===':units'){/* fallthrough to keyword parsing */}
      continue;}
    const words=line.split(/\s+/);
    if(section===':units'&&words[0]==='length')lengthUnit=Number(words[1]);
    if(section===':root'&&words[0]==='order')rootOrder=words.slice(1).map(w=>w.toLowerCase());
    if(section===':bonedata'&&words[0]==='begin'){
      const bone:AsfBone={name:'',direction:new THREE.Vector3(),length:0,axis:new THREE.Euler(),dof:[],parent:null,children:[]};
      for(i++;lines[i]!=='end';i++){
        const w=lines[i].split(/\s+/);
        if(w[0]==='name')bone.name=w[1];
        else if(w[0]==='direction')bone.direction.set(+w[1],+w[2],+w[3]).normalize();
        else if(w[0]==='length')bone.length=+w[1];
        else if(w[0]==='axis'){if(w[4]!=='XYZ')throw new Error(`axis order ${w[4]}`);bone.axis=staticXYZ(+w[1],+w[2],+w[3]);}
        else if(w[0]==='dof')bone.dof=w.slice(1).map(d=>d.toLowerCase());
      }
      bones.set(bone.name,bone);
    }
    if(section===':hierarchy'&&words[0]!=='begin'&&words[0]!=='end'){
      const [parent,...children]=words;
      for(const c of children){const b=bones.get(c);if(!b)throw new Error(`hierarchy ${c}`);b.parent=parent;}
      if(parent!=='root')bones.get(parent)!.children.push(...children);
    }
  }
  return {bones,rootOrder,lengthUnit};
}

export function parseAmc(text:string):AmcFrame[]{
  const frames:AmcFrame[]=[];let current:AmcFrame|null=null;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith(':'))continue;
    if(/^\d+$/.test(line)){current=new Map();frames.push(current);continue;}
    const [name,...values]=line.split(/\s+/);current!.set(name,values.map(Number));
  }
  return frames;
}

/** World rotation (frame of each bone, identity at zero DOFs) and joint end positions. */
export interface Pose {rotation:Map<string,THREE.Quaternion>;start:Map<string,THREE.Vector3>;end:Map<string,THREE.Vector3>;root:THREE.Vector3;rootRotation:THREE.Quaternion}

export function forwardKinematics(asf:Asf,frame:AmcFrame):Pose{
  const r=frame.get('root')!,order=asf.rootOrder;
  const get=(k:string)=>r[order.indexOf(k)]??0;
  const root=new THREE.Vector3(get('tx'),get('ty'),get('tz'));
  // Root axis is zero in CMU files, so C = I and the root matrix is just the rotation.
  const rootRotation=new THREE.Quaternion().setFromEuler(staticXYZ(get('rx'),get('ry'),get('rz')));
  const rotation=new Map<string,THREE.Quaternion>(),start=new Map<string,THREE.Vector3>(),end=new Map<string,THREE.Vector3>();
  const visit=(name:string,parentRotation:THREE.Quaternion,parentEnd:THREE.Vector3)=>{
    const bone=asf.bones.get(name)!,values=frame.get(name)??[];
    const e=[0,0,0];bone.dof.forEach((d,i)=>{const k=['rx','ry','rz'].indexOf(d);if(k>=0)e[k]=values[i]??0;});
    const c=new THREE.Quaternion().setFromEuler(bone.axis);
    // M = Mparent · C · R(dof) · C⁻¹
    const q=parentRotation.clone().multiply(c).multiply(new THREE.Quaternion().setFromEuler(staticXYZ(e[0],e[1],e[2]))).multiply(c.clone().invert());
    rotation.set(name,q);start.set(name,parentEnd.clone());
    const p=parentEnd.clone().addScaledVector(bone.direction.clone().applyQuaternion(q),bone.length);end.set(name,p);
    for(const child of bone.children)visit(child,q,p);
  };
  for(const bone of asf.bones.values())if(bone.parent==='root')visit(bone.name,rootRotation,root);
  return {rotation,start,end,root,rootRotation};
}
