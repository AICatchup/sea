import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NiijimaDEM } from '../src/world/niijima-detail.ts';
import { NiijimaScarpVolume,niijimaShoreStation } from '../src/world/niijima-scarp-volume.ts';
import { niijimaScarpApronHeight } from '../src/world/niijima-scarp.ts';
const source=new NiijimaDEM();
const ground={heightAt:(x:number,z:number)=>niijimaScarpApronHeight(source,x,z,source.refinedHeightAt(x,z))};
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
  assert.ok(volume.bounds.max.z-volume.bounds.min.z>570&&volume.bounds.max.z-volume.bounds.min.z<590);
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
  const p=volume.geometry.getAttribute('position'),ring=111,deltas:number[]=[];
  for(let i=0;i<160;i++)deltas.push(p.getX((i+1)*ring+32)-p.getX(i*ring+32));
  for(const period of [8,16,32])assert.ok(deltas.slice(period).some((v,i)=>Math.abs(v-deltas[i])>.1));
  volume.dispose();
});


test('transported rings have no local inversions or nonadjacent station folds',()=>{
  const volume=new NiijimaScarpVolume(ground,source),p=volume.geometry.getAttribute('position'),ring=111;
  const cross=(a:number,b:number,c:number)=> (p.getX(b)-p.getX(a))*(p.getY(c)-p.getY(a))-(p.getY(b)-p.getY(a))*(p.getX(c)-p.getX(a));
  for(let i=0;i<volume.diagnostics.sections;i++){
    const z=p.getZ(i*ring);
    for(let j=0;j<ring;j++) assert.equal(p.getZ(i*ring+j),z);
    if(i)assert.ok(z-p.getZ((i-1)*ring)>.019);
    // Strict segment intersections detect folded cross sections. The separate
    // station planes then establish that nonadjacent rings cannot intersect.
    for(let a=0;a<ring;a++)for(let b=a+2;b<ring;b++){
      if(a===0&&b===ring-1)continue;
      const aa=i*ring+a,ab=i*ring+(a+1)%ring,ba=i*ring+b,bb=i*ring+(b+1)%ring;
      assert.ok(!(cross(aa,ab,ba)*cross(aa,ab,bb)<-1e-7&&cross(ba,bb,aa)*cross(ba,bb,ab)<-1e-7),`cross-section ${i}: ${a}/${b}`);
    }
  }
  const mesh=volume.group.children[0] as THREE.Mesh;mesh.updateMatrixWorld(true);
  const ray=new THREE.Raycaster();
  for(let z=-1080;z<=-500;z+=3)for(const distance of [4,8,12])for(const offset of [-.45,.45]){
    const x=niijimaShoreStation(source,z,distance)+offset;
    ray.set(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));assert.equal(ray.intersectObject(mesh).length,0);
  }
  volume.dispose();
});

test('both terminal rings embed under support and source shoreline corridor is invariant',()=>{
  const volume=new NiijimaScarpVolume(ground,source),p=volume.geometry.getAttribute('position');
  for(const station of [0,volume.diagnostics.sections-1])for(let j=0;j<111;j++){
    const k=station*111+j,x=p.getX(k),z=p.getZ(k);
    assert.ok(p.getY(k)<ground.heightAt(x,z),`unburied endpoint ${station}/${j}`);
  }
  for(let z=-1080;z<=-500;z+=5){const x=niijimaShoreStation(source,z,12);const h=source.refinedHeightAt(x,z);assert.ok(Math.abs(niijimaScarpApronHeight(source,x,z,h)-h)<1e-8);}
  volume.dispose();
});
