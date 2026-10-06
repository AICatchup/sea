import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {resizeReflectionTarget} from '../src/ocean/reflection-target.ts';

test('resize publishes matching colour and depth dimensions before the next reflection render',()=>{
 const depth=new THREE.DepthTexture(537,302,THREE.UnsignedIntType);
 const target=new THREE.WebGLRenderTarget(537,302,{type:THREE.HalfFloatType,depthTexture:depth});
 try{
  for(const [w,h] of [[538,302],[457,257],[538,302],[192,128]]){
   assert.equal(resizeReflectionTarget(target,w,h),true);
   // Water uploads/samples depth on frames where the planar reflection is not rendered.
   assert.equal(depth.image.width,w);assert.equal(depth.image.height,h);
   assert.equal(target.texture.image.width,w);assert.equal(target.texture.image.height,h);
   assert.equal(target.depthTexture,depth,'sampler identity remains valid');
  }
 }finally{target.dispose();depth.dispose();}
});

test('an unchanged size does not invalidate attachments or upload their depth again',()=>{
 const depth=new THREE.DepthTexture(538,302,THREE.UnsignedIntType),target=new THREE.WebGLRenderTarget(538,302,{depthTexture:depth});
 let disposals=0;target.addEventListener('dispose',()=>disposals++);const version=depth.version;
 assert.equal(resizeReflectionTarget(target,538,302),false);assert.equal(disposals,0);assert.equal(depth.version,version);
 target.dispose();depth.dispose();
});
test('a previously stale depth allocation is invalidated even when colour size already matches',()=>{
 const depth=new THREE.DepthTexture(32,16,THREE.UnsignedIntType),target=new THREE.WebGLRenderTarget(32,16,{depthTexture:depth});
 target.setSize(64,24);let invalidated=0;target.addEventListener('dispose',()=>invalidated++);
 assert.equal(resizeReflectionTarget(target,64,24),true);assert.equal(invalidated,1);assert.equal(depth.image.width,64);assert.equal(depth.image.height,24);
 assert.throws(()=>resizeReflectionTarget(target,NaN,24));assert.throws(()=>resizeReflectionTarget(target,0,24));
 target.dispose();depth.dispose();
});
