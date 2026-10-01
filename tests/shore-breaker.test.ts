import test from 'node:test';
import assert from 'node:assert/strict';
import { breakerSheetEnvelope, ShoreBreaker } from '../src/ocean/shore-breaker.ts';
test('positive FFT shoulder gate requires shallow dissipating crest and convex incident front',()=>{
  assert.ok(breakerSheetEnvelope(1,.7,.4,.4,-.15,1)>.9);
  for(const s of [[0,.7,.4,.4,-.15,1],[4,.7,.4,.4,-.15,1],[1,0,.4,.4,-.15,1],[1,.7,-.4,.4,-.15,1],[1,.7,.4,-.4,-.15,1],[1,.7,.4,.4,.15,1],[1,.7,.4,.4,-.15,.1],[NaN,.7,.4,.4,-.15,1]])assert.equal(breakerSheetEnvelope(...s as [number,number,number,number,number,number]),0);
});
test('phase envelope is finite bounded and continuous at shore and energy thresholds',()=>{
  for(let i=0;i<1000;i++){const e=breakerSheetEnvelope(i*.005,i*.002,i*.001,i*.001,-i*.001,1);assert.ok(Number.isFinite(e)&&e>=0&&e<=1);}
  assert.ok(breakerSheetEnvelope(.2+1e-6,.7,.4,.4,-.15,1)<1e-9);
  assert.ok(breakerSheetEnvelope(1,.02+1e-6,.4,.4,-.15,1)<1e-9);
});
test('one mesh bounded triangle budget shared uniforms invalid camera and idempotent disposal',()=>{
  const b=new ShoreBreaker();assert.equal(b.group.children.length,1);assert.equal(b.triangleCount,18432);
  const swell={value:2};b.bindUniforms({uSwell:swell});assert.equal(b.material.uniforms.uSwell,swell);
  b.update(3,4,false);assert.equal(b.group.visible,true);assert.equal(b.material.uniforms.uOrigin.value.x,3);
  b.update(NaN,4,false);assert.equal(b.group.visible,false);b.update(3,4,true);assert.equal(b.group.visible,false);
  assert.ok(!b.material.vertexShader.includes('uTime'));assert.ok(b.material.vertexShader.includes('inverseChop'));
  let disposed=0;b.material.addEventListener('dispose',()=>disposed++);b.dispose();b.dispose();assert.equal(disposed,1);assert.equal(b.group.children.length,0);
});
