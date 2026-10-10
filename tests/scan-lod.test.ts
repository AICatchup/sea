import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {InstancedScanLod,simplifiedScanLevels} from '../src/world/scan-lod.ts';

const rock=()=>{const g=new THREE.IcosahedronGeometry(2,24);return g.index?g:(()=>{const p=g.getAttribute('position');g.setIndex(Array.from({length:p.count},(_,i)=>i));return g;})();};

test('meshoptimizer levels share source attributes and approach their triangle ratios',async()=>{
 const source=rock(),before=source.index!.count,levels=await simplifiedScanLevels(source,[.22,.06]);
 assert.equal(source.index!.count,before,'source index untouched');
 assert.equal(levels.length,2);
 for(const [i,ratio] of [.22,.06].entries()){
  const l=levels[i];assert.equal(l.geometry.getAttribute('position'),source.getAttribute('position'));
  assert.ok(l.triangles<=before/3*ratio*2.05,`level ${i}: ${l.triangles}`);assert.ok(l.triangles>0);
 }
 assert.ok(levels[1].triangles<levels[0].triangles);
});

test('per-instance selection follows projected size with hysteresis; source stays the collider',async()=>{
 const source=rock(),levels=await simplifiedScanLevels(source,[.22,.06]);
 const instances=new THREE.InstancedMesh(source,new THREE.MeshStandardMaterial(),3);
 [0,20,600].forEach((z,i)=>instances.setMatrixAt(i,new THREE.Matrix4().makeTranslation(0,0,-z)));
 instances.updateMatrixWorld(true);
 const lod=new InstancedScanLod(instances,levels,[260,70]);
 assert.ok(lod.group.children.every(o=>o.userData.worldSolid===false));
 const ppm=720/(2*Math.tan(THREE.MathUtils.degToRad(31)));
 lod.update(new THREE.Vector3(0,1,8),ppm);
 assert.deepEqual(lod.diagnostics.instances,[1,1,1]);
 // Moving a little further keeps the near rock native until it is clearly smaller (15% band).
 const near=(d:number)=>2*2*ppm/(d-2);let d=10;while(near(d)>=260)d+=.5;
 lod.update(new THREE.Vector3(0,1,d-2+.1),ppm);assert.equal(lod.diagnostics.instances[0],1);
 lod.update(new THREE.Vector3(0,1,40),ppm);assert.equal(lod.diagnostics.instances[0],0);
 assert.equal(instances.count,3,'collider instances unchanged');
 lod.dispose();
 assert.ok(source.getAttribute('position').count>0,'shared attributes survive LOD disposal');
});
