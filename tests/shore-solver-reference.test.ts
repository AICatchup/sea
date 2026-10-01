import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceStep,referenceWetSurface,foamCoverageStep} from '../src/ocean/shore-solver-reference.ts';
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

test('wet-only world elevation never promotes dry bank into phantom lake water',()=>{
 const result=referenceWetSurface([{bed:-.1,h:.1,foam:.4},{bed:1,h:0,foam:1}],[.7,.3],.23);
 assert.ok(result);assert.equal(result.eta,0);assert.equal(result.depth,0);assert.ok(Math.abs(result.foam-.4)<1e-12);
 assert.equal(referenceWetSurface([{bed:1,h:0,foam:1}],[1],1),null);
});
test('lake-at-rest rendering stays level through sloping wet dry cells',()=>{
 const nodes=[{bed:-2,h:2,foam:0},{bed:-.1,h:.1,foam:0},{bed:.4,h:0,foam:0},{bed:1,h:0,foam:0}];
 for(let i=0;i<=100;i++){const f=i/100,weights=[(1-f)*.5,(1-f)*.5,f*.5,f*.5];const r=referenceWetSurface(nodes,weights,-.5+f);if(r){assert.equal(r.eta,0);assert.equal(r.depth,Math.max(0,.5-f));}}
});

test('persistent compression accumulates foam with the same coverage across CFL timesteps',()=>{
 const evolve=(dt:number)=>{let f=0;for(let i=0;i<Math.round(2/dt);i++)f=foamCoverageStep(f,1,dt);return f;};
 const fine=evolve(.001),coarse=evolve(.02);
 assert.ok(fine>.9&&fine<.93);assert.ok(Math.abs(fine-coarse)<1e-12);
});
test('without breaking the foam decays in wall time and remains bounded',()=>{
 assert.ok(Math.abs(foamCoverageStep(.8,0,2)-.8*Math.exp(-.7))<1e-12);
 let coverage=.3;for(let i=0;i<2000;i++){coverage=foamCoverageStep(coverage,i%3/2,.01);assert.ok(coverage>=0&&coverage<=1);}
});
