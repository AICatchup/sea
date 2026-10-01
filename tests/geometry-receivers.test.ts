import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GeometryReceivers } from '../src/ocean/geometry-receivers.ts';
import { receiverTraceGLSL } from '../src/ocean/geometry-receivers-glsl.ts';
const setup = (...objects: THREE.Object3D[]) => { const scene = new THREE.Scene(); scene.add(...objects); scene.updateMatrixWorld(true); return scene; };
const material = () => new THREE.MeshBasicMaterial();
const include = () => true;
const ray = new THREE.Vector3(0, 0, -1);

test('nearest opaque receiver, inside double-sided hit, miss and UV', () => {
  const near = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material()), far = near.clone(); near.position.z = -4; far.position.z = -8;
  const r = new GeometryReceivers(setup(far, near), { include, leafSize: 1 });
  assert.equal(r.traceCPU(new THREE.Vector3(), ray, 100)?.distance, 3);
  assert.equal(r.traceCPU(new THREE.Vector3(0, 0, -4), ray, 100)?.distance, 1);
  assert.equal(r.traceCPU(new THREE.Vector3(8, 0, 0), ray, 100), null);
  assert.deepEqual(r.traceCPU(new THREE.Vector3(), ray, 100)?.uv.toArray(), [.5, .5]);
  assert.equal(r.diagnostics.triangles, 12, 'shared geometry/material has one BLAS');
});
test('instancing refits count and moving negative nonuniform transforms without triangle upload', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), material(), 3);
  mesh.count = 2; mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(-2, 3, .5).setPosition(0, 0, -4)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, -10));
  const scene = setup(mesh), r = new GeometryReceivers(scene, { include }); const triangles = r.uniforms.receiverTriangles.value, nodes = r.uniforms.receiverNodes.value;
  assert.equal(r.traceCPU(new THREE.Vector3(), ray, 100)?.distance, 3.5);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, -4)); mesh.count = 3; mesh.setMatrixAt(2, new THREE.Matrix4().makeTranslation(0, 0, -2)); scene.updateMatrixWorld(true); r.refit();
  assert.equal(r.traceCPU(new THREE.Vector3(), ray, 100)?.distance, 1);
  assert.equal(r.uniforms.receiverTriangles.value, triangles); assert.equal(r.uniforms.receiverNodes.value, nodes); assert.equal(r.diagnostics.instances, 3); assert.equal(r.diagnostics.rebuilds, 1);
});
test('LOD visibility, new meshes and edited topology trigger appropriate rebuild', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material()); mesh.position.z = -4;
  const scene = setup(mesh), r = new GeometryReceivers(scene, { include }); mesh.visible = false; r.refit(); assert.equal(r.traceCPU(new THREE.Vector3(), ray, 100), null); assert.equal(r.diagnostics.rebuilds, 1);
  const added = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material()); added.position.z = -8; scene.add(added); scene.updateMatrixWorld(true); r.refit(); assert.equal(r.diagnostics.rebuilds, 2); assert.equal(r.traceCPU(new THREE.Vector3(), ray, 100)?.distance, 7);
  added.geometry.getAttribute('position').needsUpdate = true; r.refit(); assert.equal(r.diagnostics.rebuilds, 3);
});
test('group materials, drawRange and nonindexed UV/color layout', () => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,-2, 1,-1,-2, 0,1,-2, -1,-1,-4, 1,-1,-4, 0,1,-4],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0, 1,0, .5,1, 0,0, 1,0, .5,1],2)); g.setAttribute('color',new THREE.Float32BufferAttribute(Array(6).fill([.2,.4,.6]).flat(),3)); g.addGroup(0,3,0); g.addGroup(3,3,1); g.setDrawRange(3,3);
  const a=material(),b=material(),r=new GeometryReceivers(setup(new THREE.Mesh(g,[a,b])),{include}); const hit=r.traceCPU(new THREE.Vector3(),ray,20)!;
  assert.equal(hit.distance,4); assert.equal(r.materials[hit.materialId],b); assert.deepEqual(hit.uv.toArray(),[.5,.5]); assert.ok(Math.abs(hit.vertexColor.r-.2)<1e-7);
  assert.equal(r.packed.triangles[3],hit.materialId); assert.equal(r.packed.triangles[2],-4); assert.equal(r.packed.instances[28],0); assert.equal(r.diagnostics.triangles,1);
});
test('alpha surfaces excluded explicitly and unsupported deformations unavailable', () => {
  const m=material();m.transparent=true; const r=new GeometryReceivers(setup(new THREE.Mesh(new THREE.BoxGeometry(),m)),{include}); assert.equal(r.diagnostics.excludedSurfaces,12); assert.equal(r.traceCPU(new THREE.Vector3(0,0,3),ray,10),null);
  const skinned=new THREE.SkinnedMesh(new THREE.BoxGeometry(),material()); const s=new GeometryReceivers(setup(skinned),{include}); assert.equal(s.diagnostics.available,false); assert.match(s.diagnostics.reason,/skinned/);
});
test('overflow is whole-system unavailable without partial false hits', () => {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material()); const a=new GeometryReceivers(setup(mesh),{include,maxTriangles:2}); assert.equal(a.diagnostics.available,false);assert.match(a.diagnostics.reason,/triangle budget/);assert.equal(a.uniforms.receiverAvailable.value,0);
  const instances=new THREE.InstancedMesh(new THREE.BoxGeometry(),material(),3);const b=new GeometryReceivers(setup(instances),{include,maxInstances:2});assert.equal(b.diagnostics.available,false); assert.match(b.diagnostics.reason,/instance budget/);assert.equal(b.traceCPU(new THREE.Vector3(0,0,3),ray,10),null);
});
test('dispose owns only packed textures, and is idempotent', () => {
  const g=new THREE.BoxGeometry(),m=material(),r=new GeometryReceivers(setup(new THREE.Mesh(g,m)),{include});let gd=0,md=0,td=0;g.addEventListener('dispose',()=>gd++);m.addEventListener('dispose',()=>md++);
  for(const key of ['receiverNodes','receiverTLAS','receiverTriangles','receiverInstances']) (r.uniforms[key].value as THREE.DataTexture).addEventListener('dispose',()=>td++);
  r.dispose();r.dispose();assert.equal(gd,0);assert.equal(md,0);assert.equal(td,4);assert.equal(r.refit(),false);
});
test('GLSL residual contract independent of screen depth, fixed double-sided nearest traversal', () => {
  assert.match(receiverTraceGLSL,/texelFetch/);assert.match(receiverTraceGLSL,/distance>=closest/);assert.match(receiverTraceGLSL,/abs\(determinant\)/);assert.match(receiverTraceGLSL,/receiverTLAS/); assert.doesNotMatch(receiverTraceGLSL,/screen|camera|depthTexture|normalize\(d\)/);
});

