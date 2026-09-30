import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WorldCollision, withWorldCollision } from '../src/world/world-collision.ts';

const box=(min:number[],max:number[])=>new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max));
test('body sweeps stop horizontal, falling and ascending motion at actual solid faces',()=>{
  const solids=new WorldCollision();solids.addBox(box([1,0,-1],[2,.7,1]));
  assert.equal(solids.sweepBody({x:0,y:0,z:0},{x:3,y:0,z:0}).blocked,true);
  const fall=solids.sweepBody({x:1.5,y:2,z:0},{x:1.5,y:-2,z:0});
  assert.equal(fall.blocked,true);assert.ok(fall.position.y>=.7 && fall.position.y<.704);assert.ok(fall.normal.y>.99);
  const ascent=solids.sweepBody({x:1.5,y:-2,z:0},{x:1.5,y:2,z:0},.25,.5);
  assert.equal(ascent.blocked,true);assert.ok(ascent.position.y<=-.5);assert.ok(ascent.normal.y<-.99);
  assert.equal(solids.sweepBody({x:0,y:.7,z:0},{x:3,y:.7,z:0}).blocked,false,'tangent walking on the top is clear');
});
test('thin rotated meshes retain triangle contact and do not inflate empty AABB corners',()=>{
  const solids=new WorldCollision(),geometry=new THREE.BoxGeometry(4,2,.01),material=new THREE.MeshBasicMaterial();
  const mesh=new THREE.Mesh(geometry,material);mesh.rotation.y=Math.PI/4;mesh.position.y=1;
  const attributes=geometry.getAttribute('position').array.slice();solids.addMesh(mesh);
  assert.equal(solids.sweepBody({x:0,y:0,z:-3},{x:0,y:0,z:3}).blocked,true);
  assert.equal(solids.sweepBody({x:1.4,y:0,z:1},{x:1.4,y:0,z:1.4}).blocked,false,'empty rotated AABB corner stays walkable');
  assert.deepEqual(geometry.getAttribute('position').array,attributes);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
  solids.dispose();assert.equal(disposed,0,'rendering retains ownership of borrowed resources');
  geometry.dispose();material.dispose();
});
test('support contact distinguishes steps, jumpable rock tops and ceilings',()=>{
  const solids=new WorldCollision();solids.addBox(box([1,0,-1],[2,.3,1]));solids.addBox(box([3,0,-1],[4,.7,1]));
  assert.equal(solids.supportHeightAt(1.5,0,0,.32),.3);
  assert.equal(solids.supportHeightAt(3.5,0,0,.32),null);
  assert.equal(solids.supportHeightAt(3.5,0,.8,.02),.7);
  assert.equal(solids.supportHeightAt(3.5,0,-.5,.32),null);
});
test('trunk proxy only occupies its cylinder and registry updates/removals are bounded',()=>{
  const solids=new WorldCollision();const trunk=solids.addCylinder({x:0,y:0,z:0},.3,5);
  assert.equal(solids.sweepBody({x:-1,y:0,z:0},{x:1,y:0,z:0}).blocked,true);
  assert.equal(solids.sweepBody({x:-1,y:0,z:1},{x:1,y:0,z:1}).blocked,false);
  solids.remove(trunk);assert.equal(solids.stats.colliders,0);
  for(let i=0;i<1600;i++)solids.addBox(box([i*20,0,20],[i*20+1,2,21]));
  solids.addBox(box([2,0,-1],[3,2,1]));
  const result=solids.sweepBody({x:0,y:0,z:0},{x:4,y:0,z:0});assert.equal(result.blocked,true);
  assert.ok(solids.stats.lastCandidates<4);assert.ok(solids.stats.lastTriangleTests<1000);
  const geometry=new THREE.BoxGeometry(1,1,1),mesh=new THREE.Mesh(geometry);const id=solids.addMesh(mesh);mesh.position.x=7;
  const replacement=solids.updateMesh(id,mesh);assert.notEqual(replacement,id);assert.equal(solids.remove(id),false);assert.equal(solids.remove(replacement),true);
  solids.clear();assert.equal(solids.stats.triangles,0);assert.equal(solids.stats.hashCells,0);geometry.dispose();
});
test('horizontal swim pose clears under an overhang but meets underwater rocks in every direction',()=>{
  const solids=new WorldCollision();solids.addBox(box([-3,.5,-3],[3,2,3]));solids.addBox(box([3,-4,-3],[4,2,3]));
  const pose={direction:{x:1,y:0,z:0}};
  assert.equal(solids.sweepBody({x:-2,y:-.5,z:0},{x:0,y:-.5,z:0},.25,1.75,pose).blocked,false);
  assert.equal(solids.sweepBody({x:0,y:-.5,z:0},{x:4,y:-.5,z:0},.25,1.75,pose).blocked,true);
  assert.equal(solids.sweepBody({x:0,y:-3,z:0},{x:0,y:3,z:0},.25,1.75,pose).blocked,true);
});
test('ground adapter retains height/navigation and terrain body hooks',()=>{
  const solids=new WorldCollision();const ground=withWorldCollision({heightAt:()=>-20,bodySegmentBlocked:()=>true},solids);
  assert.equal(ground.heightAt(0,0),-20);assert.equal(ground.bodySegmentBlocked!({x:0,y:0,z:0},{x:1,y:0,z:0}),true);
});
test('new solids enclosing a body resolve locally with a strict displacement bound',()=>{
  const solids=new WorldCollision();solids.addBox(box([-1,0,-1],[1,3,1]));
  const from={x:0,y:0,z:0};const next=solids.resolveBody(from,.25,1.75,.08);
  assert.ok(new THREE.Vector3(next.x,next.y,next.z).distanceTo(new THREE.Vector3())<=.080001);
  assert.ok(Math.abs(next.x)+Math.abs(next.z)+next.y>0,'an enclosed spawn is pushed toward a local surface');
  assert.ok(next.y>=0,'grounded overlap correction does not push through the floor');
});

