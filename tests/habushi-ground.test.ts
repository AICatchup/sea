import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HabushiMainGate } from '../src/world/habushi-main-gate.ts';
import { HabushiGround } from '../src/world/habushi-ground.ts';
import { WorldCollision } from '../src/world/world-collision.ts';
import {PAVEMENT_SPAN} from '../src/world/pavement-material.ts';

test('photo-informed roadfront stays bounded, finite, owns resources and leaves gate axis unpainted', () => {
  const gate = new HabushiMainGate({ heightAt: () => 13.1545794 });
  const ground = new HabushiGround(gate);
  assert.equal(ground.group.position.y, gate.grading.level);
  assert.equal(ground.group.rotation.y, -Math.PI / 2);
  assert.ok(Math.abs(ground.grading.center.x - (gate.grading.center.x - 22)) < 1e-8);
  assert.equal(ground.grading.level, gate.grading.level);
  assert.equal(ground.diagnostics.drawCalls, 6);
  assert.ok(ground.diagnostics.triangles < 5000);
  assert.equal(ground.diagnostics.borrowedResources, 0);
  ground.group.traverse(o => { if (o instanceof THREE.Mesh) {
    assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));
    const bounds = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position as THREE.BufferAttribute);
    assert.ok(bounds.min.z >= 9.29 && bounds.max.z <= 35.01);
    assert.ok(bounds.min.x >= -30.01 && bounds.max.x <= 30.01);
    if (o.name.includes('crossing')) {
      const origin = ground.group.localToWorld(new THREE.Vector3(0, 1, 20));
      const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(o);
      assert.equal(hits.length, 0);
    }
  }});
  const collision = new WorldCollision();
  ground.solidsGroup.traverse(o => { if (o instanceof THREE.Mesh) collision.addMesh(o); });
  for (const [z, height] of [[20, .02], [10.5, .14], [12.06, .16], [11.9, .025]]) {
    const p = ground.group.localToWorld(new THREE.Vector3(0, height, z));
    const support = collision.supportHeightAt(p.x, p.z, p.y + .03, .32, .01);
    assert.ok(support !== null && Math.abs(support - p.y) < 1e-5, `supported surface ${z}`);
  }
  assert.ok(ground.diagnostics.maxStep <= .15);
  ground.dispose(); ground.dispose(); assert.equal(ground.diagnostics.disposed, true);
  assert.equal(ground.solidsGroup.children.length, 0);
  assert.equal(gate.diagnostics.disposed, false);
  collision.dispose(); gate.dispose();
});


test('asphalt wear is bounded and metre-scaled while markings remain separate', () => {
  const gate = new HabushiMainGate({ heightAt: () => 8 }), ground = new HabushiGround(gate);
  const road = ground.solidsGroup.children.find(o => o instanceof THREE.Mesh && o.name.includes('road foundation')) as THREE.Mesh;
  const color = road.geometry.attributes.color;
  assert.ok(color && color.count === road.geometry.attributes.position.count);
  const values = Array.from(color.array);
  assert.ok(Math.max(...values) - Math.min(...values) > .1);
  assert.ok(values.every(v => Number.isFinite(v) && v >= .7 && v <= 1.15));
  assert.equal((road.material as THREE.MeshStandardMaterial).vertexColors, true);
  ground.dispose(); gate.dispose();
});

test('photographic pavement changes material channels without moving the road, markings or support',async()=>{
 const gate=new HabushiMainGate({heightAt:()=>13.1545794}),before=new HabushiGround(gate),after=new HabushiGround(gate,true);
 await after.ready;
 try{
  const meshes=(ground:HabushiGround)=>{const rows:THREE.Mesh[]=[];ground.group.traverse(o=>{if(o instanceof THREE.Mesh)rows.push(o)});return rows;};
  const originals=meshes(before),changed=meshes(after);assert.equal(changed.length,originals.length);
  changed.filter(m=>m.userData.habushiSolid||m.name.includes('crossing')).forEach(mesh=>{
   const original=originals.find(m=>m.name===mesh.name)!;
   assert.deepEqual(mesh.matrixWorld.toArray(),original.matrixWorld.toArray());
   assert.deepEqual(mesh.geometry.index!.array,original.geometry.index!.array);
   for(const key of ['position','normal','uv'])assert.deepEqual(mesh.geometry.getAttribute(key).array,original.geometry.getAttribute(key).array);
  });
  assert.ok(changed.every(mesh=>!mesh.name.includes('road expansion joint')),'road seams must not leave subpixel polygons over the surface');
  const road=changed.find(o=>o.name.includes('road foundation'))!,material=road.material as THREE.MeshStandardMaterial;
  assert.ok(material.map&&material.normalMap&&material.roughnessMap&&material.aoMap);
  assert.equal(material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(material.normalMap.colorSpace,THREE.NoColorSpace);assert.equal(material.roughnessMap.colorSpace,THREE.NoColorSpace);
  assert.equal(material.map.repeat.x,.6/PAVEMENT_SPAN);assert.equal(material.roughnessMap,material.aoMap);assert.equal(material.metalness,0);
  const collision=new WorldCollision();after.solidsGroup.traverse(o=>{if(o instanceof THREE.Mesh)collision.addMesh(o)});
  const p=after.group.localToWorld(new THREE.Vector3(0,.02,20));assert.ok(Math.abs(collision.supportHeightAt(p.x,p.z,p.y+.03,.32,.01)!-p.y)<1e-5);collision.dispose();
  const disposed=new Map<THREE.Texture,number>();for(const map of [material.map,material.normalMap,material.roughnessMap]){disposed.set(map,0);map.addEventListener('dispose',()=>disposed.set(map,disposed.get(map)!+1));}
  after.dispose();after.dispose();assert.deepEqual([...disposed.values()],[1,1,1]);
 }finally{before.dispose();after.dispose();gate.dispose();}
});

test('disposing pavement before texture readiness never reattaches a late finish',async()=>{
 const gate=new HabushiMainGate({heightAt:()=>8}),ground=new HabushiGround(gate,true);ground.dispose();await ground.ready;
 assert.equal(ground.diagnostics.photographicPavement,false);assert.equal(ground.group.children.length,0);gate.dispose();
});
