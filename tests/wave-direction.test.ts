import test from 'node:test';
import assert from 'node:assert/strict';
import {OCEAN_SPECTRUM_AXIS,OCEAN_PROPAGATION_DIRECTION,shoreIncidentDirection} from '../src/ocean/wave-direction.ts';
import {createSpectrum} from '../src/ocean/spectrum.ts';
import {incidentBoreVelocity} from '../src/ocean/shore-bore.ts';

test('propagation sign matches positive temporal phase and the actual asymmetric spectrum',()=>{
  const n=32,length=64,dk=2*Math.PI/length,data=createSpectrum({size:n,length,wind:8,seed:8107,minWaveNumber:0,maxWaveNumber:1.55,rmsHeight:.5});
  let mx=0,mz=0;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const kx=(x-n/2)*dk,kz=(z-n/2)*dk,k=Math.hypot(kx,kz),i=(z*n+x)*4,e=data[i]**2+data[i+1]**2;
    if(k){mx-=kx/k*e;mz-=kz/k*e;}
  }
  assert.ok(mx*OCEAN_PROPAGATION_DIRECTION.x+mz*OCEAN_PROPAGATION_DIRECTION.z>0);
  const k=.1,omega=Math.sqrt(9.81*k),dt=.3,velocity=omega/k;
  const point={x:OCEAN_PROPAGATION_DIRECTION.x*velocity*dt,z:OCEAN_PROPAGATION_DIRECTION.z*velocity*dt};
  assert.ok(Math.abs(k*(point.x*OCEAN_SPECTRUM_AXIS.x+point.z*OCEAN_SPECTRUM_AXIS.z)+omega*dt)<1e-12,'travelling along -k retains the same phase');
});

test('flat shelves retain travelling incident flux and trough velocity reverses',()=>{
  const n=shoreIncidentDirection(0,0,2);
  assert.deepEqual(n,OCEAN_PROPAGATION_DIRECTION);
  const crest=incidentBoreVelocity(2.6,2),trough=incidentBoreVelocity(1.4,2);
  assert.ok(n.x*crest<0&&n.z*crest<0);
  assert.ok(n.x*trough>0&&n.z*trough>0);
});

test('refraction retains tangential motion and approaches the shore normal as water shallows',()=>{
  const deep=shoreIncidentDirection(-.1,0,12),shallow=shoreIncidentDirection(-.1,0,1);
  assert.ok(Math.abs(deep.x+.8)<1e-12&&Math.abs(deep.z+.6)<1e-12);
  assert.ok(shallow.x<deep.x&&shallow.z<0&&Math.abs(shallow.z)<Math.abs(deep.z));
  assert.ok(Math.abs(shallow.z/deep.z-Math.sqrt(1/12))<1e-12);
  assert.deepEqual(shoreIncidentDirection(.1,0,1),OCEAN_PROPAGATION_DIRECTION,'outgoing waves are not forced back inland');
  for(let a=0;a<2*Math.PI;a+=.07)for(const d of [0,.1,1,6,12,30]){
    const q=shoreIncidentDirection(Math.cos(a)*.1,Math.sin(a)*.1,d);
    assert.ok(Math.abs(Math.hypot(q.x,q.z)-1)<1e-12);
  }
});
