import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureGate} from '../src/qa/capture-exclusivity.ts';

test('different capture methods cannot overlap across an already-resolved readiness await',async()=>{
  const gate=createCaptureGate();let release!:()=>void,entered=0;
  const pending=gate.run(async()=>{entered++;await Promise.resolve();await new Promise<void>(r=>release=r);return 'first';});
  await assert.rejects(gate.run(async()=>{entered++;return 'other';}),/already in flight/);
  assert.equal(entered,1);release();assert.equal(await pending,'first');
  assert.equal(await gate.run(()=> 'next'),'next');
});
test('synchronous and asynchronous failures always release the shared capture lease',async()=>{
  const gate=createCaptureGate();
  await assert.rejects(gate.run(()=>{throw new Error('sync');}),/sync/);
  await assert.rejects(gate.run(async()=>{throw new Error('async');}),/async/);
  assert.equal(await gate.run(()=>7),7);
});
