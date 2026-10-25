import test from 'node:test';
import assert from 'node:assert/strict';
import {plungingTakeoff} from '../src/ocean/breaker-takeoff.ts';
import {ConnectedBreakerPool,SHEET_ROWS} from '../src/ocean/connected-breakers.ts';
import {BreakerProfiles} from '../src/ocean/breaker-profile.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';

test('crest reconstruction splits a bounded head budget and leaves gentle waves unlifted',()=>{
  for(const speed of [0,2,5.5,8])for(const drop of [0,.2,.6,1.5,3.5])for(const slope of [0,.05,.15,.35]){
    const jet=plungingTakeoff(speed,drop,slope);
    assert.ok((jet.speed-speed)**2+jet.up**2<=2*9.81*drop+1e-8);
    if(slope<=.08||drop<=.45)assert.equal(jet.up,0);
  }
  assert.deepEqual(plungingTakeoff(NaN,2,.3),{speed:0,up:0,plunging:0});
});

test('a broad translating crest forms a sustained air cavity before impact and absorption',t=>{
  // The old narrow Gaussian test hid the actual 8m-wide, ~2m-high shoulder.
  const c=7,H=2,width=8;let time=0,deposited=0,impacts=0;
  const elevation=(x:number)=>H*Math.exp(-(((x-c*time)/width)**2));
  const sea:WhitewaterSampler=(x,_z,s)=>{const h=elevation(x),gx=-2*(x-c*time)/(width*width)*h;
    Object.assign(s,{height:h,depth:h+2,ground:-2,compression:.5,waveGradientX:gx,waveGradientZ:0,heightRate:-c*gx});return true;};
  const pool=new ConnectedBreakerPool();pool.depositWater=b=>{deposited+=b.volume??0;};
  pool.emitFront([-3,0,3].map(z=>({x:0,z,frontX:width/Math.sqrt(2),frontZ:z,height:H,energy:.6,nx:1,nz:0,seed:.3,speed:c,depth:4,drop:H,frontSlope:.30})),sea);
  let maximumClearance=0,cavitySeconds=0,maximumReach=0;
  for(let i=1;i<=180;i++){
    time=i/60;pool.advance(1/60,sea,()=>impacts++);let clearance=0;
    for(let row=0;row<SHEET_ROWS;row++){const k=(8*SHEET_ROWS+row)*4;if(pool.sheet[k+3]<0)continue;
      clearance=Math.max(clearance,pool.sheet[k+1]-pool.profiles.height(pool.sheet[k],pool.sheet[k+2],elevation(pool.sheet[k])));
      maximumReach=Math.max(maximumReach,pool.sheet[k]-pool.roots[8*4]);}
    maximumClearance=Math.max(maximumClearance,clearance);if(clearance>.35)cavitySeconds+=1/60;
  }
  assert.ok(maximumClearance>.5,`no resolved air cavity: ${maximumClearance}`);
  assert.ok(cavitySeconds>.4,`cavity disappears immediately: ${cavitySeconds}`);
  assert.ok(maximumReach>1.5,'the lip must travel forward relative to its source');
  assert.ok(impacts>0&&deposited>0,'released water must hit and feed whitewater');
  assert.equal(pool.active,0,'no airborne sheet survives its lifecycle');
  t.diagnostic(JSON.stringify({maximumClearance,cavitySeconds,maximumReach,impacts,deposited}));
});

test('front reconstruction preserves the crest, outer ocean and zero-strength state',()=>{
  const p=new BreakerProfiles();p.count=1;p.crests.set([0,0,2,1.5]);p.axes.set([1,0,8,1]);
  assert.equal(p.height(0,0,2),2);assert.equal(p.height(-1,0,1.8),1.8);
  assert.equal(p.height(2,10,1.8),1.8);assert.equal(p.height(10,0,.3),.3);
  assert.ok(p.height(2,0,1.8)<.6,'the old broad mound must not fill the barrel');
  for(let x=0;x<10;x+=.02)assert.ok(p.height(x,0,1.8)>=.5&&p.height(x,0,1.8)<=1.8);
  p.axes[3]=0;assert.equal(p.height(2,0,1.8),1.8);
  p.count=0;assert.equal(p.height(2,0,1.8),1.8);
});

test('retired material cannot stretch a glass triangle between the falling jet and its old root',()=>{
  let time=0;const speed=7,height=2;
  const sea:WhitewaterSampler=(x,_z,s)=>{const d=x-speed*time,h=height*Math.exp(-d*d/64),gx=-d*h/32;
    Object.assign(s,{height:h,depth:h+2,ground:-2,compression:.5,waveGradientX:gx,waveGradientZ:0,heightRate:-speed*gx});return true;};
  const pool=new ConnectedBreakerPool();
  pool.emitFront([-3,0,3].map(z=>({x:0,z,frontX:5.6,frontZ:z,height,energy:.6,nx:1,nz:0,seed:.3,speed,depth:4,drop:2,frontSlope:.3})),sea);
  let retiredEdges=0;
  for(let tick=1;tick<=150;tick++){
    time=tick/60;pool.advance(1/60,sea,()=>{});
    if(!pool.active)continue;
    for(let column=0;column<17;column++){
      if(pool.roots[column*4+3]<=0)continue;
      const live:number[]=[];for(let row=0;row<SHEET_ROWS;row++)if(pool.sheet[(column*SHEET_ROWS+row)*4+3]>=0)live.push(row);
      if(!live.length)continue;
      const first=live[0],last=live.at(-1)!;
      for(let row=0;row<SHEET_ROWS;row++)if(row<first||row>last){
        const k=(column*SHEET_ROWS+row)*4,p=(column*SHEET_ROWS+(row<first?first:last))*4;
        assert.deepEqual(Array.from(pool.sheet.subarray(k,k+3)),Array.from(pool.sheet.subarray(p,p+3)));
        assert.ok(pool.sheet[k+3]<0);retiredEdges++;
      }
    }
  }
  assert.ok(retiredEdges>100,'must exercise the released and partially absorbed jet');
});

test('a second detected face cannot create another sheet on the same physical emission crest',()=>{
  const pool=new ConnectedBreakerPool();
  const nodes=Array.from({length:17},(_,i)=>({x:0,z:(i-8)*2,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:4,drop:2}));
  pool.emitFront(nodes);pool.advance(.1,(_x,_z,s)=>{Object.assign(s,{height:0,depth:2,ground:-2});return true;},()=>{});
  assert.equal(pool.overlapsActiveCrest(nodes.map(n=>({...n,x:n.x+.5}))),true);
  assert.equal(pool.overlapsActiveCrest(nodes.map(n=>({...n,z:n.z+35}))),false);
  assert.equal(pool.overlapsActiveCrest(nodes.map(n=>({...n,x:n.x+12}))),false);
});
