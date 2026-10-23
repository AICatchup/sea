import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameBudget, parseFrameLimit, frameRateTargets} from '../src/ocean/frame-budget.ts';

test('30 and 60 fps caps hold across 60/120/144/240 Hz displays', () => {
  for (const hz of [60,120,144,240]) for (const cap of [30,60] as const) {
    const budget = new FrameBudget(cap);
    let count = 0;
    for (let i = 0; i < hz * 10; i++) if (budget.due(i * 1000 / hz)) count++;
    assert.ok(Math.abs(count - cap * 10) <= 1, `${hz} Hz / ${cap}: ${count}`);
  }
});
test('stalls and visibility resets never replay a backlog', () => {
  const budget = new FrameBudget(30);
  assert.equal(budget.due(10),true);
  assert.equal(budget.due(10000),true);
  assert.equal(budget.due(10001),false);
  budget.reset();
  assert.equal(budget.due(10002),true);
  assert.equal(budget.due(NaN),false);
});
test('display mode and invalid saved preferences have safe behavior', () => {
  const budget = new FrameBudget(0);
  assert.ok(budget.due(1) && budget.due(2));
  for (const value of [null,undefined,'bad',-1,144]) assert.equal(parseFrameLimit(value),30);
  assert.equal(parseFrameLimit('60'),60);
  assert.equal(parseFrameLimit('0'),0);
  assert.equal(frameRateTargets(30).lower,24);
  assert.ok(frameRateTargets(30).upper < 30);
});
