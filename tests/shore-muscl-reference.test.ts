import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceStep,referenceMusclStep} from '../src/ocean/shore-solver-reference.ts';

test('MUSCL preserves a small 24m wave through 96m propagation on the actual 1.5m grid',()=>{
 const n=128,dx=1.5,length=24,depth=4,c=Math.sqrt(9.81*depth),bed=Array(n).fill(-depth);
 const run=(step:typeof referenceStep)=>{let h=Array.from({length:n},(_,i)=>depth+.025*Math.sin(2*Math.PI*i*dx/length)),q=h.map(v=>(v-depth)*c),time=0;
  while(time<4*length/c){const dt=Math.min(.012230736358626397,4*length/c-time);const next=step(h,q,bed,dt,dx);h=next.h;q=next.q;time+=dt;}
  return 2/n*Math.hypot(h.reduce((s,v,i)=>s+(v-depth)*Math.sin(2*Math.PI*i*dx/length),0),h.reduce((s,v,i)=>s+(v-depth)*Math.cos(2*Math.PI*i*dx/length),0));};
 const legacy=run(referenceStep),candidate=run(referenceMusclStep);
 assert.ok(legacy<.001,'reproduce the first-order numerical damping');
 assert.ok(candidate>.0125&&candidate<=.025,'retain at least half the wave without energy gain');
});

test('dry-bank lake stays exactly at rest with higher-order free-surface reconstruction',()=>{
 const bed=Array.from({length:64},(_,i)=>-.8+1.3*Math.sin(i*Math.PI*2/64)),original=bed.map(b=>Math.max(0,-b));
 let h=[...original],q=h.map(()=>0);
 for(let i=0;i<100;i++){const next=referenceMusclStep(h,q,bed,.01,1);h=next.h;q=next.q;}
 assert.ok(h.every((v,i)=>Math.abs(v-original[i])<1e-12));assert.ok(q.every(v=>Math.abs(v)<1e-12));
});

test('higher-order wet-dry dam break stays positive and conservative without post-step clipping',()=>{
 const bed=Array(128).fill(0);let h=bed.map((_,i)=>i<64?1:0),q=bed.map(()=>0);
 for(let i=0;i<400;i++){const speed=Math.max(...h.map((v,j)=>Math.abs(q[j]/Math.max(v,.00001))+Math.sqrt(9.81*v)));const next=referenceMusclStep(h,q,bed,.15/Math.max(speed,1),1);h=next.h;q=next.q;assert.ok(h.every(v=>Number.isFinite(v)&&v>=-1e-12));}
 assert.ok(Math.abs(h.reduce((s,v)=>s+v,0)-64)<1e-9);
});
