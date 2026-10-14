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
test('each emission keeps its own velocity when the crest accelerates',()=>{
 const history=new CrestHistory();history.reset({time:0,x:0,y:3,z:0,vx:3,vz:1,up:.4});
 const before=flyWaterParcel(history.sample(0),.5,99,99,99);
 history.record({time:.5,x:2,y:3,z:1,vx:8,vz:2,up:.4});
 assert.deepEqual(flyWaterParcel(history.sample(0),.5,-99,-99,-99),before);
 assert.equal(before.x,1.5);assert.equal(before.z,.5);
 const mid=history.sample(.25);assert.equal(mid.vx,5.5);assert.equal(mid.vz,1.5);
 const later=flyWaterParcel(history.sample(.5),1,0,0,0);
 assert.equal(later.x,6);assert.equal(later.z,2);
});

import {ConnectedBreakerPool,SHEET_ROWS} from '../src/ocean/connected-breakers.ts';
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

test('a uniform crest uses one physical clock across the whole connected front',()=>{
 const pool=new ConnectedBreakerPool();
 pool.emitFront([-8,0,8].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,drop:2})));
 pool.advance(.2,(_x,_z,s)=>{s.height=0;s.ground=-2;s.depth=2;return true;},()=>assert.fail('too early'));
 for(let j=1;j<17;j++){
   assert.ok(Math.abs(pool.tips[j*4]-pool.tips[0])<1e-6);
   assert.ok(Math.abs(pool.tips[j*4+1]-pool.tips[1])<1e-6);
 }
});

test('new sheet rows overlap the supporting crest instead of only touching an edge',()=>{
 const pool=new ConnectedBreakerPool();pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,drop:2})));
 pool.advance(.1,(_x,_z,s)=>{s.height=0;s.ground=-2;s.depth=2;return true;},()=>{});
 const newest=Math.round(.1*60)*4;
 assert.ok(pool.sheet[newest]<pool.roots[0]);assert.ok(pool.roots[0]-pool.sheet[newest]<.5);
});
test('after source separation younger sheet water keeps falling instead of vanishing with its tip',()=>{
 const pool=new ConnectedBreakerPool();let height=2;
 pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,drop:2})));
 const sample=(x:number,_z:number,s:{height:number;ground:number;depth:number})=>{s.height=height?Math.max(0,2-x*1.4):0;s.ground=-2;s.depth=s.height+2;return true;};
 pool.advance(.3,sample,()=>{});height=0;
 pool.advance(.1,sample,()=>{});
 const row=(8*SHEET_ROWS+6)*4,y0=pool.sheet[row+1];
 assert.equal(pool.tips[8*4+3],0,'source is detached');
 assert.ok(pool.roots[8*4+3]>.9,'airborne water remains visible');
 pool.advance(.1,sample,()=>{});const y1=pool.sheet[row+1];
 pool.advance(.1,sample,()=>{});const y2=pool.sheet[row+1];
 assert.ok(y0>y1&&y1>y2);
 assert.ok(Math.abs(y2-2*y1+y0+9.81*.01)<1e-5,'fixed parcel has gravitational acceleration');
});
