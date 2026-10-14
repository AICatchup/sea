import test from 'node:test';
import assert from 'node:assert/strict';
import {traceBreakingFront,ConnectedBreakerPool,BREAKER_FRONT_NODES,breakerRootSupport,breakerLipThickness} from '../src/ocean/connected-breakers.ts';
import type {WhitewaterSample,WhitewaterSampler} from '../src/ocean/shore-whitewater.ts';
import {marineDecay,MarineSurfaceField,validMarineDeposit} from '../src/ocean/marine-surface-field.ts';
import * as THREE from 'three';
import {ShoreSpray} from '../src/ocean/shore-spray.ts';

const front:WhitewaterSampler=(x,z,s)=>{Object.assign(s,{height:.45-.04*x+.03*Math.sin(z*.2),compression:.2,depth:1.4,ground:-1,gradientX:.1,gradientZ:0,waveGradientX:-.04,waveGradientZ:0,flowX:1,flowZ:0});return true;};
const flat:WhitewaterSampler=(_x,_z,s)=>{Object.assign(s,{height:0,depth:2,ground:-2});return true;};

test('a tall plunging crest retains greater optical thickness than a small spilling lip',()=>{
  const low=breakerLipThickness(.3,.5),high=breakerLipThickness(2.8,.5);
  assert.ok(high>low*3);assert.ok(high<.8);
  assert.equal(breakerLipThickness(10,.5),breakerLipThickness(3.5,.5));
});
test('wave-line tracer connects an alongshore front; no dry gap or back-face join',()=>{
  const line=traceBreakingFront(0,0,front,.2);assert.equal(line.length,17);
  assert.ok(Math.hypot(line.at(-1)!.x-line[0].x,line.at(-1)!.z-line[0].z)>30);
  for(let i=1;i<line.length;i++)assert.ok(Math.hypot(line[i].x-line[i-1].x,line[i].z-line[i-1].z)<3);
  const back:WhitewaterSampler=(x,z,s)=>{front(x,z,s);s.waveGradientX=.12;return true;};
  assert.deepEqual(traceBreakingFront(0,0,back,.2),[]);
  const dryGap:WhitewaterSampler=(x,z,s)=>{front(x,z,s);if(z>-2&&z<2)s.depth=0;return true;};
  const broken=traceBreakingFront(0,-8,dryGap,.2);assert.ok(broken.every(b=>b.z<=-2));
});
test('old foam, thin swash, emergent strand and missing cache cannot create a front',()=>{
  for(const changed of [(s:WhitewaterSample)=>{s.compression=0;},(s:WhitewaterSample)=>{s.compression=.05;},(s:WhitewaterSample)=>{s.depth=8;},(s:WhitewaterSample)=>{s.ground=s.height;},
    (s:WhitewaterSample)=>{s.height=0;s.ground=-.2;s.depth=.2;},(s:WhitewaterSample)=>{s.height=1.2;s.ground=.2;s.depth=1;}])
    assert.deepEqual(traceBreakingFront(0,0,(x,z,s)=>{front(x,z,s);changed(s);return true;},.2),[]);
  assert.deepEqual(traceBreakingFront(0,0,()=>false,.2),[]);
});
test('a large shallow-water crest survives the temporary-depth gate and plunges toward the lower face',()=>{
  const steep:WhitewaterSampler=(x,z,s)=>{Object.assign(s,{height:Math.max(.1,2.5-.35*Math.max(0,x)),depth:3+Math.max(.1,2.5-.35*Math.max(0,x)),ground:-3,compression:.4,gradientX:.1,gradientZ:0,waveGradientX:-.35,waveGradientZ:0,flowX:4,flowZ:0});return true;};
  const line=traceBreakingFront(0,0,steep,.2);assert.equal(line.length,17);
  assert.ok(line.every(b=>(b.drop??0)>1.5&&(b.reach??0)>3));
  const pool=new ConnectedBreakerPool();pool.emitFront(line);let impacts=0;
  for(let i=0;i<120;i++)pool.advance(1/60,steep,()=>impacts++);
  assert.ok(impacts>0,'the high crest must land instead of remaining raised');assert.equal(pool.active,0);
});
test('one connected event gives one landing per node and collapses without repeat impacts',()=>{
  const pool=new ConnectedBreakerPool();assert.ok(pool.emitFront(traceBreakingFront(0,0,front,.2)));
  const events:{eventId:number;x:number;z:number;impactSpeed:number}[]=[];
  for(let i=0;i<90;i++)pool.advance(1/60,flat,b=>events.push(b));
  assert.equal(events.length,BREAKER_FRONT_NODES);assert.equal(new Set(events.map(b=>b.eventId)).size,1);assert.equal(pool.active,0);
  assert.ok(events.every(b=>b.impactSpeed>4&&b.impactSpeed<6),'impact velocity follows gravitational fall from the sampled crest');
  assert.ok(events.every(b=>b.x> -4));pool.advance(.2,flat,b=>events.push(b));assert.equal(events.length,BREAKER_FRONT_NODES);
  assert.ok(pool.roots.every(Number.isFinite));assert.ok(pool.tips.every(Number.isFinite));
});
test('front geometry is deterministic before contact and bounded across frame partitions',()=>{
  const a=new ConnectedBreakerPool(),b=new ConnectedBreakerPool(),line=traceBreakingFront(0,0,front,.3);
  a.emitFront(line);b.emitFront(line);a.advance(.2,flat,()=>assert.fail('early impact'));
  for(let i=0;i<20;i++)b.advance(.01,flat,()=>assert.fail('early impact'));
  for(let i=0;i<a.tips.length;i++)assert.ok(Math.abs(a.tips[i]-b.tips[i])<1e-5);
  const before=a.tips.slice();for(const dt of [0,-1,NaN])a.advance(dt,flat,()=>assert.fail('paused'));assert.deepEqual(a.tips,before);
  while(a.active<a.capacity)assert.ok(a.emitFront(line));assert.equal(a.emitFront(line),false);
  a.advance(.1,()=>false,()=>assert.fail('no cache'));assert.equal(a.active,0);
});
test('a departed high crest cannot leave a suspended sheet, while its tip still lands',()=>{
  const pool=new ConnectedBreakerPool();pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,depth:3,reach:3})));
  pool.advance(.2,flat,()=>assert.fail('too early for water contact'));
  for(let i=0;i<17;i++)assert.equal(breakerRootSupport(0,pool.tips[i*4+3]),0);
  assert.ok(breakerRootSupport(1.6,2)>0&&breakerRootSupport(1.6,2)<1,'support fades continuously before retiring');
  let impacts=0;for(let i=0;i<120;i++)pool.advance(1/60,flat,()=>impacts++);
  assert.equal(impacts,17);assert.equal(pool.active,0);
});
test('landing tips remain at endpoint water height while an uneven front collapses',()=>{
  const pool=new ConnectedBreakerPool();
  pool.emitFront([-1,0,1].map(z=>({x:0,z,height:2,energy:.6,nx:1,nz:0,seed:.3,speed:1.2,depth:3})));
  const uneven:WhitewaterSampler=(x,_z,s)=>{s.height=x<1.5?2:0;s.ground=-1;s.depth=s.height+1;return true;};
  for(let i=0;i<240&&pool.impacts===0;i++)pool.advance(1/120,uneven,()=>{});
  assert.ok(pool.impacts>0);pool.advance(.02,uneven,()=>{});
  let collapsed=0;
  for(let i=0;i<BREAKER_FRONT_NODES;i++){
    const k=i*4;
    if(pool.roots[k+3]>.02&&pool.roots[k+3]<.99&&pool.tips[k]>1.5){
      assert.equal(pool.tips[k+1],0);collapsed++;
    }
  }
  assert.ok(collapsed>0,'observe a fading landed tip above a different root water height');
});
test('foam and entrained bubbles have separate stable physical-time lifetimes',()=>{
  const one=marineDecay(.8,.6,1);let state:[number,number]=[.8,.6];for(let i=0;i<100;i++)state=marineDecay(...state,.01);
  assert.ok(Math.abs(one[0]-state[0])<1e-12);assert.ok(Math.abs(one[1]-state[1])<1e-12);assert.ok(one[1]/.6<one[0]/.8);
});
test('marine deposits are bounded and stationary boats emit no wake; disposal is idempotent',()=>{
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},xr:{enabled:false},autoClear:true} as unknown as THREE.WebGLRenderer;
  const field=new MarineSurfaceField(renderer);field.wake(0,0,0,0,0,0,.016);assert.equal(field.diagnostics.deposits,0);
  field.wake(0,0,0,0,-3,.4,.016);assert.equal(field.diagnostics.deposits,2);
  const deposit={x:0,z:0,nx:1,nz:0,radius:.7,halfLength:2,foam:.5,bubbles:.4,pressure:.1};
  assert.ok(validMarineDeposit(deposit));assert.equal(validMarineDeposit({...deposit,nx:NaN}),false);
  for(let i=2;i<256;i++)assert.ok(field.deposit(deposit));assert.equal(field.deposit(deposit),false);
  field.dispose();field.dispose();assert.equal(field.deposit(deposit),false);assert.equal(field.diagnostics.queued,0);
});
test('GPU transport consumes the same elapsed time at 20/30/60/120 fps and stamps each source once',()=>{
  for(const fps of [20,30,60,120]){
    let stamps=0;
    const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(scene:THREE.Scene){if(scene.children[0] instanceof THREE.Mesh&&scene.children[0].geometry instanceof THREE.InstancedBufferGeometry)stamps++;},xr:{enabled:true},autoClear:true} as unknown as THREE.WebGLRenderer;
    const field=new MarineSurfaceField(renderer),texture=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);
    field.bindUniforms(Object.fromEntries(['uLongWaves','uShortWaves','uBathymetry'].map(name=>[name,{value:texture}])));
    field.bindUniforms({uBathyBounds:{value:new THREE.Vector4(-96,-96,192,192)}});
    field.deposit({x:0,z:0,nx:1,nz:0,radius:.7,halfLength:2,foam:.5,bubbles:.4,pressure:.1});
    for(let i=0;i<fps;i++)field.update(1/fps,0,0);
    assert.ok(Math.abs(field.diagnostics.elapsed-1)<1e-8,`physical time at ${fps} fps`);
    assert.equal(field.diagnostics.droppedSeconds,0);assert.equal(stamps,1);assert.equal(renderer.xr.enabled,true);
    field.update(0,60,0);assert.ok(Math.abs(field.diagnostics.elapsed-1)<1e-8);
    field.dispose();texture.dispose();
  }
});
test('production field path still detects connected fronts and impacts without legacy foam geometry',async()=>{
  let requests=0,landings=0;
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},getDrawingBufferSize(v:THREE.Vector2){return v.set(1280,720);},
    async readRenderTargetPixelsAsync(_target:unknown,_x:number,_y:number,w:number,_h:number,bytes:Uint8Array){
      requests++;
      for(let j=0;j<w*w;j++){
        const x=(j%w+.5-w/2)*2,h=.5-.04*x,depth=Math.max(0,Math.min(8,h+1-.1*x)),code=Math.round((h/16+.5)*65535),i=j*4;
        bytes.set([Math.floor(code/256),code%256,Math.abs(x)<8?51:0,Math.round(depth/8*255)],i);
        bytes.set([139,128,255,137],w*w*4+i);
      }
      return bytes;
    }} as unknown as THREE.WebGLRenderer;
  const spray=new ShoreSpray(renderer,{heightAt:(x:number)=>-1+.1*x},{whitewater:true,patches:false,connected:true,lips:true,resolution:64,span:128});
  const camera=new THREE.PerspectiveCamera(),texture=new THREE.DataTexture(new Float32Array(4),1,1);
  const uniforms=Object.fromEntries(['uLongWaves','uShortWaves','uBathymetry'].map(name=>[name,{value:texture}]));
  spray.setImpactSink(()=>{landings++;return true;});
  for(let i=0;i<100;i++){spray.update(1+i/60,1/60,camera,uniforms);await Promise.resolve();await Promise.resolve();}
  assert.equal(spray.whitewater,null);assert.ok(requests>1);assert.ok(spray.diagnostics.frontEvents>0);assert.ok(landings>0);
  assert.equal(spray.diagnostics.readbackBytes,32768);assert.equal(spray.diagnostics.whitewaterMode,'world-field');
  spray.dispose();texture.dispose();
});
