import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {boatHullGeometry} from '../src/world/models/boat-hull.ts';
import {ModelBatch,ModelResources} from '../src/world/models/procedural.ts';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/boat-hull-v34.json',import.meta.url),'utf8'));
const hash=(a:THREE.TypedArray)=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
test('hull smoothing preserves every position, UV, vertex count and bound from the shipped boat',()=>{
  for(const row of baseline.hulls){const g=boatHullGeometry(row.inner),legacy=boatHullGeometry(row.inner,false);g.computeBoundingBox();assert.equal(g.getAttribute('position').count,row.vertices);assert.equal(hash(g.getAttribute('position').array),row.position);assert.equal(hash(g.getAttribute('uv').array),row.uv);assert.deepEqual([g.boundingBox!.min.toArray(),g.boundingBox!.max.toArray()],row.bounds);assert.equal(hash(legacy.getAttribute('normal').array),row.legacyNormal);assert.notEqual(hash(g.getAttribute('normal').array),row.legacyNormal);g.dispose();legacy.dispose();}
});

test('hull curves share unit normals along their surface, retaining separate chines and end caps',()=>{
  for(const inner of [false,true]){
    const g=boatHullGeometry(inner),p=g.getAttribute('position'),n=g.getAttribute('normal'),groups=g.userData.hullSurfaceGroups as number[];
    const smooth=new Map<string,THREE.Vector3>(),corners=new Map<string,Map<number,THREE.Vector3>>();let shared=0,separate=0;
    for(let i=0;i<p.count;i++){
      const v=new THREE.Vector3().fromBufferAttribute(n,i),position=[p.getX(i),p.getY(i),p.getZ(i)].join(','),key=groups[i]+':'+position;
      assert.ok(Number.isFinite(v.length())&&Math.abs(v.length()-1)<1e-6);
      const previous=smooth.get(key);if(previous){assert.ok(previous.distanceTo(v)<1e-6,`faceted hull group ${groups[i]} at ${position}`);shared++;}else smooth.set(key,v);
      const corner=corners.get(position)??new Map<number,THREE.Vector3>();corner.set(groups[i],v);corners.set(position,corner);
      if(groups[i]>=5)assert.ok(Math.abs(v.z)>.999999&&Math.abs(v.x)<1e-7&&Math.abs(v.y)<1e-7,'planar caps must remain crisp');
    }
    for(const variants of corners.values())if(variants.size>1){const a=[...variants.values()];if(a.some(v=>v.distanceTo(a[0])>.15))separate++;}
    assert.ok(shared>100);assert.ok(separate>20);g.dispose();
  }
});

test('the existing boat material batch preserves corrected normals without touching other parts',()=>{
  const resources=new ModelResources(),material=resources.material(new THREE.MeshStandardMaterial({roughness:.32}));
  const hull=boatHullGeometry(),normal=hull.getAttribute('normal').array.slice(),batch=new ModelBatch();
  const box=new THREE.BoxGeometry(1,1,1).toNonIndexed(),boxNormals=box.getAttribute('normal').array.slice();
  batch.add(hull,material);batch.add(box,material);const group=batch.finish(resources,'boat hull check'),geometry=(group.children[0] as THREE.Mesh).geometry,all=geometry.getAttribute('normal').array;
  assert.deepEqual(all.slice(0,normal.length),normal);assert.deepEqual(all.slice(normal.length),boxNormals);assert.equal(material.flatShading,false);assert.equal(material.roughness,.32);resources.dispose();
});