test('shared instances measure radius and support in world metres under rotation, nonuniform and negative scale',()=>{
  const geometry=new THREE.BoxGeometry(1,1,1),mesh=new THREE.Mesh(geometry),solids=new WorldCollision();
  const scales=[new THREE.Vector3(2,1,.4),new THREE.Vector3(-2,.7,.4),new THREE.Vector3(.4,2,3),new THREE.Vector3(2,-.7,.4)];
  for(let i=0;i<scales.length;i++) {
    const scale=scales[i],centre=new THREE.Vector3(i*10,Math.abs(scale.y)*.5,0),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.7);
    const matrix=new THREE.Matrix4().compose(centre,rotation,scale);solids.addMesh(mesh,matrix);
    // Mutating caller matrices must not change the registered immutable transform.
    matrix.makeTranslation(1000,1000,1000);
    const axis=new THREE.Vector3(1,0,0).applyQuaternion(rotation),base=new THREE.Vector3(centre.x,0,centre.z);
    const a=base.clone().addScaledVector(axis,-4),b=base.clone().addScaledVector(axis,4);
    const hit=solids.sweepBody(a,b);assert.equal(hit.blocked,true);
    const along=new THREE.Vector3(hit.position.x,hit.position.y,hit.position.z).sub(base).dot(axis);
    assert.ok(Math.abs(along-(-Math.abs(scale.x)*.5-.25))<.004,`world radius preserved: ${along}`);
    assert.ok(new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z).dot(axis)<-.99);
    const support=solids.supportHeightAt(centre.x,centre.z,Math.abs(scale.y)+.1,.02);
    assert.ok(support!==null && Math.abs(support-Math.abs(scale.y))<1e-8,`reflected top remains upward ${support}`);
  }
  assert.equal(solids.stats.uniqueBVHs,1);assert.equal(solids.stats.storedTriangles,12);assert.equal(solids.stats.triangles,48);
  solids.dispose();assert.equal(solids.stats.uniqueBVHs,0);geometry.dispose();
});

