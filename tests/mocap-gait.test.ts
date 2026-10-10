import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {FirstPersonBody} from '../src/world/player-body.ts';
import {MOCAP_BONES,mocapFootLift,sampleMocapClip,validateMocapGait} from '../src/world/mocap-gait.ts';
import {strideRate} from '../src/world/explorer-controls.ts';
import type {AdventureState} from '../src/world/contracts.ts';

const data=validateMocapGait(JSON.parse(readFileSync(new URL('../src/assets/player/cmu-mocap-v65/gait-clips.json',import.meta.url),'utf8')));
const quats=()=>MOCAP_BONES.map(()=>new THREE.Quaternion());
const camera=()=>{const c=new THREE.PerspectiveCamera(75,1.6,.12,100);c.position.set(0,1.64,0);c.updateMatrixWorld();return c;};
const stateFor=(action:NonNullable<AdventureState['avatarAction']>,speed:number)=>({mode:action==='swim'||action==='dive'?action:'walk',position:new THREE.Vector3(),yaw:0,pitch:-.2,speed,oxygen:1,depth:0,
  boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',avatarAction:action,grounded:true,immersion:action==='swim'||action==='dive'?1:0}) as unknown as AdventureState;
const SOLE=[new THREE.Vector3(0,-.087,.03),new THREE.Vector3(0,-.07,-.17)];
const sole=(body:FirstPersonBody)=>{let low=Infinity;body.group.traverse(o=>{if(/ankle/.test(o.name))for(const p of SOLE)low=Math.min(low,p.clone().applyMatrix4(o.matrixWorld).y);});return low;};
const boneMatrices=(body:FirstPersonBody)=>{const m:number[]=[];body.group.traverse(o=>{if((o as THREE.Bone).isBone)m.push(...o.matrixWorld.elements);});return m;};

test('baked CMU clips carry provenance, steady cycles and seamless loops',()=>{
  assert.match(String(data.provenance.acknowledgment),/mocap\.cs\.cmu\.edu/);
  const trials=data.provenance.trials as Record<string,{sha256:string}>;
  assert.ok(Object.values(trials).every(t=>/^[0-9a-f]{64}$/.test(t.sha256)));
  for(const [name,clip] of Object.entries(data.clips)){
    assert.ok(clip.cycles>=8,`${name}: ${clip.cycles} cycles`);
    // Neighbouring samples, including the wrap from the last to the first, change smoothly.
    const a=quats(),b=quats();let worst=0;
    for(let k=0;k<clip.samples;k++){
      sampleMocapClip(clip,k/clip.samples,a);sampleMocapClip(clip,(k+1)/clip.samples,b);
      for(let j=0;j<a.length;j++)worst=Math.max(worst,a[j].angleTo(b[j]));
    }
    assert.ok(worst<.5,`${name}: largest per-sample step ${worst.toFixed(3)} rad`);
    assert.ok(a.every(q=>Math.abs(q.length()-1)<1e-6));
  }
  assert.ok(Math.abs(data.clips.walk.cycleSeconds-1.13)<.1&&Math.abs(data.clips.run.cycleSeconds-.74)<.1);
  assert.ok(mocapFootLift(data.clips.run,.5)>=0&&Math.max(...data.clips.run.footLiftLegLengths)>.05,'running has a flight phase');
});

test('mocap leaves idle, helm and climb untouched and keeps the first-person eye on the camera',()=>{
  for(const action of ['idle','helm','climb'] as const){
    const plain=new FirstPersonBody(),mocap=new FirstPersonBody();mocap.useMocap(data);
    const c=camera(),s=stateFor(action,0);
    for(let j=0;j<6;j++){s.gaitPhase=j*.9;plain.update(s,c,.05,j*.05);mocap.update(s,c,.05,j*.05);}
    assert.deepEqual(boneMatrices(mocap),boneMatrices(plain),`${action}: bit-identical`);
    plain.dispose();mocap.dispose();
  }
  for(const [action,speed] of [['walk',1.85],['run',4.7],['swim',1.5],['dive',1.5]] as const){
    const body=new FirstPersonBody();body.useMocap(data);const c=camera(),s=stateFor(action,speed);
    const head=new THREE.Vector3();
    for(let j=0;j<40;j++){
      s.gaitPhase=j/20*2*Math.PI;body.update(s,c,.05,j*.05);
      body.group.traverse(o=>{if(o.name==='head')head.setFromMatrixPosition(o.matrixWorld);});
      assert.ok(head.distanceTo(c.position)<1e-4,`${action} ${j}: eye ${head.distanceTo(c.position)} from the camera`);
      body.group.traverse(o=>{if((o as THREE.Bone).isBone)assert.ok(o.matrixWorld.elements.every(Number.isFinite));});
    }
    body.dispose();
  }
});

test('captured walk and run plant the stance sole on the floor; running keeps its flight',()=>{
  for(const [action,speed,maxLow] of [['walk',1.85,.012],['run',4.7,.015]] as const){
    for(const third of [false,true]){
      const body=new FirstPersonBody();body.useMocap(data);body.relaxedStance=third;
      const c=camera(),s=stateFor(action,speed),lows:number[]=[];
      for(let j=0;j<80;j++){s.gaitPhase=j/40*2*Math.PI;body.update(s,c,.05,j*.05);if(j>=40)lows.push(sole(body));}
      const floor=c.position.y-1.64,low=Math.min(...lows)-floor,high=Math.max(...lows)-floor;
      assert.ok(low>-.005&&low<maxLow,`${action}${third?' third':''}: lowest sole ${(low*100).toFixed(1)} cm`);
      if(action==='run')assert.ok(high>.04,'flight phase lifts both feet');
      body.dispose();
    }
  }
});

test('running stride rate is a human cadence and walking is unchanged',()=>{
  for(const v of [0,.5,1.2,1.85])assert.equal(strideRate(v),v*3.8);
  assert.ok(Math.abs(strideRate(1.85+1e-9)-strideRate(1.85))<1e-6,'continuous at the walk limit');
  const stepsPerMinute=strideRate(4.7)/(2*Math.PI)*2*60;
  assert.ok(stepsPerMinute>165&&stepsPerMinute<190,`${stepsPerMinute.toFixed(0)} steps/min at 4.7 m/s`);
});

test('fishing and physical tool transitions retain the procedural contact pose',()=>{
 for(const action of ['walk','swim','helm','climb'] as const){
   const plain=new FirstPersonBody(),captured=new FirstPersonBody();captured.useMocap(data);
   const c=camera(),s=stateFor(action,action==='walk'?1.85:action==='swim'?1.5:0);s.activity='fishing';
   for(let j=0;j<18;j++){s.gaitPhase=j*.5;plain.update(s,c,.05,j*.05);captured.update(s,c,.05,j*.05);assert.deepEqual(boneMatrices(captured),boneMatrices(plain),`${action} fishing frame ${j}`);}
   plain.dispose();captured.dispose();
 }
 for(const action of ['helm','climb'] as const){
   const plain=new FirstPersonBody(),captured=new FirstPersonBody();captured.useMocap(data);const c=camera(),s=stateFor('walk',1.85);
   for(let j=0;j<12;j++){s.gaitPhase=j*.5;plain.update(s,c,.05,j*.05);captured.update(s,c,.05,j*.05);}
   s.avatarAction=action;s.speed=0;
   for(let j=0;j<18;j++){plain.update(s,c,.05,1+j*.05);captured.update(s,c,.05,1+j*.05);if(j>1)assert.deepEqual(boneMatrices(captured),boneMatrices(plain),`${action} transition ${j}`);}
   plain.dispose();captured.dispose();
 }
});
