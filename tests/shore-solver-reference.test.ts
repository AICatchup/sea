import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceStep} from '../src/ocean/shore-solver-reference.ts';
test('lake at rest over nonflat bed including dry emergent bank',()=>{
 const bed=Array.from({length:64},(_,i)=>-.8+1.3*Math.sin(i*Math.PI*2/64));
 const h=bed.map(b=>Math.max(0,-b)),q=h.map(()=>0);
 const result=referenceStep(h,q,bed,.01,1);
 result.h.forEach((v,i)=>assert.ok(Math.abs(v-h[i])<1e-12));result.q.forEach(v=>assert.ok(Math.abs(v)<1e-12));
});
test('periodic nonlinear transport conserves water and flat-bed momentum',()=>{
 const bed=Array(64).fill(-2),h=bed.map((_,i)=>2+.3*Math.sin(i*Math.PI*2/64)),q=h.map((v,i)=>v*.4*Math.cos(i*Math.PI*2/64));
 const result=referenceStep(h,q,bed,.02,1),sum=(a:number[])=>a.reduce((s,v)=>s+v,0);
 assert.ok(Math.abs(sum(h)-sum(result.h))<1e-10);assert.ok(Math.abs(sum(q)-sum(result.q))<1e-10);
});
test('wet dry dam break stays positive under CFL without positivity clamp',()=>{
 const bed=Array(128).fill(0);let h=bed.map((_,i)=>i<64?1:0),q=bed.map(()=>0);
 for(let t=0;t<300;t++){const speed=Math.max(...h.map((v,i)=>Math.abs(q[i]/Math.max(v,.00001))+Math.sqrt(9.81*v)));const next=referenceStep(h,q,bed,.2/Math.max(speed,1),1);h=next.h;q=next.q;assert.ok(h.every(v=>Number.isFinite(v)&&v>=-1e-12));}
 assert.ok(Math.abs(h.reduce((s,v)=>s+v,0)-64)<1e-9);
});