test('geometry revisions and draw ranges retain old snapshots until the final referencing entry is removed',()=>{
  const geometry=new THREE.BoxGeometry(1,1,1),mesh=new THREE.Mesh(geometry),solids=new WorldCollision();
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  const a=solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(0,.5,0)),b=solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(10,.5,0));
  geometry.translate(2,0,0);const c=solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(20,.5,0));
  assert.equal(solids.stats.uniqueBVHs,2);assert.equal(solids.stats.storedTriangles,24);assert.equal(solids.stats.triangles,36);
  assert.equal(solids.sweepBody({x:-2,y:0,z:0},{x:2,y:0,z:0}).blocked,true,'existing entry retains its original snapshot');
  assert.equal(solids.sweepBody({x:21,y:0,z:0},{x:23,y:0,z:0}).blocked,true,'new revision occupies the new actual shape');
  solids.remove(a);assert.equal(solids.stats.uniqueBVHs,2);solids.remove(b);assert.equal(solids.stats.uniqueBVHs,1);
  geometry.setDrawRange(0,6);const partial=solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(30,.5,0));
  assert.equal(solids.stats.uniqueBVHs,2);assert.equal(solids.stats.storedTriangles,14);
  solids.remove(c);assert.equal(solids.stats.storedTriangles,2);solids.remove(partial);assert.equal(solids.stats.storedTriangles,0);
  assert.equal(disposed,0);geometry.dispose();
});

test('unit primitive BVHs share numeric storage and transformed interior pushes remain bounded',()=>{
  const solids=new WorldCollision();
  for(let i=0;i<100;i++) {solids.addCylinder({x:i*10,y:i*.01,z:0},.1+i*.001,3+i*.02);solids.addBox(box([i*10,0,20],[i*10+1,2+i*.01,21]));}
  assert.equal(solids.stats.uniqueBVHs,2);assert.equal(solids.stats.storedTriangles,92);assert.equal(solids.stats.triangles,9200);
  const geometry=new THREE.BoxGeometry(3,4,3),mesh=new THREE.Mesh(geometry),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.9);
  solids.addMesh(mesh,new THREE.Matrix4().compose(new THREE.Vector3(-10,2,0),rotation,new THREE.Vector3(-1,1,.7)));
  const from={x:-10,y:0,z:0},corrected=solids.resolveBody(from,.25,1.75,.08);
  const displacement=new THREE.Vector3(corrected.x+10,corrected.y,corrected.z);
  assert.ok(displacement.length()>0 && displacement.length()<=.080001);assert.ok(corrected.y>=0);
  solids.clear();assert.equal(solids.stats.uniqueBVHs,0);assert.equal(solids.stats.storedTriangles,0);geometry.dispose();
});

test('130 dense actual mesh instances store one 18000-triangle BVH instead of 2.34 million world copies',()=>{
  const geometry=new THREE.SphereGeometry(1,100,91),mesh=new THREE.Mesh(geometry),solids=new WorldCollision(),ids:number[]=[];
  const before=process.memoryUsage(),start=performance.now();
  for(let i=0;i<130;i++) ids.push(solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(i*10,1,0)));
  const buildMs=performance.now()-start,after=process.memoryUsage();
  assert.equal(solids.stats.colliders,130);assert.equal(solids.stats.uniqueBVHs,1);
  assert.equal(solids.stats.storedTriangles,18000);assert.equal(solids.stats.triangles,2340000);
  const hit=solids.sweepBody({x:-3,y:0,z:0},{x:3,y:0,z:0});assert.equal(hit.blocked,true);assert.equal(solids.stats.lastCandidates,1);
  assert.ok(solids.stats.lastTransformedTriangles<=18000,'only one candidate instance gets world triangles');
  console.log(JSON.stringify({sharedCollision:{instances:130,logicalTriangles:solids.stats.triangles,storedTriangles:solids.stats.storedTriangles,uniqueBVHs:solids.stats.uniqueBVHs,
    buildMs:Number(buildMs.toFixed(1)),heapDeltaMiB:Number(((after.heapUsed-before.heapUsed)/1048576).toFixed(2)),rssDeltaMiB:Number(((after.rss-before.rss)/1048576).toFixed(2))}}));
  for(const id of ids.slice(0,-1))solids.remove(id);assert.equal(solids.stats.storedTriangles,18000);
  solids.remove(ids.at(-1)!);assert.equal(solids.stats.uniqueBVHs,0);assert.equal(solids.stats.storedTriangles,0);assert.equal(solids.stats.triangles,0);geometry.dispose();
});

