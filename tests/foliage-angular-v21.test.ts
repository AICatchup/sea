import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FoliageLodField} from '../src/world/foliage-lod.ts';

test('angular LOD honours visible crown size and total budget on resize without moving trunks',()=>{
 const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='trunk';
 const make=(triangles:number)=>({parts:[{geometry:new THREE.BoxGeometry(5,5,5),material}],triangles});
 const near=make(120),mid=make(30),far=make(12),group=new THREE.Group();
 const field=new FoliageLodField(group,'angular',{near:[near],mid:[mid],far:[far]},[[new THREE.Matrix4().makeTranslation(0,0,-100),new THREE.Matrix4().makeTranslation(10,0,-120)]],{nearDistance:10,midDistance:20,nearCapacity:2,midCapacity:2,triangleBudget:200,nearPixels:48,midPixels:24});
 const pos=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1),trunks=field.getTrunkProxies();
 field.update(pos,true,direction,1000);assert.equal(group.userData.angular.instances.near,1);assert.equal(group.userData.angular.instances.mid,1);
 field.update(pos,false,direction,400);assert.equal(group.userData.angular.instances.near,0);assert.equal(group.userData.angular.instances.mid,0);
 assert.equal(field.getTrunkProxies(),trunks);assert.ok(group.userData.angular.triangles<=200);
 field.dispose();for(const variant of [near,mid,far])for(const part of variant.parts)part.geometry.dispose();material.dispose();
});
