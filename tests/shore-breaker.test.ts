import test from 'node:test';
import assert from 'node:assert/strict';
import { breakerSheetEnvelope, breakerCurlSection, breakerTrackedCrest, ShoreBreaker } from '../src/ocean/shore-breaker.ts';
import * as THREE from 'three';
test('positive FFT shoulder gate requires shallow dissipating crest and convex incident front',()=>{
  assert.ok(breakerSheetEnvelope(1,.7,.4,.4,-.15,1)>.9);
  for(const s of [[0,.7,.4,.4,-.15,1],[4,.7,.4,.4,-.15,1],[1,0,.4,.4,-.15,1],[1,.7,-.4,.4,-.15,1],[1,.7,.4,-.4,-.15,1],[1,.7,.4,.4,.15,1],[1,.7,.4,.4,-.15,.1],[NaN,.7,.4,.4,-.15,1]])assert.equal(breakerSheetEnvelope(...s as [number,number,number,number,number,number]),0);
});
test('phase envelope is finite bounded and continuous at shore and energy thresholds',()=>{
  for(let i=0;i<1000;i++){const e=breakerSheetEnvelope(i*.005,i*.002,i*.001,i*.001,-i*.001,1);assert.ok(Number.isFinite(e)&&e>=0&&e<=1);}
  assert.ok(breakerSheetEnvelope(.2+1e-6,.7,.4,.4,-.15,1)<1e-9);
  assert.ok(breakerSheetEnvelope(1,.02+1e-6,.4,.4,-.15,1)<1e-9);
});
test('depth-limited broad crests are not rejected for having a small slope at their maximum',()=>{
  const height=(x:number)=>Math.exp(-x*x/36);
  const slope=(height(0)-height(.75))/.75,curvature=(height(-.5)+height(.5)-2*height(0))/.25;
  assert.ok(slope<.025,'a broad maximum need not have an artificially sharp shoulder');
  assert.ok(breakerSheetEnvelope(2,.7,height(0),slope,curvature,1)>.9);
  assert.equal(breakerSheetEnvelope(2,0,height(0),slope,curvature,1),0,'shape alone must not generate a breaker');
});
test('one mesh bounded triangle budget shared uniforms invalid camera and idempotent disposal',()=>{
  const b=new ShoreBreaker();assert.equal(b.group.children.length,1);assert.equal(b.triangleCount,36864);
  const swell={value:2};b.bindUniforms({uSwell:swell});assert.equal(b.material.uniforms.uSwell,swell);
  b.update(3,4,false);assert.equal(b.group.visible,true);assert.equal(b.material.uniforms.uOrigin.value.x,3);
  b.update(NaN,4,false);assert.equal(b.group.visible,false);b.update(3,4,true);assert.equal(b.group.visible,true);
  assert.ok(!b.material.vertexShader.includes('uTime'));assert.ok(b.material.vertexShader.includes('inverseChop'));
  let disposed=0;b.material.addEventListener('dispose',()=>disposed++);b.dispose();b.dispose();assert.equal(disposed,1);assert.equal(b.group.children.length,0);
});

