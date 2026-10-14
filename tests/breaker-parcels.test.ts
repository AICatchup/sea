import test from 'node:test';
import assert from 'node:assert/strict';
import {CrestHistory,flyWaterParcel} from '../src/ocean/breaker-parcels.ts';

test('a released parcel falls under gravity and is independent of later crest movement',()=>{
  const history=new CrestHistory();history.reset({time:0,x:0,y:2,z:0});
  const emitted=history.sample(0),before=flyWaterParcel(emitted,.5,4,0,.4);
  history.record({time:.5,x:3,y:.1,z:0});
  assert.deepEqual(flyWaterParcel(history.sample(0),.5,4,0,.4),before);
  assert.equal(before.x,2);assert.ok(Math.abs(before.y-(2+.2-4.905*.25))<1e-12);
  assert.ok(before.vy<0);
});
test('intermediate emissions follow the same linear moving crest across frame partitions',()=>{
  const a=new CrestHistory(),b=new CrestHistory();
  for(const h of [a,b])h.reset({time:0,x:0,y:2,z:0});
  a.record({time:1,x:4,y:1,z:2});
  for(let i=1;i<=100;i++)b.record({time:i/100,x:i*.04,y:2-i*.01,z:i*.02});
  for(const t of [.15,.32,.78]){
    const x=a.sample(t),y=b.sample(t);
    for(const key of ['x','y','z'] as const)assert.ok(Math.abs(x[key]-y[key])<1e-12);
  }
});

import {ConnectedBreakerPool} from '../src/ocean/connected-breakers.ts';
test('unsupported sheets hand off airborne parcels once instead of stretching a ribbon',()=>{
  const pool=new ConnectedBreakerPool();const released:{y:number;vy:number}[]=[];
  pool.releaseWater=p=>released.push(p);
  pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,drop:2})));
  const flat=(_x:number,_z:number,s:{height:number;ground:number;depth:number})=>{s.height=0;s.ground=-2;s.depth=2;return true;};
  for(let i=0;i<120;i++)pool.advance(1/60,flat,()=>{});
  assert.ok(released.length>0&&released.length<=17*8);
  assert.ok(released.every(p=>p.y>.02&&p.vy<.4));
  const count=released.length;pool.advance(.5,flat,()=>{});assert.equal(released.length,count);
});