test('the bundled photographic boulder keeps all source triangles while sharing across 130 placements',()=>{
  // CPU-only GLB accessor read; no texture loading, browser or GPU fixture.
  const bytes=readFileSync(new URL('../src/assets/marine/boulder-01-2k.glb',import.meta.url));
  const jsonLength=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8').trim()),binary=28+jsonLength;
  const primitive=document.meshes[0].primitives[0],pa=document.accessors[primitive.attributes.POSITION],ia=document.accessors[primitive.indices];
  const pv=document.bufferViews[pa.bufferView],iv=document.bufferViews[ia.bufferView],stride=pv.byteStride??12;
  assert.equal(pa.componentType,5126);assert.ok(ia.componentType===5123 || ia.componentType===5125);
  const positions=new Float32Array(pa.count*3),indices=new Uint32Array(ia.count);
  for(let i=0;i<pa.count;i++)for(let axis=0;axis<3;axis++) positions[i*3+axis]=bytes.readFloatLE(binary+(pv.byteOffset??0)+(pa.byteOffset??0)+i*stride+axis*4);
  for(let i=0;i<ia.count;i++)indices[i]=ia.componentType===5125 ? bytes.readUInt32LE(binary+(iv.byteOffset??0)+(ia.byteOffset??0)+i*4) : bytes.readUInt16LE(binary+(iv.byteOffset??0)+(ia.byteOffset??0)+i*2);
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3)).setIndex(new THREE.BufferAttribute(indices,1));
  geometry.computeBoundingBox();const bounds=geometry.boundingBox!,dimensions=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3()),unit=2/Math.max(dimensions.x,dimensions.z);
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(unit,unit,unit).multiply(new THREE.Matrix4().makeTranslation(-centre.x,-bounds.min.y,-centre.z)));
  const source=geometry.getAttribute('position').array.slice(),mesh=new THREE.Mesh(geometry),solids=new WorldCollision(),before=process.memoryUsage(),start=performance.now();
  for(let i=0;i<130;i++)solids.addMesh(mesh,new THREE.Matrix4().makeTranslation(i*10,0,0));
  const elapsed=performance.now()-start,after=process.memoryUsage();
  assert.equal(solids.stats.uniqueBVHs,1);assert.equal(solids.stats.storedTriangles,18000);assert.equal(solids.stats.triangles,2340000);
  assert.deepEqual(geometry.getAttribute('position').array,source,'shared BVH never rewrites the scan');
  const hit=solids.sweepBody({x:-2,y:0,z:0},{x:2,y:0,z:0});assert.equal(hit.blocked,true);assert.equal(solids.stats.lastCandidates,1);
  console.log(JSON.stringify({bundledBoulderCollision:{source:'boulder-01-2k.glb',instances:130,storedTriangles:solids.stats.storedTriangles,logicalTriangles:solids.stats.triangles,
    buildMs:Number(elapsed.toFixed(1)),heapDeltaMiB:Number(((after.heapUsed-before.heapUsed)/1048576).toFixed(2)),rssDeltaMiB:Number(((after.rss-before.rss)/1048576).toFixed(2))}}));
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);solids.dispose();assert.equal(disposed,0);assert.equal(solids.stats.storedTriangles,0);geometry.dispose();
});
