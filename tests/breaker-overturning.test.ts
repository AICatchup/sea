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
