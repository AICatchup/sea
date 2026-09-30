import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { AssetWorld } from '../src/world/assets.ts';
import type { TrunkProxy } from '../src/world/foliage-lod.ts';
import { WorldCollision } from '../src/world/world-collision.ts';
import { WorldSolidBinding } from '../src/world/world-solid-binding.ts';

function assets(group=new THREE.Group(),trunks:readonly TrunkProxy[]=[]):AssetWorld {
  return {group,getTrunkProxies:()=>trunks} as unknown as AssetWorld;
}
function mesh(name:string,x=0):THREE.Mesh {
  const result=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial());result.name=name;result.position.set(x,1,0);return result;
}
function blocked(collision:WorldCollision,x:number):boolean {
  return collision.sweepBody({x:x-2,y:0,z:0},{x:x+2,y:0,z:0}).blocked;
}
test('binding selects actual cliffs, fixtures, scans and placements while excluding DEM, foliage and boat',()=>{
  const world=new THREE.Group(),scanned=new THREE.Group(),props=new THREE.Group();
  world.name='式根島・泊 / GSI land DEM with inferred seabed';
  world.add(mesh('Island DEM',0),mesh('Tomari jointed rhyolite ledges and fissures',10));
  const fixture=new THREE.Group();fixture.name='authored beach adventure fixtures';fixture.add(mesh('',20));props.add(fixture);
  props.add(mesh('placed chair',30),mesh('placed umbrella',40),mesh('placed tank',50),mesh('placed rock',60),mesh('placed scanned boulder_01',70));
  props.add(mesh('placed buoy',80),mesh('placed pine',90),mesh('coastalPineLod far 0 part 1',100),mesh('irregular strand pebbles',110));
  const boat=new THREE.Group();boat.name='5.6 metre coastal motorboat';boat.add(mesh('',120));props.add(boat);
  scanned.add(mesh('Photo-scanned cliff outcrops boulder_01',130),mesh('water tiles',140));
  const collision=new WorldCollision(),binding=new WorldSolidBinding(collision),stats=binding.sync(world,assets(props),scanned);
  assert.equal(stats.meshes,8);for(const x of [10,20,30,40,50,60,70,130])assert.equal(blocked(collision,x),true,`${x} solid`);
  for(const x of [0,80,90,100,110,120,140])assert.equal(blocked(collision,x),false,`${x} excluded`);
});
test('mutable instance count/matrices and parent world transforms replace only changed colliders',()=>{
  const world=new THREE.Group(),scanned=new THREE.Group(),props=new THREE.Group();scanned.position.x=10;
  const source=new THREE.InstancedMesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshBasicMaterial(),4);source.count=2;
  source.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,1,0));source.setMatrixAt(1,new THREE.Matrix4().makeTranslation(5,1,0));scanned.add(source);
  const collision=new WorldCollision(),binding=new WorldSolidBinding(collision),owner=assets(props);
  assert.equal(binding.sync(world,owner,scanned).added,2);assert.equal(blocked(collision,10),true);assert.equal(blocked(collision,15),true);
  const same=binding.sync(world,owner,scanned);assert.equal(same.added,0);assert.equal(same.replaced,0);assert.equal(same.unchanged,2);
  // setMatrixAt does not require instanceMatrix.needsUpdate for CPU signatures.
  source.setMatrixAt(1,new THREE.Matrix4().makeTranslation(12,1,0));
  const moved=binding.sync(world,owner,scanned);assert.equal(moved.replaced,1);assert.equal(moved.unchanged,1);
  assert.equal(blocked(collision,15),false);assert.equal(blocked(collision,22),true);
  source.count=1;assert.equal(binding.sync(world,owner,scanned).removed,1);assert.equal(blocked(collision,22),false);
  scanned.position.x=30;assert.equal(binding.sync(world,owner,scanned).replaced,1);assert.equal(blocked(collision,10),false);assert.equal(blocked(collision,30),true);
});
test('stable trunk proxies survive LOD churn and placement/undo changes only physical roots',()=>{
  const world=new THREE.Group(),scanned=new THREE.Group(),props=new THREE.Group();props.position.x=10;
  let roots:readonly TrunkProxy[]=[{x:0,y:0,z:0,radius:.2,height:6}];
  const owner={group:props,getTrunkProxies:()=>roots} as unknown as AssetWorld;
  const leaf=mesh('coastalPineLod near 0 part 1',100);leaf.userData.foliageLod='near';props.add(leaf);
  const collision=new WorldCollision(),binding=new WorldSolidBinding(collision);
  assert.equal(binding.sync(world,owner,scanned).trunks,1);assert.equal(blocked(collision,10),true);assert.equal(blocked(collision,110),false);
  props.remove(leaf);props.add(mesh('coastalPineLod far 0 part 0',110));assert.equal(binding.sync(world,owner,scanned).replaced,0);
  roots=[...roots,{x:8,y:0,z:0,radius:.25,height:5}];const added=binding.sync(world,owner,scanned);assert.equal(added.added,1);assert.equal(added.unchanged,1);
  roots=roots.slice(0,1);assert.equal(binding.sync(world,owner,scanned).removed,1);
});
test('borrowed resources remain intact and dispose releases only this binding',()=>{
  const world=new THREE.Group(),scanned=new THREE.Group(),owner=assets(),source=mesh('scanned rock');scanned.add(source);
  let disposed=0;source.geometry.addEventListener('dispose',()=>disposed++);(source.material as THREE.Material).addEventListener('dispose',()=>disposed++);
  const positions=source.geometry.getAttribute('position').array.slice();
  const collision=new WorldCollision(),unrelated=collision.addCylinder({x:30,y:0,z:0},.3,3),binding=new WorldSolidBinding(collision);
  binding.sync(world,owner,scanned);assert.deepEqual(source.geometry.getAttribute('position').array,positions);
  source.geometry.translate(10,0,0);const translated=source.geometry.getAttribute('position').array.slice();
  assert.equal(binding.sync(world,owner,scanned).replaced,1);assert.equal(blocked(collision,10),true);
  binding.dispose();binding.dispose();assert.equal(collision.stats.colliders,1);assert.equal(collision.remove(unrelated),true);assert.equal(disposed,0);
  assert.deepEqual(source.geometry.getAttribute('position').array,translated,'sync/dispose preserves the borrowed owner geometry');
  assert.notDeepEqual(source.geometry.getAttribute('position').array,positions,'only the owner-authored translate changed source geometry');
  assert.equal(binding.sync(world,owner,scanned).colliders,0);
});
test('dense scan BVHs are built once; unchanged sync preserves collider IDs and triangle budget',()=>{
  const world=new THREE.Group(),scanned=new THREE.Group(),owner=assets();
  const source=new THREE.InstancedMesh(new THREE.SphereGeometry(1,100,90),new THREE.MeshBasicMaterial(),8);source.count=8;
  for(let i=0;i<8;i++)source.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*10,1,0));scanned.add(source);
  const collision=new WorldCollision(),binding=new WorldSolidBinding(collision),first=binding.sync(world,owner,scanned),second=binding.sync(world,owner,scanned);
  assert.ok(first.triangles>140_000 && first.triangles<150_000);assert.equal(first.added,8);assert.equal(second.unchanged,8);assert.equal(second.replaced,0);
  assert.ok(second.syncMs<first.syncMs,'no BVH rebuild on unchanged content');assert.equal(first.triangles,second.triangles);
  collision.sweepBody({x:-3,y:0,z:0},{x:3,y:0,z:0});assert.ok(collision.stats.lastCandidates<=1);
  console.log(JSON.stringify({denseScanBinding:{triangles:first.triangles,initialMs:Number(first.syncMs.toFixed(1)),unchangedMs:Number(second.syncMs.toFixed(3))}}));
  binding.dispose();assert.equal(collision.stats.triangles,0);
});
