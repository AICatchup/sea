import test from 'node:test';import assert from 'node:assert/strict';
import {referenceWetSurface} from '../src/ocean/shore-solver-reference.ts';

// The renderer's one-cell stencil is continuous, even though the derivative
// inside a single bilinear face jumps at the next cell. Use the wet surface
// reconstruction shared with solver validation, not an analytic smooth wave.
const cell=1.5,heights=[0,.05,.8,2.6,.2,-.4,.1,.2];
const at=(x:number)=>{const k=Math.floor(x/cell),f=x/cell-k;return referenceWetSurface(
  [{bed:-4,h:4+heights[k],foam:0},{bed:-4,h:4+heights[k+1],foam:0}],[1-f,f],-4)!.eta;};
const gradient=(x:number)=>(at(x+cell)-at(x-cell))/(2*cell);
test('resolved shading slope shares the same limit on both sides of a wet grid edge',()=>{
  for(let k=2;k<=5;k++){
    const x=k*cell;
    assert.ok(Math.abs(gradient(x-1e-7)-gradient(x+1e-7))<1e-6);
    assert.ok(Math.abs(gradient(x)-(heights[k+1]-heights[k-1])/(2*cell))<1e-12);
  }
});
test('the one-cell support interpolates nodal gradients and retains a steep crest face',()=>{
  const k=3,a=(heights[k+1]-heights[k-1])/(2*cell),b=(heights[k+2]-heights[k])/(2*cell);
  for(const f of [0,.15,.5,.8,1])assert.ok(Math.abs(gradient((k+f)*cell)-(a*(1-f)+b*f))<1e-12);
  assert.ok(gradient(4*cell)<-.9,'valid steep water must not be flattened to hide its reflection');
});
