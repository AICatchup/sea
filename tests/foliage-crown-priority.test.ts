import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FoliageLodField} from '../src/world/foliage-lod.ts';
import type {FoliageLevels} from '../src/world/foliage.ts';

test('wide native crowns receive detail by projected span and refresh after source replacement',()=>{
 const material=new THREE.MeshStandardMaterial(),wide=new THREE.BoxGeometry(12,2,3),tall=new THREE.BoxGeometry(1,8,1),small=new THREE.BoxGeometry(1,2,1);
 const variants=(geometry:THREE.BufferGeometry)=>({parts:[{geometry,material}],triangles:12});
 const levels={near:[variants(wide),variants(tall)],mid:[variants(wide),variants(tall)],far:[variants(wide),variants(tall)]} as FoliageLevels;
 const matrices=[[new THREE.Matrix4().makeTranslation(0,1,-20)],[new THREE.Matrix4().makeTranslation(0,4,-14)]];
 const original=matrices.map(rows=>rows[0].toArray()),group=new THREE.Group();
 const field=new FoliageLodField(group,'crowns',levels,matrices,{nearDistance:35,midDistance:80,nearCapacity:1,midCapacity:0,triangleBudget:100});
 field.update(new THREE.Vector3(),true);
 const near=(variant:number)=>group.children.find(o=>o.name===`crowns near ${variant} part 0`) as THREE.InstancedMesh;
 assert.equal(near(0).count,1);assert.equal(near(1).count,0);
 const replaced={near:[variants(small),variants(tall)],mid:[variants(small),variants(tall)],far:[variants(small),variants(tall)]} as FoliageLevels;
 field.replaceLevels(replaced);field.update(new THREE.Vector3(),true);
 assert.equal(near(0).count,0);assert.equal(near(1).count,1);
 assert.deepEqual(matrices.map(rows=>rows[0].toArray()),original);
 assert.equal(group.userData.crowns.placements,2);assert.equal(group.userData.crowns.exclusiveLod,true);
 field.dispose();wide.dispose();tall.dispose();small.dispose();material.dispose();
});
