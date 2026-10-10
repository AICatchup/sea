/**
 * Bakes looping gait clips from the CMU Graphics Lab Motion Capture Database onto the
 * FirstPersonBody skeleton.
 *
 *   node --experimental-strip-types scripts/bake-cmu-mocap.ts <folder with 35.asf, 35_*.amc, 126.asf, 126_*.amc>
 *
 * Retargeting is rotation transfer: every CMU bone frame is identity at zero DOFs (its
 * T-pose), so a game bone's body-space orientation is  B·W(t)·B⁻¹·Q0, where B turns the
 * CMU axes (+X left, +Z forward) into the game's (+X right, -Z forward) and Q0 swings the
 * game rest direction onto the CMU rest direction. Only rotations move across; the game
 * keeps its own bone lengths. Steady-state cycles are cut at a repeatable event (left foot
 * furthest forward, or both hands furthest ahead in the stroke), resampled, averaged and
 * closed into a seamless loop.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {parseAsf,parseAmc,forwardKinematics,type Asf,type Pose} from './cmu-amc.ts';
import {FirstPersonBody} from '../src/world/player-body.ts';
import {boneKey} from '../src/world/makehuman-body.ts';
import {MOCAP_BONES,type MocapClipName} from '../src/world/mocap-gait.ts';

const source=process.argv[2]??'F:/sea-mocap/cmu';
const out=new URL('../src/assets/player/cmu-mocap-v65/',import.meta.url);

// Game bone key -> CMU bone whose world rotation drives it.
const CMU_OF:Record<string,string>={
  'pelvis@C':'root','lumbar@C':'upperback','chest@C':'thorax',
  'left shoulder@L':'lhumerus','left elbow@L':'lradius','left wrist@L':'lhand',
  'right shoulder@R':'rhumerus','right elbow@R':'rradius','right wrist@R':'rhand',
  'left hip@L':'lfemur','left knee@L':'ltibia','left ankle@L':'lfoot',
  'right hip@R':'rfemur','right knee@R':'rtibia','right ankle@R':'rfoot',
};
interface ClipSpec{name:MocapClipName;subject:string;trials:string[];event:'leftFoot'|'hands';samples:number;frame:'heading'|'mean'}
const CLIPS:ClipSpec[]=[
  {name:'walk',subject:'35',trials:['35_01','35_02','35_03','35_04','35_05','35_06','35_07','35_08'],event:'leftFoot',samples:40,frame:'heading'},
  {name:'run',subject:'35',trials:['35_17','35_18','35_19','35_20','35_21','35_22','35_23','35_24'],event:'leftFoot',samples:32,frame:'heading'},
  {name:'swim',subject:'126',trials:['126_03','126_04','126_05'],event:'hands',samples:48,frame:'mean'},
];

const B=new THREE.Quaternion(0,1,0,0);// rotation by π about Y: (x,y,z) -> (-x,y,-z)
const Binv=B.clone().invert();
const toGame=(v:THREE.Vector3)=>v.clone().applyQuaternion(B);

// Game skeleton: rest directions and parents (rest bone rotations are identity).
const body=new FirstPersonBody();
const bones:THREE.Bone[]=[];body.group.traverse(o=>{if((o as THREE.Bone).isBone)bones.push(o as THREE.Bone);});
const byKey=new Map(bones.map(b=>[boneKey(b),b]));
const rest=(key:string)=>(byKey.get(key)!.userData.restPoint as THREE.Vector3).clone();
const childOf:Record<string,string>={'pelvis@C':'lumbar@C','lumbar@C':'chest@C','chest@C':'neck@C'};
const restDirection=(key:string):THREE.Vector3=>{
  const side=key.endsWith('@L')?'left':'right',s=key.endsWith('@L')?'L':'R';
  if(childOf[key])return rest(childOf[key]).sub(rest(key)).normalize();
  if(key.includes('shoulder'))return rest(`${side} elbow@${s}`).sub(rest(key)).normalize();
  if(key.includes('elbow'))return rest(`${side} wrist@${s}`).sub(rest(key)).normalize();
  if(key.includes('wrist'))return new THREE.Vector3(0,-1,-.12).normalize();
  if(key.includes('hip'))return rest(`${side} knee@${s}`).sub(rest(key)).normalize();
  if(key.includes('knee'))return rest(`${side} ankle@${s}`).sub(rest(key)).normalize();
  if(key.includes('ankle'))return new THREE.Vector3(0,-.067,-.14).normalize();// ankle to ball of the boot
  throw new Error(key);
};
const parentKey=(key:string)=>{const p=byKey.get(key)!.parent as THREE.Bone;return p?.isBone?boneKey(p):null;};
for(const key of MOCAP_BONES)if(!CMU_OF[key]||!byKey.has(key))throw new Error(`unmapped ${key}`);

const frameOf2=(primary:THREE.Vector3,secondary:THREE.Vector3)=>{
  const x=primary.clone().normalize(),y=secondary.clone().addScaledVector(x,-secondary.dot(x)).normalize(),z=x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
};
/** Rest alignment Q0 (game rest frame -> CMU rest frame). Arm bones also match the thumb
 * side: the CMU T-pose has palms down (thumbs forward), the game rest has palms forward,
 * so a pure swing would leave the forearm and hand supinated by 90°. */
