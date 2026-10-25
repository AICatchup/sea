import test from 'node:test';
import assert from 'node:assert/strict';
import {incidentBoreVelocity,boreFoamBirth,breakerViscosity} from '../src/ocean/shore-bore.ts';
import {referenceStep} from '../src/ocean/shore-solver-reference.ts';

test('incident closure preserves rest, zero dry momentum and the small-amplitude limit',()=>{
  for(const h of [.1,1,4,20])assert.equal(incidentBoreVelocity(h,h),0);
  assert.equal(incidentBoreVelocity(0,1),0);
  const eps=1e-5;assert.ok(Math.abs(incidentBoreVelocity(2+eps,2)/eps-Math.sqrt(9.81/2))<1e-5);
  assert.equal(incidentBoreVelocity(1000,0),12);
});
test('nonlinear crest and trough have unequal velocities and crest characteristics travel faster',()=>{
  const crest=incidentBoreVelocity(1.7,1),trough=incidentBoreVelocity(.3,1);
  assert.ok(crest>0&&trough<0);assert.ok(Math.abs(trough)>crest);
  assert.ok(crest+Math.sqrt(9.81*1.7)>trough+Math.sqrt(9.81*.3));
  assert.ok(Math.abs(crest-2*Math.sqrt(9.81*1.7)+2*Math.sqrt(9.81))<1e-12);
});
test('weak swell compression stays unbroken, while shallower sections of the same crest can break',()=>{
  assert.equal(boreFoamBirth(1.1,.5,.1,1),0);
  assert.equal(boreFoamBirth(2.35,.8,.35,2),0);
  assert.ok(boreFoamBirth(.95,.8,.35,.6)>.5);
  assert.equal(boreFoamBirth(.95,0,.35,.6),0);
  assert.equal(boreFoamBirth(.6,.8,-.1,.7),0);
});
test('breaker onset is continuous, bounded and quiet in dry or deep water',()=>{
  let last=0;for(let i=0;i<=1000;i++){
    const value=boreFoamBirth(1,.8,i/1000,1);
    assert.ok(value>=last&&value<=1&&value-last<.01);last=value;
  }
  assert.equal(boreFoamBirth(0,1,1,0),0);assert.equal(boreFoamBirth(8,1,1,8),0);
  assert.ok(boreFoamBirth(6,.8,3,3)>.5,'a high crest on a shallow bed must not disable its own breaking source');
});
test('nonlinear incident packet evolves conservatively without negative depth',()=>{
  const bed=Array(128).fill(-1);let h=bed.map((_,i)=>1+.35*Math.exp(-(((i-40)/9)**2)));
  let q=h.map(v=>v*incidentBoreVelocity(v,1));const sum=(a:number[])=>a.reduce((s,v)=>s+v,0),mass=sum(h),momentum=sum(q);
  for(let step=0;step<120;step++){
    const speed=Math.max(...h.map((v,i)=>Math.abs(q[i]/v)+Math.sqrt(9.81*v)));
    ({h,q}=referenceStep(h,q,bed,.18/speed,1));
    assert.ok(h.every(v=>v>0&&Number.isFinite(v)));
  }
  assert.ok(Math.abs(sum(h)-mass)<1e-10);assert.ok(Math.abs(sum(q)-momentum)<1e-10);
});

test('breaking dissipates only compressing depth-limited fronts and respects the diffusion CFL bound',()=>{
 assert.equal(breakerViscosity(4.1,.4,.1,4,1.5,.006),0,'ordinary swell remains unbroken');
 assert.equal(breakerViscosity(3,-.5,1,2,1.5,.006),0,'backwash is not forced shoreward');
 assert.ok(breakerViscosity(3,.8,1,2,1.5,.006)>1);
 assert.equal(breakerViscosity(3,.2,1,2,1.5,.006),2*breakerViscosity(3,.1,1,2,1.5,.006),'eddy viscosity uses strain once, independent of the foam birth timescale');
 for(const dt of [.001,.006,.02])assert.ok(breakerViscosity(8,20,4,4,1.5,dt)*dt/(1.5**2)<=.100000001);
});

test('symmetric breaking stress lowers kinetic energy while retaining water and net momentum',()=>{
 const n=64,dx=1.5,dt=.006,h=3,q=Array.from({length:n},(_,i)=>h*2*Math.sin(2*Math.PI*i/n));
 const nu=q.map((_,i)=>breakerViscosity(h,Math.max(0,-(q[(i+1)%n]-q[(i+n-1)%n])/(2*dx*h)),1,2,dx,dt));
 const next=q.map((v,i)=>{const r=(i+1)%n,l=(i+n-1)%n;return v+.5*dt/(dx*dx)*((nu[i]+nu[r])*(q[r]-v)+(nu[i]+nu[l])*(q[l]-v));});
 const sum=(a:number[])=>a.reduce((s,v)=>s+v,0);
 assert.ok(sum(next.map(v=>v*v/(2*h)))<sum(q.map(v=>v*v/(2*h))));
 assert.ok(Math.abs(sum(next)-sum(q))<1e-12);
});
