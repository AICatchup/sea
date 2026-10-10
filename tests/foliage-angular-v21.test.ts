import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FoliageLodField} from '../src/world/foliage-lod.ts';

test('coverage priority avoids sacrificing the whole canopy to a few near trees under the same budget',()=>{
 const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='trunk';
 const make=(triangles:number)=>{const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,5,0,0,0,5,5],3));g.setIndex(Array.from({length:triangles*3},(_,i)=>i%3));return{parts:[{geometry:g,material}],triangles};};
 const near=make(1200),mid=make(300),far=make(60),distant=make(12),levels={near:[near],mid:[mid],far:[far],distant:[distant]};
 const matrices=[Array.from({length:100},(_,i)=>new THREE.Matrix4().makeTranslation(i-50,0,-60))];
 const groups=[new THREE.Group(),new THREE.Group()],settings={nearDistance:10,midDistance:20,nearCapacity:24,midCapacity:100,triangleBudget:10000,nearPixels:48,midPixels:24,farPixels:12};
 const fields=groups.map((g,i)=>new FoliageLodField(g,'test',levels,matrices,{...settings,preserveCrowns:i===1}));
 fields.forEach(f=>f.update(new THREE.Vector3(),true,new THREE.Vector3(0,0,-1),1000));
 assert.ok(groups[1].userData.test.instances.distant<groups[0].userData.test.instances.distant);
 assert.ok(groups[1].userData.test.instances.near>0);
 for(const group of groups){const d=group.userData.test;const triangles=group.children.reduce((s,o)=>s+(o instanceof THREE.InstancedMesh?o.count*o.geometry.index!.count/3:0),0);assert.equal(d.triangles,triangles);assert.ok(triangles<=10000);assert.equal(Object.values(d.instances).reduce((s:any,n:any)=>s+n,0),100);}
 assert.deepEqual(fields[0].getTrunkProxies(),fields[1].getTrunkProxies());
 fields.forEach(f=>f.dispose());[near,mid,far,distant].forEach(v=>v.parts[0].geometry.dispose());material.dispose();
});

test('angular LOD honours visible crown size and total budget on resize without moving trunks',()=>{
 const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='trunk';
 const make=(triangles:number)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,5,0,0,0,5,5],3));geometry.setIndex(Array.from({length:triangles*3},(_,i)=>i%3));return{parts:[{geometry,material}],triangles};};
 const near=make(120),mid=make(30),far=make(12),group=new THREE.Group();
 const field=new FoliageLodField(group,'angular',{near:[near],mid:[mid],far:[far]},[[new THREE.Matrix4().makeTranslation(0,0,-100),new THREE.Matrix4().makeTranslation(10,0,-120)]],{nearDistance:10,midDistance:20,nearCapacity:2,midCapacity:2,triangleBudget:200,nearPixels:48,midPixels:24});
 const pos=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1),trunks=field.getTrunkProxies();
 field.update(pos,true,direction,1000);assert.equal(group.userData.angular.instances.near,1);assert.equal(group.userData.angular.instances.mid,1);
 field.update(pos,false,direction,400);assert.equal(group.userData.angular.instances.near,0);assert.equal(group.userData.angular.instances.mid,0);
 assert.equal(field.getTrunkProxies(),trunks);assert.ok(group.userData.angular.triangles<=200);
 field.dispose();for(const variant of [near,mid,far])for(const part of variant.parts)part.geometry.dispose();material.dispose();
});

test('distant baseline keeps a dense field within its actual indexed triangle budget without dropping trunks or crowns',()=>{
 const material=new THREE.MeshStandardMaterial();material.userData.foliageRole='trunk';
 const make=(triangles:number)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,5,0,0,0,5,5],3));geometry.setIndex(Array.from({length:triangles*3},(_,i)=>i%3));return{parts:[{geometry,material}],triangles};};
 const near=make(1200),mid=make(300),far=make(60),distant=make(12),group=new THREE.Group();
 const field=new FoliageLodField(group,'dense',{near:[near],mid:[mid],far:[far],distant:[distant]},[Array.from({length:40},(_,i)=>new THREE.Matrix4().makeTranslation(i-20,0,-100))],{nearDistance:10,midDistance:20,nearCapacity:2,midCapacity:2,triangleBudget:1000,nearPixels:48,midPixels:24,farPixels:12});
 const position=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1),trunks=field.getTrunkProxies();
 field.update(position,true,direction,400);
 const actual=()=>group.children.reduce((sum,o)=>sum+(o instanceof THREE.InstancedMesh?o.count*(o.geometry.index!.count/3):0),0);
 assert.equal(group.userData.dense.rendered,40);assert.equal(group.userData.dense.placements,40);assert.equal(trunks.length,40);
 assert.ok(group.userData.dense.instances.far>0);assert.ok(group.userData.dense.instances.distant>0);assert.equal(group.userData.dense.triangles,actual());assert.ok(actual()<=1000);
 assert.equal(Object.values(group.userData.dense.instances).reduce((sum:any,n:any)=>sum+n,0),40);
 field.update(position,false,direction,100);assert.equal(group.userData.dense.instances.distant,40);assert.equal(actual(),480);assert.equal(field.getTrunkProxies(),trunks);
 field.dispose();for(const v of [near,mid,far,distant])v.parts[0].geometry.dispose();material.dispose();
});
