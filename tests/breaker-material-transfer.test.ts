import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedBreakerPool,type BreakerImpact} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';

function exercise(dt:number){
  const pool=new ConnectedBreakerPool(),transfers:BreakerImpact[]=[];
  pool.emitFront([-2,0,2].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,speed:2,depth:3})));
  const sea:WhitewaterSampler=(x,_z,s)=>{Object.assign(s,{height:Math.max(0,2-x*1.4),ground:-2,depth:2+Math.max(0,2-x*1.4)});return true;};
  pool.depositWater=b=>transfers.push(b);
  let firstTipTime=-1,lastTransferTime=-1,time=0;
  for(let i=0;i<Math.ceil(3/dt);i++){
    time+=dt;const before=transfers.length;
    pool.advance(dt,sea,()=>{if(firstTipTime<0)firstTipTime=time;});
    if(transfers.length>before)lastTransferTime=time;
  }
  return {pool,transfers,firstTipTime,lastTransferTime,volume:transfers.reduce((s,b)=>s+b.volume!,0)};
}
test('younger jet water continues feeding foam after the first tip lands',()=>{
  const r=exercise(1/60);assert.ok(r.firstTipTime>0);assert.ok(r.lastTransferTime>r.firstTipTime+.05);
  assert.ok(r.volume>0);assert.ok(r.transfers.every(b=>b.volume!>0&&b.impactSpeed>0&&Object.values(b).every(Number.isFinite)));
  const count=r.transfers.length;r.pool.advance(1,()=>false,()=>{});assert.equal(r.transfers.length,count,'absorbed water is never deposited twice');
});
test('landed volume is consistent when display frames group fixed simulation steps',()=>{
  const a=exercise(1/60),b=exercise(1/30);assert.ok(Math.abs(a.volume-b.volume)<1e-8);
});
test('a sheet below a flat sea creates no airborne-water transfer',()=>{
  const p=new ConnectedBreakerPool();p.emitFront([-1,0,1].map(z=>({x:0,z,height:0,energy:.6,nx:1,nz:0,seed:.3,depth:3})));
  p.depositWater=()=>assert.fail('water never separated');
  p.advance(1,(_x,_z,s)=>{Object.assign(s,{height:0,ground:-2,depth:2});return true;},()=>assert.fail('no first contact'));
});
