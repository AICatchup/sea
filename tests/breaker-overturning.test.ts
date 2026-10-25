import test from 'node:test';import assert from 'node:assert/strict';
import {ConnectedBreakerPool,SHEET_ROWS} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';

test('a translating steep crest emits airborne water which returns to the moving sea',t=>{
  const speed=5.5,height=3,scale=3;let time=0,maximumClearance=0,deposited=0;
  const elevation=(x:number)=>height*Math.exp(-(((x-speed*time)/scale)**2));
  const sea:WhitewaterSampler=(x,_z,s)=>{
    const h=elevation(x),gx=-2*(x-speed*time)/(scale*scale)*h;
    Object.assign(s,{height:h,depth:h+2,ground:-2,compression:.5,waveGradientX:gx,waveGradientZ:0,heightRate:-speed*gx});return true;
  };
  const pool=new ConnectedBreakerPool();pool.depositWater=b=>{deposited+=b.volume??0;};
  pool.emitFront([-2,0,2].map(z=>({x:0,z,frontX:scale/Math.sqrt(2),frontZ:z,height,energy:.6,nx:1,nz:0,seed:.3,speed,depth:5,drop:height})),sea);
  for(let i=1;i<=144;i++){
    time=i/60;pool.advance(1/60,sea,()=>{});
    for(let r=0;r<SHEET_ROWS;r++){
      const k=(8*SHEET_ROWS+r)*4;
      if(pool.sheet[k+3]>=0)maximumClearance=Math.max(maximumClearance,pool.sheet[k+1]-elevation(pool.sheet[k]));
    }
  }
  assert.ok(maximumClearance>.3,`crest never curled into air: ${maximumClearance}m`);
  assert.ok(maximumClearance<height,'flight cannot gain height above its horizontal launch');
  assert.ok(deposited>0,'airborne water must deposit into foam at actual return contact');
  t.diagnostic(JSON.stringify({maximumClearance,deposited,impacts:pool.impacts}));
});

test('a moving active face still owns its area after the old detector timeout',()=>{
  const speed=5.5;let time=0;
  const sea:WhitewaterSampler=(x,_z,s)=>{const h=3*Math.exp(-(((x-speed*time)/3)**2));
    Object.assign(s,{height:h,depth:h+2,ground:-2,compression:.5,waveGradientX:-2*(x-speed*time)/9*h,waveGradientZ:0});return true;};
  const pool=new ConnectedBreakerPool();
  pool.emitFront([-2,0,2].map(z=>({x:0,z,frontX:2.12,frontZ:z,height:3,energy:.6,nx:1,nz:0,seed:.3,speed,depth:5,drop:3})),sea);
  for(let i=1;i<=70;i++){time=i/60;pool.advance(1/60,sea,()=>{});}
  assert.ok(pool.active>0);const crestX=pool.roots[8*4];
  assert.equal(pool.coversActiveFace(crestX+2,0),true);
  assert.equal(pool.coversActiveFace(crestX+25,0),false,'the next independent wave remains eligible');
  pool.clear();assert.equal(pool.coversActiveFace(crestX+2,0),false);
});

test('first impact does not cut off a still-supported crest feeding the falling jet',()=>{
  const speed=5.5,height=3,scale=3;let time=0,firstImpact=-1,continued=false;
  const sea:WhitewaterSampler=(x,_z,s)=>{const h=height*Math.exp(-(((x-speed*time)/scale)**2));
    Object.assign(s,{height:h,depth:h+2,ground:-2,compression:.5,waveGradientX:-2*(x-speed*time)/(scale*scale)*h,waveGradientZ:0});return true;};
  const pool=new ConnectedBreakerPool();
  pool.emitFront([-2,0,2].map(z=>({x:0,z,frontX:scale/Math.sqrt(2),frontZ:z,height,energy:.6,nx:1,nz:0,seed:.3,speed,depth:5,drop:height})),sea);
  for(let i=1;i<=144;i++){
    time=i/60;pool.advance(1/60,sea,()=>{if(firstImpact<0)firstImpact=time;});
    if(firstImpact>0&&time>firstImpact+.05&&pool.tips[8*4+3]===1)continued=true;
  }
  assert.ok(firstImpact>0);assert.ok(continued,'a still-supported crest stopped when only its oldest parcel landed');
  assert.equal(pool.active,0,'feeding and flight must still have a bounded lifetime');
});

test('tracked crest attachment does not prematurely absorb a newly emitted row',()=>{
  const pool=new ConnectedBreakerPool();let level=2.05;
  const sea:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:level,depth:level+1,ground:-1,compression:.5,waveGradientX:-.2,waveGradientZ:0});return true;};
  pool.emitFront([-1,0,1].map(z=>({x:0,z,frontX:1,frontZ:z,height:2,energy:.6,nx:1,nz:0,seed:.3,speed:2,depth:3,drop:1.5})));
  pool.advance(1/60,sea,()=>{});
  assert.ok(pool.sheet[3]>=0,'source matching is rendered but its uncorrected sample was deleted');
  level=1.9;pool.advance(1/60,sea,()=>{});assert.ok(pool.sheet[3]>=0);
  level=2.1;pool.advance(1/60,sea,()=>{});assert.equal(pool.sheet[3],-1,'actual separated water must still be absorbed');
});
