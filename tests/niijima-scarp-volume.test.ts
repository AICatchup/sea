import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NiijimaDEM } from '../src/world/niijima-detail.ts';
import { NiijimaScarpVolume,niijimaShoreStation } from '../src/world/niijima-scarp-volume.ts';
const source=new NiijimaDEM();
const ground={heightAt:(x:number,z:number)=>source.refinedHeightAt(x,z)};
test('indexed scarp is finite, closed, connected, nondegenerate and bounded',()=>{
  const volume=new NiijimaScarpVolume(ground,source),p=volume.geometry.getAttribute('position'),n=volume.geometry.getAttribute('normal'),index=volume.geometry.index!;
  const edges=new Map<string,number>();let signed=0,minArea=Infinity;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++){assert.ok(Number.isFinite(p.array[i*3+axis]));assert.ok(Number.isFinite(n.array[i*3+axis]));}
  for(let i=0;i<index.count;i+=3){
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
    minArea=Math.min(minArea,ab.subVectors(b,a).cross(ac.subVectors(c,a)).length());
    signed+=a.dot(ab.copy(b).cross(c))/6;
    for(let j=0;j<3;j++){const v=ids[j],w=ids[(j+1)%3],key=`${Math.min(v,w)}:${Math.max(v,w)}`;edges.set(key,(edges.get(key)??0)+1);}
  }
  assert.ok(minArea>1e-7);assert.ok(signed>1000);
  assert.ok([...edges.values()].every(v=>v===2));
  assert.equal(p.count-edges.size+index.count/3,2);
  assert.ok(volume.diagnostics.triangles<150000);
  assert.ok(volume.bounds.max.z-volume.bounds.min.z>400&&volume.bounds.max.z-volume.bounds.min.z<460);
  assert.ok(volume.diagnostics.minimumToeShore>27);
  console.log(volume.diagnostics,{signedVolume:signed,minDoubleArea:minArea,bounds:volume.bounds});volume.dispose();
});
test('source is unchanged and dry beach corridor has no volume intersection',()=>{
  const snapshot=source.heights.slice(),volume=new NiijimaScarpVolume(ground,source),mesh=volume.group.children[0] as THREE.Mesh;
  mesh.updateMatrixWorld(true);const ray=new THREE.Raycaster();
  for(let z=-975;z<=-605;z+=5){
    const x=niijimaShoreStation(source,z,12);
    ray.set(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(mesh).length,0);
    assert.ok(ground.heightAt(x,z)>0);
  }
  assert.deepEqual(source.heights,snapshot);
  const p=volume.geometry.getAttribute('position'),ring=79,deltas:number[]=[];
  for(let i=0;i<160;i++)deltas.push(p.getX((i+1)*ring+32)-p.getX(i*ring+32));
  for(const period of [8,16,32])assert.ok(deltas.slice(period).some((v,i)=>Math.abs(v-deltas[i])>.1));
  volume.dispose();
});

