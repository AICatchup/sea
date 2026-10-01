import { test } from 'node:test';
import assert from 'node:assert/strict';
import { underwaterRayDistance, underwaterTransmission, validateDepthProbePoints } from '../src/ocean/compositor.ts';

test('perspective depth converts to metric ray length including wide field edges', () => {
  assert.equal(underwaterRayDistance(12, 1), 12);
  assert.equal(underwaterRayDistance(12, .6), 20);
  assert.equal(underwaterRayDistance(12, .1), 120);
  assert.equal(underwaterRayDistance(-1, .6), 0);
});

test('distant background cannot retain the blue transmission of an 85m visibility cap', () => {
  assert.ok(underwaterTransmission(85, .012) > .35);
  assert.ok(underwaterTransmission(1000, .012) < .000007);
  assert.ok(underwaterTransmission(35000, .012) < 1e-100);
});

test('Beer-Lambert stays bounded, continuous and compositional through surface crossing', () => {
  for (const sigma of [.105, .021, .012]) {
    assert.equal(underwaterTransmission(-10, sigma), 1);
    assert.equal(underwaterTransmission(0, sigma), 1);
    assert.ok(Math.abs(underwaterTransmission(1e-7, sigma) - 1) < 2e-8);
    let previous = 1;
    for (const path of [0, .01, 1, 20, 85, 86, 500, 35000]) {
      const t = underwaterTransmission(path, sigma);
      assert.ok(t >= 0 && t <= previous);
      previous = t;
      const incident = .7, ambient = .04;
      const outgoing = incident * t + ambient * (1-t);
      assert.ok(outgoing >= ambient && outgoing <= incident);
    }
    assert.ok(Math.abs(underwaterTransmission(90, sigma)
      - underwaterTransmission(30, sigma) * underwaterTransmission(60, sigma)) < 1e-12);
  }
});


test('QA depth probe has bounded finite UV inputs', () => {
  validateDepthProbePoints([]);
  validateDepthProbePoints([{x:0,y:0},{x:1,y:1}]);
  assert.throws(() => validateDepthProbePoints(Array.from({length:9},()=>({x:.5,y:.5}))), RangeError);
  for (const p of [{x:NaN,y:.5},{x:.5,y:Infinity},{x:-.001,y:.5},{x:.5,y:1.001}])
    assert.throws(() => validateDepthProbePoints([p]), RangeError);
});
