import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {InstancedScanLod,simplifiedScanLevels} from '../src/world/scan-lod.ts';
import {scanBoundaryEdges} from '../src/world/grounded-reef.ts';

const rock=()=>{const g=new THREE.IcosahedronGeometry(2,24);return g.index?g:(()=>{const p=g.getAttribute('position');g.setIndex(Array.from({length:p.count},(_,i)=>i));return g;})();};

test('actual shelf LODs preserve every seated crop edge without new exposed chords',async()=>{
 for(const id of ['coast-rocks-01','coast-rocks-03']){
  const bytes=readFileSync(new URL(`../src/assets/marine/${id}-seams-v34.glb`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const mesh=gltf.scene.children[0] as THREE.Mesh,source=mesh.geometry;
  source.computeBoundingBox();
  const size=source.boundingBox!.getSize(new THREE.Vector3()),center=source.boundingBox!.getCenter(new THREE.Vector3()),unit=8/Math.max(size.x,size.z);
  source.applyMatrix4(new THREE.Matrix4().makeScale(unit,unit,unit).multiply(new THREE.Matrix4().makeTranslation(-center.x,-source.boundingBox!.min.y,-center.z)));
  const edges=(g:THREE.BufferGeometry)=>{
   const p=g.getAttribute('position'),key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',');
   return scanBoundaryEdges(g).map(([a,b])=>[key(a),key(b)].sort().join('|')).sort();
  };
  const expected=edges(source),before=Array.from(source.index!.array),levels=await simplifiedScanLevels(source,[.22,.06],true);
  assert.ok(expected.length>100,'the actual open scan, not a closed proxy');
  for(const [i,level] of levels.entries()){
   assert.deepEqual(edges(level.geometry),expected,`${id} LOD ${i} boundary`);
   assert.ok(level.triangles<=before.length/3*[.22,.06][i]*1.01,'retains the distance budget');
   assert.equal(level.geometry.getAttribute('uv'),source.getAttribute('uv'));
   level.geometry.attributes={};level.geometry.dispose();
  }
  assert.deepEqual(Array.from(source.index!.array),before,'native collider untouched');
  source.dispose();(mesh.material as THREE.Material).dispose();
 }
});

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