// CPU interpretation of exactly the packed GLSL addressing/traversal (independent of traceCPU oracle).
function packedDistance(r: GeometryReceivers, origin: THREE.Vector3, direction: THREE.Vector3): number | null {
  const data=r.packed; const read=(a:Float32Array,i:number)=>Array.from(a.slice(i*4,i*4+4));let closest=100,found=false;
  const walk=(array:Float32Array,root:number,o:THREE.Vector3,d:THREE.Vector3,visit:(start:number,count:number)=>void)=>{
    const stack=[root];while(stack.length){const id=stack.pop()!,lo=read(array,id*3),hi=read(array,id*3+1),info=read(array,id*3+2);let near=0,far=closest;
      for(let k=0;k<3;k++){const axis=['x','y','z'][k] as 'x'|'y'|'z';if(Math.abs(d[axis])<1e-20){if(o[axis]<lo[k]||o[axis]>hi[k])far=-1;}else{const a=(lo[k]-o[axis])/d[axis],b=(hi[k]-o[axis])/d[axis];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}}
      if(far<near)continue;if(!info[1])stack.push(lo[3],hi[3]);else visit(info[0],info[1]);
    }
  };
  walk(data.tlas,r.uniforms.receiverRoot.value as number,origin,direction,(start,count)=>{for(let i=start;i<start+count;i++){const inverse=new THREE.Matrix4().fromArray(Array.from(data.instances.slice(i*32,i*32+16))),o=origin.clone().applyMatrix4(inverse),d=direction.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse));
    walk(data.nodes,data.instances[i*32+28],o,d,(first,n)=>{for(let t=first;t<first+n;t++){const a=new THREE.Vector3(...read(data.triangles,t*12).slice(0,3) as [number,number,number]),b=new THREE.Vector3(...read(data.triangles,t*12+1).slice(0,3) as [number,number,number]),c=new THREE.Vector3(...read(data.triangles,t*12+2).slice(0,3) as [number,number,number]);
      const e1=b.sub(a),e2=c.sub(a),p=d.clone().cross(e2),det=e1.dot(p);if(Math.abs(det)<1e-10)continue;const offset=o.clone().sub(a),u=offset.dot(p)/det,q=offset.cross(e1),v=d.dot(q)/det,distance=e2.dot(q)/det;if(u>=0&&v>=0&&u+v<=1&&distance>=1e-5&&distance<closest){closest=distance;found=true;}
    }});
  }});return found?closest:null;
}
test('packed TLAS/BLAS GLSL interpretation matches independent CPU nearest oracle',()=>{
  const geometry=new THREE.SphereGeometry(1,16,12),mat=material(),mesh=new THREE.InstancedMesh(geometry,mat,4);
  for(let i=0;i<4;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeScale(i===1?-2:1,1,.5+i*.3).setPosition((i-1)*2,0,-5-i*3));
  const r=new GeometryReceivers(setup(mesh),{include,leafSize:1});for(let x=-4;x<=6;x+=.2){const origin=new THREE.Vector3(x,.17,0),expected=r.traceCPU(origin,ray,100)?.distance??null,actual=packedDistance(r,origin,ray);assert.equal(actual===null,expected===null);if(actual!==null&&expected!==null)assert.ok(Math.abs(actual-expected)<1e-5);}
  const interior=new THREE.Vector3(-2,0,-5);assert.ok(Math.abs(packedDistance(r,interior,ray)!-r.traceCPU(interior,ray,100)!.distance)<1e-5);
});
