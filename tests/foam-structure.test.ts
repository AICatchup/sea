import test from 'node:test';
import assert from 'node:assert/strict';
import {foamMaterialConcentration,structuredFoamCoverage} from '../src/ocean/foam-structure.ts';
import {surfaceFoamCoverage} from '../src/ocean/surface-foam.ts';
test('a fully covered foam fragment retains its actual unsaturated concentration',()=>{
  const concentration=.42,coverage=surfaceFoamCoverage(concentration,.85,.03);
  assert.equal(coverage,1);
  assert.equal(foamMaterialConcentration(concentration,.1),concentration);
  assert.notEqual(foamMaterialConcentration(concentration,.1),Math.max(concentration,coverage));
});
test('two occupancy bands preserve concentration in expectation and converge to a stable distant mean',()=>{
  for(const c of [0,.1,.3,.6,.9,1]){
    let total=0;const n=180;
    for(let a=0;a<n;a++)for(let b=0;b<n;b++){
      const coverage=structuredFoamCoverage(c,(a+.5)/n,(b+.5)/n,0);assert.ok(coverage>=0&&coverage<=1);total+=coverage;
      assert.ok(Math.abs(structuredFoamCoverage(c,(a+.5)/n,(b+.5)/n,16)-c)<1e-12);
    }
    assert.ok(Math.abs(total/(n*n)-c)<.012,`coverage distribution for concentration ${c}`);
  }
});
test('both physical foam sources stay bounded without creating a white baseline',()=>{
  assert.equal(foamMaterialConcentration(0,0),0);
  assert.equal(foamMaterialConcentration(.1,.7),.7);
  assert.equal(foamMaterialConcentration(3,-1),1);
  assert.equal(foamMaterialConcentration(-3,-1),0);
  assert.equal(foamMaterialConcentration(NaN,1),0);
  for(let i=0;i<100;i++)assert.ok(foamMaterialConcentration(i/100,.2)<=foamMaterialConcentration((i+1)/100,.2));
});
