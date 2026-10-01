import test from 'node:test';
import assert from 'node:assert/strict';
import {whitewaterPoreThreshold,whitewaterPoreGLSL} from '../src/ocean/whitewater-pores.ts';
import {ShoreWhitewaterVolume} from '../src/ocean/shore-whitewater-volume.ts';
test('shared world channel survives twelve overlapping masks while independent pores fill it',()=>{
  const alphas=Array.from({length:12},(_,i)=>.3+i*.03);
  const sharedPore=.26;
  assert.ok(alphas.every(a=>sharedPore<whitewaterPoreThreshold(a,.45)));
  // Twelve differently phased masks would include this pixel in their union.
  const independentPores=alphas.map((_,i)=>(i+.5)/12);
  assert.ok(independentPores.some((p,i)=>p>=whitewaterPoreThreshold(alphas[i],.45)));
  assert.ok(.85>=whitewaterPoreThreshold(.9,.03),'dense young fronts retain connected high-coverage regions');
  assert.ok(whitewaterPoreThreshold(.3,.8)>whitewaterPoreThreshold(.9,.03),'old wake opens additional channels');
});
test('production pores use world metres without seed phase and sunlight uses incidence over pi',()=>{
  const v=new ShoreWhitewaterVolume(),shader=v.material.fragmentShader;
  assert.ok(shader.includes(whitewaterPoreGLSL));
  assert.ok(shader.includes('whitewaterPore(vWorld)'));
  assert.ok(!whitewaterPoreGLSL.includes('vSeed'));
  assert.ok(shader.includes('fwidth(vWorld)'));
  assert.ok(shader.includes('sun/3.14159265'));
  assert.equal(v.pool.capacity,384);
  assert.equal(v.geometry.getAttribute('position').count/3*384,30720);
  v.dispose();
});
