import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {tomariCliffCover} from '../src/world/tomari-cliff-cover.ts';
test('cliff plants are deterministic and rooted to exposed 3D faces with world-space spacing',()=>{
 const geometry=new THREE.PlaneGeometry(20,18,8,8),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.rotation.y=Math.PI/2;mesh.position.set(-110,22,-15);
 const first=tomariCliffCover({heightAt:()=>0},mesh),second=tomariCliffCover({heightAt:()=>0},mesh);
 assert.ok(first.count>25&&first.count<=320);assert.equal(first.projected,first.count);
 assert.deepEqual(first.placements.map(p=>p.map(m=>m.elements)),second.placements.map(p=>p.map(m=>m.elements)));
 assert.deepEqual(first.trees.map(p=>p.map(m=>m.elements)),second.trees.map(p=>p.map(m=>m.elements)));
 const points=[...first.placements.flat(),...first.trees.flat()].map(m=>new THREE.Vector3().setFromMatrixPosition(m));
 for(let i=0;i<points.length;i++){const p=points[i];assert.ok(Math.abs(p.x+110.025)<1e-6);assert.ok(p.y>=13&&p.y<=31&&p.z>=-25&&p.z<=-5);for(let j=0;j<i;j++)assert.ok(p.distanceTo(points[j])>=1.7-1e-8);}
 assert.equal(tomariCliffCover({heightAt:()=>100},mesh).count,0,'buried faces cannot grow visible cover');
 mesh.position.y=-20;assert.equal(tomariCliffCover({heightAt:()=>-50},mesh).count,0,'underwater faces stay bare');geometry.dispose();material.dispose();
});
