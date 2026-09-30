import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldCollision, withWorldCollision } from '../src/world/world-collision.ts';

const box=(min:number[],max:number[])=>new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max));
test('body sweeps stop horizontal, falling and ascending motion at actual solid faces',()=>{
  const solids=new WorldCollision();solids.addBox(box([1,0,-1],[2,.7,1]));
  assert.equal(solids.sweepBody({x:0,y:0,z:0},{x:3,y:0,z:0}).blocked,true);
  const fall=solids.sweepBody({x:1.5,y:2,z:0},{x:1.5,y:-2,z:0});
  assert.equal(fall.blocked,true);assert.ok(fall.position.y>=.7 && fall.position.y<.704);assert.ok(fall.normal.y>.99);
  const ascent=solids.sweepBody({x:1.5,y:-2,z:0},{x:1.5,y:2,z:0},.25,.5);
  assert.equal(ascent.blocked,true);assert.ok(ascent.position.y<=-.5);assert.ok(ascent.normal.y<-.99);
  assert.equal(solids.sweepBody({x:0,y:.7,z:0},{x:3,y:.7,z:0}).blocked,false,'tangent walking on the top is clear');
});
test('thin rotated meshes retain triangle contact and do not inflate empty AABB corners',()=>{
  const solids=new WorldCollision(),geometry=new THREE.BoxGeometry(4,2,.01),material=new THREE.MeshBasicMaterial();
  const mesh=new THREE.Mesh(geometry,material);mesh.rotation.y=Math.PI/4;mesh.position.y=1;
  const attributes=geometry.getAttribute('position').array.slice();solids.addMesh(mesh);
  assert.equal(solids.sweepBody({x:0,y:0,z:-3},{x:0,y:0,z:3}).blocked,true);
  assert.equal(solids.sweepBody({x:1.4,y:0,z:1},{x:1.4,y:0,z:1.4}).blocked,false,'empty rotated AABB corner stays walkable');
  assert.deepEqual(geometry.getAttribute('position').array,attributes);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
  solids.dispose();assert.equal(disposed,0,'rendering retains ownership of borrowed resources');
  geometry.dispose();material.dispose();
});
test('support contact distinguishes steps, jumpable rock tops and ceilings',()=>{
  const solids=new WorldCollision();solids.addBox(box([1,0,-1],[2,.3,1]));solids.addBox(box([3,0,-1],[4,.7,1]));
  assert.equal(solids.supportHeightAt(1.5,0,0,.32),.3);
  assert.equal(solids.supportHeightAt(3.5,0,0,.32),null);
  assert.equal(solids.supportHeightAt(3.5,0,.8,.02),.7);
  assert.equal(solids.supportHeightAt(3.5,0,-.5,.32),null);
});
test('trunk proxy only occupies its cylinder and registry updates/removals are bounded',()=>{
  const solids=new WorldCollision();const trunk=solids.addCylinder({x:0,y:0,z:0},.3,5);
  assert.equal(solids.sweepBody({x:-1,y:0,z:0},{x:1,y:0,z:0}).blocked,true);
  assert.equal(solids.sweepBody({x:-1,y:0,z:1},{x:1,y:0,z:1}).blocked,false);
  solids.remove(trunk);assert.equal(solids.stats.colliders,0);
  for(let i=0;i<1600;i++)solids.addBox(box([i*20,0,20],[i*20+1,2,21]));
  solids.addBox(box([2,0,-1],[3,2,1]));
  const result=solids.sweepBody({x:0,y:0,z:0},{x:4,y:0,z:0});assert.equal(result.blocked,true);
  assert.ok(solids.stats.lastCandidates<4);assert.ok(solids.stats.lastTriangleTests<1000);
  const geometry=new THREE.BoxGeometry(1,1,1),mesh=new THREE.Mesh(geometry);const id=solids.addMesh(mesh);mesh.position.x=7;
  const replacement=solids.updateMesh(id,mesh);assert.notEqual(replacement,id);assert.equal(solids.remove(id),false);assert.equal(solids.remove(replacement),true);
  solids.clear();assert.equal(solids.stats.triangles,0);assert.equal(solids.stats.hashCells,0);geometry.dispose();
});
test('horizontal swim pose clears under an overhang but meets underwater rocks in every direction',()=>{
  const solids=new WorldCollision();solids.addBox(box([-3,.5,-3],[3,2,3]));solids.addBox(box([3,-4,-3],[4,2,3]));
  const pose={direction:{x:1,y:0,z:0}};
  assert.equal(solids.sweepBody({x:-2,y:-.5,z:0},{x:0,y:-.5,z:0},.25,1.75,pose).blocked,false);
  assert.equal(solids.sweepBody({x:0,y:-.5,z:0},{x:4,y:-.5,z:0},.25,1.75,pose).blocked,true);
  assert.equal(solids.sweepBody({x:0,y:-3,z:0},{x:0,y:3,z:0},.25,1.75,pose).blocked,true);
});
test('ground adapter retains height/navigation and terrain body hooks',()=>{
  const solids=new WorldCollision();const ground=withWorldCollision({heightAt:()=>-20,bodySegmentBlocked:()=>true},solids);
  assert.equal(ground.heightAt(0,0),-20);assert.equal(ground.bodySegmentBlocked!({x:0,y:0,z:0},{x:1,y:0,z:0}),true);
});
test('new solids enclosing a body resolve locally with a strict displacement bound',()=>{
  const solids=new WorldCollision();solids.addBox(box([-1,0,-1],[1,3,1]));
  const from={x:0,y:0,z:0};const next=solids.resolveBody(from,.25,1.75,.08);
  assert.ok(new THREE.Vector3(next.x,next.y,next.z).distanceTo(new THREE.Vector3())<=.080001);
  assert.ok(Math.abs(next.x)+Math.abs(next.z)+next.y>0,'an enclosed spawn is pushed toward a local surface');
  assert.ok(next.y>=0,'grounded overlap correction does not push through the floor');
});
