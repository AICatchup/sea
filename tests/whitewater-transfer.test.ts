import test from 'node:test';
import assert from 'node:assert/strict';
import {WhitewaterVolumePool,createImpactFoamGeometry} from '../src/ocean/shore-whitewater-volume.ts';
import {ConnectedBreakerPool} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';
const birth={x:0,z:0,height:0,energy:.6,nx:1,nz:0,seed:.3,width:1.5,speed:4,volume:.1,impactSpeed:3};
const water:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:0,depth:2,ground:-2,compression:0,shelter:1,gradientX:0,gradientZ:0,flowX:0,flowZ:0});return true;};
test('landed water replenishes one finite froth volume, then spreads, loses height and disappears',()=>{
  const pool=new WhitewaterVolumePool(8,true);
  for(let i=0;i<60;i++){assert.ok(pool.deposit({...birth,volume:1/60}));pool.advance(1/60,water);}
  assert.equal(pool.active,1);assert.ok(pool.shape[1]>.35&&pool.shape[1]<=.45+1e-6,'aeration adds a bounded layer above the resolved water');
  assert.ok(Math.abs(pool.transferredVolume-1)<1e-12);
  const height=pool.shape[1],opacity=pool.alpha[0],area=pool.shape[0]*pool.shape[2];
  pool.advance(1,water);
  assert.ok(pool.shape[1]<height*.6,'an unfed layer must lose height within a second');assert.ok(pool.alpha[0]<opacity*.4);
  assert.ok(pool.shape[0]*pool.shape[2]>area*1.5);
  pool.advance(6,water);assert.equal(pool.active,0);
});
test('later material rows feed visible froth after the leading tip has landed',()=>{
  const sheet=new ConnectedBreakerPool(),foam=new WhitewaterVolumePool(256,true);
  const sea:WhitewaterSampler=(x,_z,s)=>{Object.assign(s,{height:Math.max(0,2-x*1.4),ground:-2,depth:2+Math.max(0,2-x*1.4),compression:.6,shelter:1,gradientX:1,gradientZ:0});return true;};
  sheet.emitFront([-2,0,2].map(z=>({...birth,z,height:2,depth:3,speed:2})));
  let tip=-1,last=-1,time=0;sheet.depositWater=b=>{assert.ok(foam.deposit(b));last=time;};
  for(let i=0;i<180;i++){time+=1/60;sheet.advance(1/60,sea,()=>{if(tip<0)tip=time;});foam.advance(1/60,sea);}
  assert.ok(tip>0&&last>tip+.05);assert.ok(foam.transferredVolume>0);
  assert.ok([...foam.positions,...foam.shape,...foam.alpha].every(Number.isFinite));
});
test('invalid or absent landed water cannot create or refill froth',()=>{
  const pool=new WhitewaterVolumePool(2,true);
  for(const b of [{...birth,volume:0},{...birth,volume:NaN},{...birth,energy:-1},{...birth,nx:0}])assert.equal(pool.deposit(b),false);
  assert.equal(pool.active,0);pool.deposit(birth);pool.clear();assert.equal(pool.active,0);assert.equal(pool.transferredVolume,0);
});

test('impact foam contains small separate 3D flocs within the previous triangle budget',()=>{
  const geometry=createImpactFoamGeometry(),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
  assert.ok(p.count/3<=720);let longest=0;
  for(let i=0;i<p.count;i+=3)for(let j=0;j<3;j++){
    const a=i+j,b=i+(j+1)%3;
    longest=Math.max(longest,Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b)));
    assert.ok(Math.abs(Math.hypot(n.getX(a),n.getY(a),n.getZ(a))-1)<1e-5);
  }
  assert.ok(longest<.3,'no triangle may span the full whitewater packet like a sheet');
  geometry.computeBoundingBox();assert.ok(geometry.boundingBox!.max.y-geometry.boundingBox!.min.y>.5);
  geometry.dispose();
});
