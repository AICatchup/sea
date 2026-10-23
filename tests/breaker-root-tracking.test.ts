import test from 'node:test';
import assert from 'node:assert/strict';
import {trackBreakerRoot,trackBreakerFace} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';

test('live crest projection follows a displaced peak without jumping to another wave',()=>{
 const sample:WhitewaterSampler=(x,_z,s)=>{s.height=1-(x-.75)**2;s.depth=2+s.height;s.ground=-2;return true;};
 const p=trackBreakerRoot(0,0,1,0,sample)!;
 assert.equal(p.x,.75);assert.equal(p.z,0);assert.equal(p.height,1);
 const remote:WhitewaterSampler=(x,_z,s)=>{s.height=x*.2;s.depth=3;s.ground=-2;return true;};
 assert.ok(Math.abs(trackBreakerRoot(0,0,1,0,remote)!.x)<=1);
});
test('crest projection rejects invalid and emergent support',()=>{
 assert.equal(trackBreakerRoot(0,0,1,0,()=>false),null);
 for(const ground of [.2,1])assert.equal(trackBreakerRoot(0,0,1,0,(_x,_z,s)=>{s.height=2;s.depth=1;s.ground=ground;return true;}),null);
});

import {ConnectedBreakerPool} from '../src/ocean/connected-breakers.ts';
test('root corrections accumulate along the live crest rather than restarting at the birth prediction',()=>{
 const pool=new ConnectedBreakerPool();let time=0;
 pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:2,speed:5,drop:2,reach:4})));
 const moving:WhitewaterSampler=(x,_z,s)=>{s.height=Math.max(-20,2-.5*(x-time)**2);s.depth=2;s.ground=-25;return true;};
 let previous=0;
 for(let i=0;i<48;i++){
  time+=1/60;pool.advance(1/60,moving,()=>{});
  const x=pool.roots[8*4];assert.ok(Math.abs(x-previous)<.26,'projection must not teleport a root');previous=x;
 }
 assert.ok(Math.abs(previous-time)<1,`root ${previous}, live crest ${time}`);
});

import {traceBreakingFront} from '../src/ocean/connected-breakers.ts';
test('compressed front emits from the higher crest even where crest compression is zero',()=>{
 const wave:WhitewaterSampler=(x,_z,s)=>{const h=3*Math.exp(-(((x+4)/3)**2));Object.assign(s,{height:h,depth:2+h,ground:-2,compression:x>-2?.4:0,gradientX:.1,gradientZ:0,waveGradientX:-.3,waveGradientZ:0,flowX:2,flowZ:0});return true;};
 const line=traceBreakingFront(0,0,wave,.2);assert.equal(line.length,17);
 assert.ok(line.every(n=>n.height>2.8&&n.x< -3&&n.energy>.08));
 assert.ok(line.every(n=>(n.drop??0)>2));
});


test('one crest line cannot tear into independently tracked neighbouring maxima',()=>{
 const pool=new ConnectedBreakerPool();
 pool.emitFront([-2,0,2].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,speed:3,drop:2})));
 let time=0;
 const split:WhitewaterSampler=(x,z,s)=>{const peak=time*(z<0?1:6);s.height=2-.05*(x-peak)**2;s.depth=4;s.ground=-3;return true;};
 for(let i=0;i<90;i++){time+=1/60;pool.advance(1/60,split,()=>{});}
 for(let j=1;j<17;j++)assert.ok(Math.abs(pool.roots[j*4]-pool.roots[(j-1)*4])<1e-6,'source phase stays coherent across the front');
});


test('wave-line projection selects steep front rather than the height maximum',()=>{
 const wave:WhitewaterSampler=(x,_z,s)=>{const e=Math.exp(-x*x/4);Object.assign(s,{height:3*e,ground:-2,depth:2+3*e,compression:.4,waveGradientX:-1.5*x*e,waveGradientZ:0});return true;};
 const face=trackBreakerFace(1.5,0,1,0,wave)!;assert.ok(face.x>=1.25&&face.x<=1.75);
 assert.ok(face.height<3);assert.equal(trackBreakerFace(-2,0,1,0,wave),null,'rising rear is not a front');
});

test('tracked front and emitted crest remain separate and an unsteepened front stops feeding',()=>{
 const pool=new ConnectedBreakerPool();
 const wave:WhitewaterSampler=(x,_z,s)=>{const e=Math.exp(-x*x/4);Object.assign(s,{height:3*e,ground:-2,depth:2+3*e,compression:.4,waveGradientX:-1.5*x*e,waveGradientZ:0});return true;};
 pool.emitFront([-1,0,1].map(z=>({x:0,z,frontX:1.5,frontZ:z,height:3,energy:.6,nx:1,nz:0,seed:.3,speed:1,depth:5})),wave);
 pool.advance(.1,wave,()=>{});assert.ok(Math.abs(pool.roots[8*4])<.4,'emission returns to crest behind tracked face');
 const flat:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:0,ground:-2,depth:2,compression:0,waveGradientX:0,waveGradientZ:0});return true;};
 pool.advance(.1,flat,()=>{});assert.equal(pool.geometryAudit.emittingNodes,0);
});


test('a tracked wave line emits horizontally before gravity rather than inheriting a noisy vertical cache launch',()=>{
 const pool=new ConnectedBreakerPool();
 const sea:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:3,depth:5,ground:-2,compression:.4,waveGradientX:-.5,waveGradientZ:0,heightRate:-8});return true;};
 pool.emitFront([-1,0,1].map(z=>({x:0,z,frontX:1,frontZ:z,height:3,energy:.6,nx:1,nz:0,seed:.3,speed:2,depth:5})),sea);
 pool.advance(.05,sea,()=>{});assert.ok(Math.abs(pool.sheet[1]-(3-4.905*.05*.05))<1e-5);
});


test('a higher rear peak cannot teleport the emission crest or connect different waves',()=>{
 const pool=new ConnectedBreakerPool();let time=0;
 const sea:WhitewaterSampler=(x,z,s)=>{
  const h=2*Math.exp(-(((x-time*2)/2)**2))+3*Math.exp(-(((x-time*2+6)/1.5)**2))*(z>0?1:0);
  Object.assign(s,{height:h,depth:2+h,ground:-2,compression:.5,waveGradientX:-.3,waveGradientZ:0});return true;
 };
 pool.emitFront([-2,0,2].map(z=>({x:0,z,frontX:1.5,frontZ:z,height:2,energy:.6,nx:1,nz:0,seed:.3,speed:2,depth:4})),sea);
 let previous=pool.roots[8*4];
 for(let i=0;i<40;i++){
  time+=1/60;pool.advance(1/60,sea,()=>{});
  assert.ok(Math.abs(pool.roots[8*4]-previous)<.2,'one-frame crest displacement stays local');previous=pool.roots[8*4];
  for(let j=1;j<17;j++)assert.ok(Math.abs(pool.roots[j*4]-pool.roots[(j-1)*4])<.001,'the rear peak cannot pull a neighbouring source six metres backwards');
 }
});


test('lost water samples retire every row instead of exposing stale geometry',()=>{
 const pool=new ConnectedBreakerPool();
 pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,speed:2,depth:3})));
 const sea:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:0,depth:2,ground:-2});return true;};
 pool.advance(.05,sea,()=>{});assert.ok(pool.geometryAudit.activeSamples>0);
 pool.advance(1/60,()=>false,()=>assert.fail('missing data cannot create impacts'));
 assert.equal(pool.geometryAudit.activeSamples,0);
 for(let i=3;i<17*145*4;i+=4)assert.equal(pool.sheet[i],-1);
});
