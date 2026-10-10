import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {hemiOctaDirToGrid,hemiOctaGridToDir,impostorGeometry,type ImpostorAtlas} from '../src/world/foliage-impostor.ts';
import {FoliageLodField} from '../src/world/foliage-lod.ts';
import type {FoliageLevels,FoliageVariant} from '../src/world/foliage.ts';

test('hemi-octahedral grid and direction mappings invert each other over the upper hemisphere',()=>{
 for(let i=0;i<=11;i++)for(let j=0;j<=11;j++){
  const u=i/11,v=j/11,d=hemiOctaGridToDir(u,v);
  assert.ok(Math.abs(d.length()-1)<1e-9);assert.ok(d.y>=-1e-9,'no view below the horizon');
  const g=hemiOctaDirToGrid(d);assert.ok(Math.abs(g.x-u)<1e-9&&Math.abs(g.y-v)<1e-9,`${u},${v}`);
 }
 assert.deepEqual(hemiOctaGridToDir(.5,.5).toArray().map(v=>Math.round(v*1e9)/1e9),[0,1,0]);
});

test('impostor card bounds cover the whole crown sphere for instance culling',()=>{
 const sphere=new THREE.Sphere(new THREE.Vector3(.2,2.6,-.1),3.4);
 const geometry=impostorGeometry({sphere} as ImpostorAtlas);
 assert.ok(geometry.boundingSphere!.equals(sphere));
 assert.ok(geometry.boundingBox!.containsPoint(new THREE.Vector3(.2,6,-.1)));
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),1);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(100,0,0));mesh.computeBoundingSphere();
 assert.ok(mesh.boundingSphere!.containsPoint(new THREE.Vector3(100.2,5.9,-.1)));
});

function variant(triangles:number):FoliageVariant{
 const geometry=new THREE.BoxGeometry(4,8,4).translate(0,4,0);geometry.computeBoundingBox();
 return {parts:[{geometry,material:new THREE.MeshStandardMaterial()}],triangles};
}
test('only crowns below the card size leave far/distant meshes; near/mid choices are unchanged',()=>{
 const levels:FoliageLevels={near:[variant(100000)],mid:[variant(13000)],far:[variant(5000)],distant:[variant(2000)]};
 const placements=[[0,30,60,150,400,900,2000].map(z=>new THREE.Matrix4().makeTranslation(0,0,-z))];
 const settings={nearDistance:35,midDistance:210,nearCapacity:24,midCapacity:300,triangleBudget:6_500_000,viewAware:true,nearPixels:48,midPixels:24,farPixels:12,preserveCrowns:true};
 const project=(field:FoliageLodField,group:THREE.Group)=>{field.update(new THREE.Vector3(0,2,5),true,new THREE.Vector3(0,0,-1),670);return group.userData.test.instances;};
 const baseGroup=new THREE.Group(),base=new FoliageLodField(baseGroup,'test',levels,placements,settings),before=project(base,baseGroup);
 const group=new THREE.Group(),field=new FoliageLodField(group,'test',levels,placements,settings);
 const card=new THREE.PlaneGeometry(),material=new THREE.MeshStandardMaterial();
 field.setImpostors({geometry:[card],material:[material],pixels:40});
 const after=project(field,group);
 assert.equal(after.near,before.near);assert.equal(after.mid,before.mid);
 assert.equal(after.impostor+after.far+after.distant,before.far+before.distant,'every far/distant crown is either kept or carded');
 assert.ok(after.impostor>0);
 const cards=group.children.find(o=>o.userData.foliageLod==='impostor') as THREE.InstancedMesh;
 assert.equal(cards.count,after.impostor);assert.equal(cards.castShadow,false);
 // Removing cards restores the original partition exactly.
 field.setImpostors(null);assert.deepEqual(project(field,group),before);
 field.dispose();base.dispose();card.dispose();material.dispose();
});
