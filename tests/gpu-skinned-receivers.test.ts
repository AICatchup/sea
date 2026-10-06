import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SkinnedReceivers} from '../src/ocean/skinned-receivers.ts';
function fixture(){const g=new THREE.BoxGeometry(),p=g.getAttribute('position');g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(p.count*4),4));const w=new Float32Array(p.count*4);for(let i=0;i<p.count;i++)w[i*4]=2;g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(w,4));const bone=new THREE.Bone(),mesh=new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial());mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.updateMatrixWorld(true);mesh.skeleton.update();return{mesh,g,bone};}
test('GPU export retains unique vertices, unnormalized weights and leaf triangle layout',()=>{const {mesh}=fixture(),r=new SkinnedReceivers(mesh,{leafSize:1}),l=r.exportGPU();assert.equal(l.vertices,mesh.geometry.getAttribute('position').count);assert.equal(l.triangles.length,12);assert.equal(l.surfaces[0].source[10],2);assert.equal(l.staticPacked.length,l.texels*4);assert.ok(l.nodes.every(n=>n.count<=1));for(const t of l.triangles)assert.ok(t.vertices.every(v=>v<l.vertices));assert.equal(r.diagnostics.refits,1);r.exportGPUPose();assert.equal(r.diagnostics.refits,1);});
test('renderer-created padded bone textures retain the same used palette',()=>{
 const {mesh}=fixture(),r=new SkinnedReceivers(mesh),before=r.exportGPUPose().bones.slice();
 mesh.skeleton.computeBoneTexture();mesh.skeleton.update();
 assert.ok(mesh.skeleton.boneMatrices.length>mesh.skeleton.bones.length*16);
 assert.deepEqual(r.exportGPUPose().bones,before);
});
test('pose export preserves normal matrix, visibility and rejects source/singular mutations',()=>{const {mesh,g}=fixture(),r=new SkinnedReceivers(mesh);mesh.scale.set(-2,3,.5);mesh.updateMatrixWorld(true);mesh.skeleton.update();const p=r.exportGPUPose(),expected=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);for(let c=0;c<3;c++)for(let row=0;row<3;row++)assert.ok(Math.abs(p.normals[c*4+row]-expected.elements[c*3+row])<1e-7);mesh.visible=false;assert.equal(r.exportGPUPose().visible[0],0);mesh.scale.x=0;mesh.updateMatrixWorld(true);assert.throws(()=>r.exportGPUPose(),/singular/);mesh.scale.x=1;mesh.updateMatrixWorld(true);g.setAttribute('position',g.getAttribute('position').clone());assert.throws(()=>r.exportGPUPose(),/source/);});
