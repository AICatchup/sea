import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {groundScannedShelf,scanBoundaryEdges} from '../src/world/grounded-reef.ts';
import {IslandElevation} from '../src/world/geodata.ts';
import {WorldCollision} from '../src/world/world-collision.ts';

function scan(file:string){
  const bytes=readFileSync(new URL(`../src/assets/marine/${file}`,import.meta.url)),jsonLength=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8')),binary=bytes.subarray(28+jsonLength),primitive=json.meshes[0].primitives[0];
  assert.ok(json.nodes.every((n:{matrix?:unknown;translation?:unknown;rotation?:unknown;scale?:unknown})=>!n.matrix&&!n.translation&&!n.rotation&&!n.scale));
  const read=(id:number,size:number)=>{
    const a=json.accessors[id],v=json.bufferViews[a.bufferView],offset=(v.byteOffset??0)+(a.byteOffset??0);assert.equal(v.byteStride,undefined);
    const buffer=Uint8Array.from(binary.subarray(offset,offset+a.count*size*(a.componentType===5123?2:4))).buffer;
    return a.componentType===5126?new Float32Array(buffer):a.componentType===5123?new Uint16Array(buffer):new Uint32Array(buffer);
  };
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(read(primitive.attributes.POSITION,3),3));geometry.setIndex(new THREE.BufferAttribute(read(primitive.indices,1),1));
  geometry.setAttribute('uv',new THREE.BufferAttribute(read(primitive.attributes.TEXCOORD_0,2),2));
  geometry.computeBoundingBox();const bounds=geometry.boundingBox!,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),unit=8/Math.max(size.x,size.z);
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(unit,unit,unit).multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z)));
  return geometry;
}

test('actual shelf scans retain relief, maps and topology with all open edges buried on the sloping reef',()=>{
  const ground=new IslandElevation(true,true,false),rows=[];
  for(const file of ['coast-rocks-01-2k.glb','coast-rocks-03-2k.glb','coast-rocks-01-seams-v34.glb','coast-rocks-03-seams-v34.glb']){
    const source=scan(file),positions=source.getAttribute('position').array.slice(),uv=source.getAttribute('uv').array.slice(),indices=source.index!.array.slice();
    const edges=scanBoundaryEdges(source);assert.ok(edges.length>50);let sourceDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);
    for(const [x,z,yaw,s] of [[-138,-119,.7,.7],[-147,-125,1.9,.9],[-155,-150,4.8,1.05]]){
      const m=new THREE.Matrix4().compose(new THREE.Vector3(x,ground.heightAt(x,z)-.2,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(.03,yaw,-.02)),new THREE.Vector3(s,.5*s,s));
      const result=groundScannedShelf(source,m,(x,z)=>ground.heightAt(x,z)),g=result.geometry,p=g.getAttribute('position');
      assert.ok(result.diagnostics.maxBoundaryExposure<-.04,JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.maxRelief>.06,'the shelf must retain visible stone relief');
      assert.equal(p.count,source.getAttribute('position').count);assert.deepEqual(g.index!.array,indices);assert.deepEqual(g.getAttribute('uv').array,uv);
      assert.ok(Array.from(p.array).every(Number.isFinite));assert.ok(Array.from(g.getAttribute('normal').array).every(Number.isFinite));assert.ok(g.boundingBox&&!g.boundingBox.isEmpty());
      const seamNormals=new Map<string,number[]>(),normals=g.getAttribute('normal');
      for(let i=0;i<p.count;i++){
        const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(','),normal=[normals.getX(i),normals.getY(i),normals.getZ(i)],previous=seamNormals.get(key);
        if(previous)normal.forEach((n,k)=>assert.ok(Math.abs(n-previous[k])<1e-6,'UV seam must not become a lighting seam'));else seamNormals.set(key,normal);
      }
      // The exact generated surface is usable by both Three picking and the
      // existing physical registry. A point above the top must not pass through.
      const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster(new THREE.Vector3(x,ground.heightAt(x,z)+4,z),new THREE.Vector3(0,-1,0));mesh.updateMatrixWorld(true);
      const hit=ray.intersectObject(mesh)[0];assert.ok(hit,'actual scan top must be ray-visible');
      const collision=new WorldCollision();collision.addMesh(mesh,new THREE.Matrix4());
      const p0={x:hit.point.x,y:hit.point.y+2,z:hit.point.z},p1={...p0,y:hit.point.y-1};
      assert.equal(collision.sweepBody(p0,p1,.15,.4).blocked,true,'generated visible shelf must have physical contact');
      rows.push({file,x,z,...result.diagnostics});collision.dispose();mesh.material.dispose();g.dispose();
    }
    assert.equal(sourceDisposals,0);assert.deepEqual(source.getAttribute('position').array,positions);assert.deepEqual(source.getAttribute('uv').array,uv);assert.deepEqual(source.index!.array,indices);source.dispose();
  }
  console.log('grounded reef scan evidence',JSON.stringify(rows));
});

test('welded position seams share one perimeter and invalid ground releases only the owned clone',()=>{
  const source=new THREE.PlaneGeometry(2,2,2,2).rotateX(-Math.PI/2).toNonIndexed(),before=source.getAttribute('position').array.slice();
  assert.equal(scanBoundaryEdges(source).length,8);
  let disposed=0;source.addEventListener('dispose',()=>disposed++);
  assert.throws(()=>groundScannedShelf(source,new THREE.Matrix4(),()=>NaN),/Nonfinite shelf ground/);
  assert.throws(()=>groundScannedShelf(source,new THREE.Matrix4(),()=>0,{embed:0}),/positive/);
  assert.equal(disposed,0);assert.deepEqual(source.getAttribute('position').array,before);source.dispose();
});

test('source ground grade is removed without flattening the stone on top of it',()=>{
  const source=new THREE.PlaneGeometry(2,2,2,2).rotateX(-Math.PI/2),p=source.getAttribute('position');
  for(let i=0;i<p.count;i++)p.setY(i,.3*p.getX(i)-.1*p.getZ(i)+5+(i===4?.6:0));
  const m=new THREE.Matrix4().compose(new THREE.Vector3(-147,3,-125),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),1.1),new THREE.Vector3(.75,.5,.75));
  const result=groundScannedShelf(source,m,(x,z)=>-10+x*.02-z*.03,{apron:.1});
  result.diagnostics.sourceGroundPlane.forEach((n,i)=>assert.ok(Math.abs(n-[.3,-.1,5][i])<1e-6));
  assert.ok(Math.abs(result.diagnostics.maxRelief-.52)<1e-6,'only the 0.6m stone relief is transferred, not the 5m ground datum');
  assert.ok(result.diagnostics.maxBoundaryExposure<-.079);result.geometry.dispose();source.dispose();
});
