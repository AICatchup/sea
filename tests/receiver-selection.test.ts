import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMeasuredGridPatch} from '../src/world/measured-grid-patch.ts';
import {GeometryReceivers} from '../src/ocean/geometry-receivers.ts';
import {isStaticOpticalReceiver} from '../src/ocean/receiver-selection.ts';

test('native measured chunks stay on the height-field path without exhausting opaque geometry capacity',()=>{
 const heights=new Float32Array(130*130).fill(-3),material=new THREE.MeshStandardMaterial();
 const patch=createMeasuredGridPatch({width:130,height:130,heights,origin:{x:0,z:0},column:{x:.25,z:0},row:{x:0,z:.25}},{heightAt:()=>-3},material);
 const cube=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),scene=new THREE.Scene();scene.add(patch.group,cube);scene.updateMatrixWorld(true);
 const receiver=new GeometryReceivers(scene,{include:isStaticOpticalReceiver,maxTriangles:1000});
 assert.equal(receiver.diagnostics.available,true,receiver.diagnostics.reason);
 assert.equal(receiver.diagnostics.triangles,12);assert.equal(receiver.diagnostics.instances,1);
 assert.equal(patch.diagnostics.nativeSamples,16900);assert.equal(patch.diagnostics.triangles,2*129*129);assert.equal(patch.surfaceHeightAt(12.25,12.25),-3);
 receiver.dispose();
 delete patch.group.userData.heightfieldSurface;for(const child of patch.group.children)delete child.userData.heightfieldSurface;
 const legacy=new GeometryReceivers(scene,{include:isStaticOpticalReceiver,maxTriangles:1000});
 assert.equal(legacy.diagnostics.available,false);assert.match(legacy.diagnostics.reason,/triangle budget/);legacy.dispose();
 patch.dispose();cube.geometry.dispose();material.dispose();
});
test('an opaque plant remains excluded by role after renaming; ordinary opaque meshes remain eligible',()=>{
 const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial(),plant=new THREE.InstancedMesh(geometry,material,1);
 plant.name='renamed specimen 12';plant.userData.marinePlant=true;assert.equal(isStaticOpticalReceiver(plant),false);
 delete plant.userData.marinePlant;assert.equal(isStaticOpticalReceiver(plant),true);
 const group=new THREE.Group();group.userData.heightfieldSurface=true;group.add(plant);assert.equal(isStaticOpticalReceiver(plant),false);
 plant.dispose();geometry.dispose();material.dispose();
});
