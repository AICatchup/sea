import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkinnedReceivers } from '../src/ocean/skinned-receivers.ts';
import { FirstPersonBody } from '../src/world/player-body.ts';
import type { AdventureState } from '../src/world/contracts.ts';
import { skinnedReceiverTraceGLSL } from '../src/ocean/skinned-receivers-glsl.ts';

function fixture() {
  const g=new THREE.BoxGeometry(2,2,2),p=g.getAttribute('position');
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(p.count*4),4));
  const weights=new Float32Array(p.count*4);for(let i=0;i<p.count;i++)weights[i*4]=1;
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const bone=new THREE.Bone(),mesh=new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial());mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.position.z=-5;mesh.updateMatrixWorld(true);mesh.skeleton.update();return {mesh,bone,g};
}
test('unchanged posed buffers skip refit while changed pose and replaced attributes remain authoritative',()=>{
 const {mesh,bone,g}=fixture(),r=new SkinnedReceivers(mesh),refits=r.diagnostics.refits;
 r.update();assert.equal(r.diagnostics.refits,refits);assert.equal(r.diagnostics.skipped,1);
 bone.rotation.y=.2;mesh.updateMatrixWorld(true);mesh.skeleton.update();r.update();assert.equal(r.diagnostics.refits,refits+1);
 const positions=g.getAttribute('position');g.setAttribute('position',positions.clone());r.update();assert.equal(r.diagnostics.available,false);
 r.dispose();g.dispose();(mesh.material as THREE.Material).dispose();
});
// Independent source-geometry oracle: Three's applyBoneTransform, then Ray.intersectTriangle.
function oracle(mesh: THREE.SkinnedMesh, origin: THREE.Vector3, dir: THREE.Vector3, max=100) {
  const g=mesh.geometry,p=g.getAttribute('position'),points:THREE.Vector3[]=[];
  for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i);mesh.applyBoneTransform(i,v);points.push(v.applyMatrix4(mesh.matrixWorld));}
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];const ray=new THREE.Ray(origin,dir),hit=new THREE.Vector3();let closest=max;
  const count=g.index?.count??p.count,groups=Array.isArray(mesh.material)?g.groups:[{start:0,count,materialIndex:0}];
  for(const group of groups){const m=materials[group.materialIndex??0];if(m.transparent||m.opacity!==1||m.alphaTest>0)continue;for(let j=group.start;j<group.start+group.count;j+=3){const ids=[0,1,2].map(k=>g.index?g.index.getX(j+k):j+k);if(ray.intersectTriangle(points[ids[0]],points[ids[1]],points[ids[2]],false,hit)){const d=hit.distanceTo(origin);if(d>=1e-5&&d<closest)closest=d;}}}
  return closest<max?closest:null;
}
function packedHit(r: SkinnedReceivers,origin:THREE.Vector3,dir:THREE.Vector3,max=100) {
  const data=r.packed.data,stack=[r.packed.root],ray=new THREE.Ray(origin,dir),point=new THREE.Vector3();let closest=max;
  while(stack.length){const n=stack.pop()!*12,box=new THREE.Box3(new THREE.Vector3().fromArray(data,n),new THREE.Vector3().fromArray(data,n+4));if(!ray.intersectsBox(box))continue;if(!data[n+9]){stack.push(data[n+3],data[n+7]);continue;}for(let i=0;i<data[n+9];i++){const t=(r.packed.triangleOffset+(data[n+8]+i)*12)*4;if(data[t+3]<0)continue;if(ray.intersectTriangle(new THREE.Vector3().fromArray(data,t),new THREE.Vector3().fromArray(data,t+4),new THREE.Vector3().fromArray(data,t+8),false,point)){const d=point.distanceTo(origin);if(d>=1e-5&&d<closest)closest=d;}}}
  return closest<max?closest:null;
}
test('posed refit preserves allocations, nearest double-sided hits, bind modes and negative/nonuniform transforms',()=>{
  const {mesh,bone,g}=fixture(),r=new SkinnedReceivers(mesh,{leafSize:1});assert.ok(r.diagnostics.available,r.diagnostics.reason);const data=r.packed.data,index=g.index,mat=mesh.material;
  for(const mode of ['attached','detached'] as const)for(const scale of [new THREE.Vector3(1,1,1),new THREE.Vector3(-2,3,.5)]) {
    mesh.bindMode=mode;mesh.scale.copy(scale);bone.rotation.y=.34;mesh.updateMatrixWorld(true);mesh.skeleton.update();r.update();assert.ok(r.diagnostics.available,r.diagnostics.reason);
    for(const origin of [new THREE.Vector3(),new THREE.Vector3(0,0,-5)]){const dir=new THREE.Vector3(0,0,-1),expected=oracle(mesh,origin,dir),hit=r.traceCPU(origin,dir,100);assert.ok(expected!==null&&hit);assert.ok(Math.abs(hit.distance-expected)<1e-5);assert.ok(Math.abs(packedHit(r,origin,dir)!-expected)<1e-5);assert.ok(Math.abs(hit.normal.dot(hit.tangent))<1e-7);assert.ok(Math.abs(hit.normal.dot(hit.bitangent))<1e-7);assert.ok(hit.normal.dot(dir)<=0);}
  }
  assert.equal(r.packed.data,data);assert.equal(r.diagnostics.rebuilds,1);assert.equal(g.index,index);assert.equal(mesh.material,mat);assert.ok(r.diagnostics.refits>1);mesh.scale.x=0;mesh.updateMatrixWorld(true);mesh.skeleton.update();r.update();assert.equal(r.diagnostics.available,false);assert.equal(r.traceCPU(new THREE.Vector3(),new THREE.Vector3(0,0,-1),100),null);
});
test('unsupported morph, alpha, budgets, visibility and borrowed ownership',()=>{
  const {mesh,g}=fixture();let disposals=0;g.addEventListener('dispose',()=>disposals++);const r=new SkinnedReceivers(mesh);mesh.visible=false;r.update();assert.equal(r.traceCPU(new THREE.Vector3(),new THREE.Vector3(0,0,-1),100),null);r.dispose();r.dispose();assert.equal(disposals,0);
  mesh.visible=true;(mesh.material as THREE.Material).transparent=true;const alpha=new SkinnedReceivers(mesh);assert.equal(alpha.diagnostics.excludedSurfaces,12);assert.equal(alpha.diagnostics.triangles,0);
  (mesh.material as THREE.Material).transparent=false;const budget=new SkinnedReceivers(mesh,{maxTriangles:1});assert.equal(budget.diagnostics.available,false);
  g.morphAttributes.position=[g.getAttribute('position') as THREE.BufferAttribute];const morph=new SkinnedReceivers(mesh);assert.equal(morph.diagnostics.available,false);assert.match(morph.diagnostics.reason,/morph/);
  assert.doesNotMatch(skinnedReceiverTraceGLSL,/uniform sampler2D/);assert.match(skinnedReceiverTraceGLSL,/receiverRead\(receiverDynamic/);
});
test('actual FirstPersonBody seven actions, three poses each agree with independent source oracle and packed BVH',()=>{
  const body=new FirstPersonBody(),mesh=body.group.children.find(o=>o instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh,camera=new THREE.PerspectiveCamera();camera.position.set(0,1.64,0);
  const state={mode:'walk',position:new THREE.Vector3(),yaw:0,pitch:0,speed:4,oxygen:100,depth:0,boatPosition:new THREE.Vector3(),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:''} as AdventureState;
  body.update(state,camera,.08,0);const r=new SkinnedReceivers(body.group),data=r.packed.data;assert.ok(r.diagnostics.available,r.diagnostics.reason);assert.equal(mesh.skeleton.bones.length,47);assert.equal(r.materials.length,7);assert.ok(r.diagnostics.triangles>20_000&&r.diagnostics.triangles<50_000);
  let hits=0,maxMs=0;
  for(const action of ['idle','walk','run','swim','dive','helm','climb'] as const)for(let j=0;j<3;j++) {
    state.avatarAction=action;state.gaitPhase=j*2.1;state.immersion=action==='swim'||action==='dive'?1:0;body.update(state,camera,.08,j*.4);r.update();maxMs=Math.max(maxMs,r.diagnostics.timeMs);assert.ok(r.diagnostics.available,r.diagnostics.reason);
    const center=new THREE.Box3().setFromArray(mesh.geometry.getAttribute('position').array).getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    for(const [origin,dir] of [[camera.position.clone(),new THREE.Vector3(0,-1,0)],[center.clone().add(new THREE.Vector3(2,0,0)),new THREE.Vector3(-1,0,0)]]) {
      const expected=oracle(mesh,origin,dir),actual=r.traceCPU(origin,dir,100),packed=packedHit(r,origin,dir);assert.equal(actual===null,expected===null);assert.equal(packed===null,expected===null);if(expected!==null){hits++;assert.ok(Math.abs(actual!.distance-expected)<2e-5,`${action} ${j}`);assert.ok(Math.abs(packed!-expected)<2e-5);}
    }
  }
  assert.ok(hits>=21);assert.equal(r.packed.data,data);assert.equal(r.diagnostics.rebuilds,1);assert.equal(r.diagnostics.refits,22);
  console.log(JSON.stringify({skinnedBody:r.diagnostics,maxRefitMs:maxMs,oracleHits:hits}));r.dispose();body.dispose();
});