test('metric curl turns beyond 180 degrees with a descending overhanging lip',()=>{
  const r=.7,a=3.665191429188092;
  const top=breakerCurlSection(Math.PI*.5*r,r,.3,.6);
  const lip=breakerCurlSection(a*r,r,.3,.6);
  assert.ok(top.active&&lip.active);assert.ok(lip.ny<0);
  assert.ok(lip.x>0,'the falling lip must stay ahead of the crest toward shore');assert.ok(lip.y<top.y);
  for(let i=1;i<100;i++){
    const q=a*r*i/100,p=breakerCurlSection(q,r,.3,.6);
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
    assert.ok(Math.abs(p.x)<=a*r);assert.ok(p.y>=.6-r*.51&&p.y<=.6+r);
    assert.ok(Math.abs(Math.hypot(p.nx,p.ny)-1)<1e-12);
    if(q/r>.2){
      const d=1e-5,left=breakerCurlSection(q-d,r,.3,.6),right=breakerCurlSection(q+d,r,.3,.6);
      const dx=(right.x-left.x)/(2*d),dy=(right.y-left.y)/(2*d);
      assert.ok(Math.abs(dx*p.nx+dy*p.ny)<1e-8);
    }
  }
});
test('base join, bounds and finite rejection; bilayer is thin along the section normal',()=>{
  const r=.7,a=3.665191429188092;
  assert.deepEqual(breakerCurlSection(0,r,.3,.6),{x:0,y:.3,nx:-1,ny:0,active:true});
  const p=breakerCurlSection(.00001,r,.3,.6);assert.ok(Math.abs(p.y-.3)<1e-8);
  for(const q of [-.01,a*r+.01,NaN])assert.equal(breakerCurlSection(q,r,.3,.6).active,false);
  assert.equal(breakerCurlSection(.2,0,.3,.6).active,false);
  const outer=breakerCurlSection(2*r,r,.3,.6,.5),inner=breakerCurlSection(2*r,r,.3,.6,-.5);
  assert.ok(Math.abs(Math.hypot(outer.x-inner.x,outer.y-inner.y)-r*.25)<1e-12);
});
test('shared optics, true curved normals, actual-height contact and complete borrowed bindings',()=>{
  const b=new ShoreBreaker();
  assert.equal(b.material.defines.CURVED_SURFACE,1);
  assert.ok(b.material.fragmentShader.includes('cross(dFdx(vWorld),dFdy(vWorld))'));
  assert.ok(b.material.fragmentShader.includes('vWorld.y<coast.x+.008'));
  assert.ok(b.material.fragmentShader.includes('waterFresnel'));
  assert.ok(b.material.vertexShader.includes('shoreSolvedSurface(world,fftHeight(world),0.)'));
  assert.ok(!b.material.vertexShader.includes('uTime'));
  const sky={value:1},depth={value:null};b.bindUniforms({uUseSky:sky,uSceneDepth:depth});
  assert.equal(b.material.uniforms.uUseSky,sky);assert.equal(b.material.uniforms.uSceneDepth,depth);
  const g=(b.group.children[0] as import('three').Mesh).geometry;
  assert.equal(g.index!.count/3,b.triangleCount);assert.equal(g.getAttribute('sheetSide').count,97*97*2);
  for(let i=0;i<g.getAttribute('position').count;i++){
    assert.ok(Math.abs(g.getAttribute('position').getX(i))<=16);
    assert.ok(Math.abs(g.getAttribute('position').getZ(i))<=16);
  }
  b.dispose();
});

test('crest anchor tracks instantaneous input phase, excludes the far search boundary',()=>{
  for(const phase of [.2,.65,1.1,1.75]){
    const c=breakerTrackedCrest(x=>Math.cos((x-phase)*.8),2.5);
    assert.ok(c.interior&&c.curvature<0);assert.ok(Math.abs(c.peak-phase)<.012);
  }
  const c=breakerTrackedCrest(x=>-x,2.5);assert.equal(c.interior,false);
  assert.equal(breakerTrackedCrest(()=>NaN,0).interior,false);
});

test('tracked sheet has a closed, consistently wound index boundary and renders outward faces',()=>{
  // No GPU calls occur in construction/disposal. Geometry closure is inspected
  // independently from the dynamic vertex embedding and optical acceptance.
  const b=new ShoreBreaker({} as THREE.WebGLRenderer,true);
  const mesh=b.group.children[0] as THREE.Mesh,indices=mesh.geometry.index!;
  assert.equal(b.triangleCount,37632);assert.equal(indices.count,b.triangleCount*3);
  assert.equal(b.material.side,THREE.FrontSide);
  const edges=new Map<string,{count:number;direction:number}>();
  for(let i=0;i<indices.count;i+=3){
    const tri=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
    assert.equal(new Set(tri).size,3);
    for(let j=0;j<3;j++){
      const a=tri[j],c=tri[(j+1)%3],key=`${Math.min(a,c)}:${Math.max(a,c)}`;
      const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=a<c?1:-1;edges.set(key,edge);
    }
  }
  for(const e of edges.values()){assert.equal(e.count,2);assert.equal(e.direction,0);}
  b.dispose();b.dispose();
});
