import test from 'node:test';
import assert from 'node:assert/strict';
import {waterLightIntegral} from '../src/ocean/water-volume.ts';

// Independent fine quadrature of the two Beer-Lambert paths, without the
// analytic primitive or the renderer's shadow partition.
function numeric(a:number,b:number,y:number,dy:number,sun:number,sigma:number){
  const n=120000,h=(b-a)/n;let total=0;
  for(let i=0;i<n;i++){const d=a+(i+.5)*h;total+=Math.exp(-sigma*d)*Math.exp(-sigma*Math.max(0,-y-dy*d)/sun);}
  return total*h;
}
test('sun and eye extinction integral matches independent quadrature including surface crossings',()=>{
  for(const [a,b,y,dy,sun] of [[0,25,-3,-.6,.8],[0,500,0,-.5,.7],[0,10000,0,-.5,.7],
    [0,35,-4,.75,.75],[2,40,3,-.4,.6],[0,100,-8,0,.7],[4,20,-30,.75,.75]]){
    for(const sigma of [.105,.021,.012]){
      const expected=numeric(a,b,y,dy,sun,sigma),actual=waterLightIntegral(a,b,y,dy,sun,sigma);
      assert.ok(Math.abs(actual-expected)/Math.max(1e-9,expected)<1e-5,`${a},${b},${y},${dy},${sigma}: ${actual} vs ${expected}`);
    }
  }
});
test('a far miss converges continuously and preserves interval additivity',()=>{
  for(const sigma of [.105,.021,.012]){
    const args=[0,-.6,.8,sigma] as const;
    const whole=waterLightIntegral(0,10000,...args);
    const sum=waterLightIntegral(0,2,...args)+waterLightIntegral(2,254,...args)+waterLightIntegral(254,510,...args)+waterLightIntegral(510,10000,...args);
    assert.ok(Math.abs(whole-sum)<1e-10);
    const at499=waterLightIntegral(0,499,...args),at500=waterLightIntegral(0,500,...args),at501=waterLightIntegral(0,501,...args);
    assert.ok(at499<=at500&&at500<=at501&&at501<=whole+1e-10);
    assert.ok(Math.abs(whole-1/(sigma*(1+.6/.8)))<1e-10);
  }
});
test('zero optical slope, transparent water and zero-length paths stay finite',()=>{
  assert.equal(waterLightIntegral(0,0,-2,-.3,.7,.021),0);
  assert.equal(waterLightIntegral(0,9,-2,-.3,.7,0),9);
  assert.ok(Math.abs(waterLightIntegral(0,4,-10,.8,.8,.021)-4*Math.exp(-.021*12.5))<1e-10);
  assert.throws(()=>waterLightIntegral(3,2,-1,0,.8,.01),RangeError);
});
