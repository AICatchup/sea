import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {seatCoastalRock} from '../src/world/rock-support.ts';

test('tilted floating rock embeds actual vertices without altering scan geometry',()=>{
  const g=new THREE.BoxGeometry(2,1,2,3,3,3);g.translate(0,.5,0);
  const source=Array.from(g.getAttribute('position').array);
  const m=new THREE.Matrix4().compose(new THREE.Vector3(3,.35,5),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.24),new THREE.Vector3(1,1,1));
  const result=seatCoastalRock(g,m,()=>0,new THREE.Vector3(0,1,0),1.2);
  assert.ok(result.moved>0&&result.moved<=1.2);assert.ok(result.embeddedAfter>=.32);assert.equal(result.unresolved,false);
  assert.equal(m.elements[12],3);assert.equal(m.elements[14],5);assert.deepEqual(Array.from(g.getAttribute('position').array),source);
});
test('already seated and invalid support preserve transforms',()=>{
  const g=new THREE.BoxGeometry(2,1,2),m=new THREE.Matrix4(),before=m.clone();
  assert.equal(seatCoastalRock(g,m,()=>0,new THREE.Vector3(0,1,0),1).moved,0);
  assert.equal(seatCoastalRock(g,m,()=>NaN,new THREE.Vector3(0,1,0),1).unresolved,true);
  assert.deepEqual(m.elements,before.elements);
});
test('insufficient inset is bounded and reported, not a false success',()=>{
  const g=new THREE.BoxGeometry(1,1,1),m=new THREE.Matrix4().makeTranslation(0,20,0);
  const r=seatCoastalRock(g,m,()=>0,new THREE.Vector3(0,1,0),.5);
  assert.equal(r.unresolved,true);assert.ok(r.moved<=.5);assert.equal(m.elements[13],20);
});
