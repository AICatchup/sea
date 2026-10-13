import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {seatShelfBoundary} from '../src/world/shelf-support.ts';
import {scanBoundaryEdges} from '../src/world/grounded-reef.ts';
import {IslandElevation} from '../src/world/geodata.ts';

test('actual open shelf cut rims are buried; impossible cliff sites retain their transform and fail',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/shelf-rim-placements.json',import.meta.url),'utf8'));
  const ground=new IslandElevation(true,true,false,true),geometries=new Map<string,THREE.BufferGeometry>();
  try{
    for(const id of ['coast_rocks_01','coast_rocks_03']){
      const file=id.replaceAll('_','-')+'-seams-v34.glb',bytes=readFileSync(new URL('../src/assets/marine/'+file,import.meta.url));
      const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
      const mesh=gltf.scene.children[0] as THREE.Mesh,g=mesh.geometry;g.computeBoundingBox();
      const size=g.boundingBox!.getSize(new THREE.Vector3()),center=g.boundingBox!.getCenter(new THREE.Vector3());
      const unit=8/Math.max(size.x,size.z);
      g.applyMatrix4(new THREE.Matrix4().makeScale(unit,unit,unit).multiply(new THREE.Matrix4().makeTranslation(-center.x,-g.boundingBox!.min.y,-center.z)));
      geometries.set(id,g);(mesh.material as THREE.Material).dispose();
    }
    let accepted=0,rejected=0;
    for(const c of fixture.cases){
      const g=geometries.get(c.id)!,p=g.getAttribute('position'),before=Array.from(p.array),matrix=new THREE.Matrix4().fromArray(c.matrix),unchanged=matrix.clone();
      const r=seatShelfBoundary(g,matrix,(x,z)=>ground.heightAt(x,z),new THREE.Vector3().fromArray(c.normal));
      assert.ok(r.samples>100);assert.equal(r.accepted,c.firstPassingInset!==null);
      if(r.accepted){
        accepted++;assert.ok(r.moved<=1.5);assert.ok(r.maxExposureAfter<=-.035);
        // Independently re-sample the transformed render edges more densely.
        for(const [a,b] of scanBoundaryEdges(g)){
          const va=new THREE.Vector3().fromBufferAttribute(p,a).applyMatrix4(matrix),vb=new THREE.Vector3().fromBufferAttribute(p,b).applyMatrix4(matrix);
          const steps=Math.ceil(va.distanceTo(vb)/.04);
          for(let i=0;i<=steps;i++){
            const q=va.clone().lerp(vb,i/steps);assert.ok(q.y-ground.heightAt(q.x,q.z)<-.025,'visible crop edge remains above support');
          }
        }
      }else{rejected++;assert.deepEqual(matrix.elements,unchanged.elements);assert.equal(r.maxExposureAfter,r.maxExposureBefore);}
      assert.deepEqual(Array.from(p.array),before,'scan relief and UV geometry are immutable');
    }
    assert.equal(accepted,2);assert.equal(rejected,1);
  }finally{geometries.forEach(g=>g.dispose());}
});

test('invalid supports and closed geometry never produce a false supported result',()=>{
  const g=new THREE.PlaneGeometry(3,2,2,2);g.rotateX(-Math.PI/2);
  const m=new THREE.Matrix4().makeTranslation(0,2,0),before=m.clone(),up=new THREE.Vector3(0,1,0);
  assert.equal(seatShelfBoundary(g,m,()=>NaN,up).accepted,false);
  assert.equal(seatShelfBoundary(g,m,()=>0,up,.5).accepted,false);
  assert.deepEqual(m.elements,before.elements);
  const closed=new THREE.BoxGeometry(1,1,1);
  assert.equal(seatShelfBoundary(closed,m,()=>0,up).accepted,false);
  g.dispose();closed.dispose();
});
