import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FoliageLodField} from '../src/world/foliage-lod.ts';

test('view-aware allocation refreshes on rotation while retaining nearby shadows and physical trunks',()=>{
  const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='trunk';
  const geometry=new THREE.BoxGeometry(2,4,2),variant={parts:[{geometry,material}],triangles:12};
  const group=new THREE.Group(),matrices=[[] as THREE.Matrix4[]];
  for(const z of [-180,180,-40,40])matrices[0].push(new THREE.Matrix4().makeTranslation(0,0,z));
  const field=new FoliageLodField(group,'test',{near:[variant],mid:[variant],far:[variant]},matrices,{nearDistance:60,midDistance:210,nearCapacity:2,midCapacity:4,triangleBudget:200,viewAware:true});
  const position=new THREE.Vector3(),proxies=field.getTrunkProxies();
  field.update(position,true,new THREE.Vector3(0,0,-1));
  assert.equal(group.userData.test.rendered,3);assert.equal(group.userData.test.culled,1);assert.equal(group.userData.test.placements,4);
  const instances=()=>group.children.filter(o=>o instanceof THREE.InstancedMesh).flatMap((o:any)=>Array.from({length:o.count},(_,i)=>{const m=new THREE.Matrix4();o.getMatrixAt(i,m);return m.elements[14];}));
  assert.ok(instances().includes(-180));assert.ok(!instances().includes(180));
  field.update(position,false,new THREE.Vector3(0,0,1));
  assert.ok(instances().includes(180));assert.ok(!instances().includes(-180));
  assert.ok(instances().includes(40)&&instances().includes(-40));assert.equal(field.getTrunkProxies(),proxies);
  assert.ok(group.userData.test.triangles<=200);field.dispose();geometry.dispose();material.dispose();
});
