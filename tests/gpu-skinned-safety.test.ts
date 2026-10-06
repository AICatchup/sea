import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {gpuSkinBounds,validateGPUSkinPose} from '../src/ocean/gpu-skinned-safety.ts';
import type {SkinnedGPUExport,SkinnedGPUPose} from '../src/ocean/skinned-receivers.ts';

function fixture(){
 const layout={surfaces:[{source:new Float64Array([-.5,1,0,0,1,0,0,0,0,0,1,0,0,0]),vertexOffset:0,boneOffset:0}],staticPacked:new Float32Array(4),bones:1} as SkinnedGPUExport;
 const pose:SkinnedGPUPose={bones:new Float32Array(new THREE.Matrix4().elements),worlds:new Float32Array(new THREE.Matrix4().makeTranslation(6000,1,-4000).elements),normals:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0]),visible:new Float32Array([1])};
 return {layout,pose,bounds:gpuSkinBounds(layout)};
}
test('GPU fast path accepts ordinary island coordinates and mirrored nonuniform affine transforms',()=>{
 const {bounds,pose}=fixture();assert.doesNotThrow(()=>validateGPUSkinPose(bounds,pose));
 pose.worlds.set(new THREE.Matrix4().makeScale(-2,3,.5).setPosition(6000,2,-4000).elements);
 assert.doesNotThrow(()=>validateGPUSkinPose(bounds,pose));
});
test('invertible projective world with a zero vertex w selects CPU before a GPU draw',()=>{
 const {bounds,pose}=fixture();pose.worlds[3]=2;
 assert.equal(new THREE.Matrix4().fromArray(pose.worlds).determinant()!==0,true);
 assert.throws(()=>validateGPUSkinPose(bounds,pose),/Projective/);
});
test('finite inputs whose intermediate products overflow Float32 are rejected',()=>{
 const {bounds,pose}=fixture();pose.bones[0]=1e25;pose.worlds[0]=1e25;
 assert.throws(()=>validateGPUSkinPose(bounds,pose),/arithmetic/);
 pose.bones[0]=Infinity;assert.throws(()=>validateGPUSkinPose(bounds,pose),/Non-finite/);
});
test('immutable source values cannot silently overflow or underflow during GPU conversion',()=>{
 const {layout}=fixture();layout.surfaces[0].source[0]=1e100;assert.throws(()=>gpuSkinBounds(layout),/represented/);
 layout.surfaces[0].source[0]=1e-100;assert.throws(()=>gpuSkinBounds(layout),/represented/);
});