function swingAt(asf:Asf,key:string):THREE.Quaternion{
  if(key==='pelvis@C')return new THREE.Quaternion();
  const cmu=toGame(asf.bones.get(CMU_OF[key])!.direction);
  if(/shoulder|elbow|wrist/.test(key)){
    const s=key.endsWith('@L')?'L':'R',side=s==='L'?'left':'right';
    const thumb=bones.find(b=>b.name==='thumb metacarpal'&&boneKey(b).endsWith(`@${s}`))!;
    const gameThumb=(thumb.userData.restPoint as THREE.Vector3).clone().sub(rest(`${side} wrist@${s}`));
    const cmuThumb=toGame(asf.bones.get(`${s.toLowerCase()}thumb`)!.direction);
    return frameOf2(cmu,cmuThumb).multiply(frameOf2(restDirection(key),gameThumb).invert());
  }
  return new THREE.Quaternion().setFromUnitVectors(restDirection(key),cmu);
}
/** Body-space world orientation of every mapped game bone for one CMU pose. */
function gameWorld(asf:Asf,pose:Pose,frame:THREE.Quaternion):Map<string,THREE.Quaternion>{
  const out=new Map<string,THREE.Quaternion>();
  for(const key of MOCAP_BONES){
    const w=key==='pelvis@C'?pose.rootRotation:pose.rotation.get(CMU_OF[key])!;
    out.set(key,frame.clone().multiply(B).multiply(w).multiply(Binv).multiply(swingAt(asf,key)));
  }
  return out;
}
function localPose(world:Map<string,THREE.Quaternion>):THREE.Quaternion[]{
  return MOCAP_BONES.map(key=>{
    let p=parentKey(key);while(p&&!world.has(p))p=parentKey(p);// shoulders hang from chest, hips from pelvis
    const q=world.get(key)!.clone();return p?world.get(p)!.clone().invert().multiply(q):q;
  });
}

const averageQuaternions=(qs:THREE.Quaternion[])=>{
  const sum=new THREE.Vector4(),ref=qs[0];
  for(const q of qs){const s=q.dot(ref)<0?-1:1;sum.x+=q.x*s;sum.y+=q.y*s;sum.z+=q.z*s;sum.w+=q.w*s;}
  return new THREE.Quaternion(sum.x,sum.y,sum.z,sum.w).normalize();
};
/** Local maxima of a signal at least `gap` frames apart, ignoring the clip edges. */
function peaks(signal:number[],gap:number):number[]{
  const out:number[]=[];
  for(let i=gap;i<signal.length-gap;i++){
    let best=true;for(let j=i-gap;j<=i+gap;j++)if(signal[j]>signal[i]){best=false;break;}
    if(best&&(!out.length||i-out[out.length-1]>=gap))out.push(i);
  }
  return out;
}

const clips:Record<string,unknown>={},provenance:Record<string,unknown>={};
for(const spec of CLIPS){
  const asf=parseAsf(readFileSync(`${source}/${spec.subject}.asf`,'utf8'));
  const cycles:{poses:Pose[];start:number;end:number;trial:string;ground:number}[]=[];
  const leg=asf.bones.get('lfemur')!.length+asf.bones.get('ltibia')!.length;
  const lowestFoot=(p:Pose)=>Math.min(...['ltibia','lfoot','ltoes','rtibia','rfoot','rtoes'].map(b=>p.end.get(b)!.y));
  const frames:Record<string,number>={};
  for(const trial of spec.trials){
    const text=readFileSync(`${source}/${trial}.amc`,'utf8');frames[trial]=0;
    const poses=parseAmc(text).map(f=>forwardKinematics(asf,f));
    const travel=toGame(poses[poses.length-1].root.clone().sub(poses[0].root)).setY(0).normalize();
    // Event signal in the game frame.
    const signal=poses.map(p=>{
      if(spec.event==='leftFoot')return toGame(p.end.get('ltibia')!.clone().sub(p.root)).dot(travel);
      const spine=toGame(p.end.get('thorax')!.clone().sub(p.root)).normalize();
      return toGame(p.end.get('lhand')!.clone().add(p.end.get('rhand')!).multiplyScalar(.5).sub(p.root)).dot(spine);
    });
    // Floor height: a low percentile of the lowest foot point over the trial.
    const lows=poses.map(lowestFoot).sort((a,b)=>a-b),ground=lows[Math.floor(lows.length*.03)];
    const marks=peaks(signal,spec.name==='walk'?35:spec.name==='run'?22:60);
    // Every complete cycle between events; the edge gap already skips partial strides.
    for(let c=0;c<marks.length-1;c++){cycles.push({poses,start:marks[c],end:marks[c+1],trial,ground});frames[trial]+=marks[c+1]-marks[c];}
    (provenance as Record<string,unknown>)[trial]={sha256:createHash('sha256').update(text).digest('hex'),frames:poses.length,cycleMarks:marks};
  }
  if(cycles.length<2)throw new Error(`${spec.name}: ${cycles.length} cycles`);
  // Body frame: heading only for upright gaits (keeps natural pelvis tilt), the mean
  // pelvis orientation for prone swimming (the game supplies the swimming lean).
  const frameOf=(c:typeof cycles[number]):THREE.Quaternion=>{
    const ps=c.poses.slice(c.start,c.end);
    if(spec.frame==='heading'){
      const travel=toGame(ps[ps.length-1].root.clone().sub(ps[0].root));
      const yaw=Math.atan2(-travel.x,-travel.z);// rotate travel onto -Z
      return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-yaw);
    }
    return averageQuaternions(ps.map(p=>B.clone().multiply(p.rootRotation).multiply(Binv))).invert();
  };
  const n=spec.samples,samples:THREE.Quaternion[][]=[];
  const lift:number[][]=[];
  for(let k=0;k<=n;k++){
    const perCycle:THREE.Quaternion[][]=[],heights:number[]=[];
    for(const c of cycles){
      const frame=frameOf(c),t=c.start+(c.end-c.start)*k/n,i=Math.min(Math.floor(t),c.end-1),f=t-i;
      const a=localPose(gameWorld(asf,c.poses[i],frame)),b=localPose(gameWorld(asf,c.poses[i+1],frame));
      perCycle.push(a.map((q,j)=>q.clone().slerp(b[j],f)));
      // Lowest foot point above the floor, in leg lengths: zero in stance, positive in flight.
      const p=c.poses[i];heights.push(Math.max(0,(lowestFoot(p)-c.ground)/leg));
    }
    samples.push(MOCAP_BONES.map((_,j)=>averageQuaternions(perCycle.map(p=>p[j]))));
    lift.push([heights.reduce((s,h)=>s+h,0)/heights.length]);
  }
  // Close the loop: spread the residual between the end and the start over the cycle.
  for(let j=0;j<MOCAP_BONES.length;j++){
    const residual=samples[n][j].clone().invert().multiply(samples[0][j]);
    for(let k=1;k<=n;k++)samples[k][j].multiply(new THREE.Quaternion().slerp(residual,k/n));
  }
  const rounded=samples.slice(0,n).flatMap(pose=>pose.flatMap(q=>q.toArray().map(x=>Math.round(x*1e4)/1e4)));
  const seconds=cycles.reduce((s,c)=>s+(c.end-c.start),0)/cycles.length/120;
  clips[spec.name]={samples:n,quaternions:rounded,cycleSeconds:+seconds.toFixed(3),cycles:cycles.length,
    footLiftLegLengths:lift.slice(0,n).map(h=>+h[0].toFixed(4)),source:`CMU subject ${spec.subject}: ${spec.trials.join(', ')}`};
  console.log(spec.name,'cycles',cycles.length,'period',seconds.toFixed(3),'s',frames);
}
mkdirSync(out,{recursive:true});
const data={format:'sea-mocap-gait-v1',bones:MOCAP_BONES,quaternionOrder:'xyzw, local to the game parent bone, rest rotation identity',
  phase:'sample 0: walk/run left foot furthest forward (heel strike); swim both hands furthest ahead (glide)',clips,
  provenance:{database:'CMU Graphics Lab Motion Capture Database, http://mocap.cs.cmu.edu',
    terms:'"This dataset of motions is free for all uses." Included in this product in converted form; not for resale as data.',
    acknowledgment:'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
    trials:provenance,generator:'scripts/bake-cmu-mocap.ts'}};
writeFileSync(new URL('gait-clips.json',out),JSON.stringify(data));
console.log('wrote',new URL('gait-clips.json',out).pathname,JSON.stringify(data).length,'bytes');
body.dispose();
