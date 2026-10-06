import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ReceiverBridge,type ReceiverDynamicWriter} from '../src/ocean/receiver-bridge.ts';

function canvasStub(){
 return {width:0,height:0,getContext:()=>({clearRect(){},drawImage(){},putImageData(){},createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:()=>({data:new Uint8ClampedArray(512*512*4)})})};
}
test('GPU dynamic texture is borrowed across CPU fallback and bridge disposal',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{value:{createElement:canvasStub},configurable:true});
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();scene.add(new THREE.Mesh(geometry,material));scene.updateMatrixWorld(true);
 const sand=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),gpuTexture=new THREE.Texture();let useGPU=true,gpuDisposed=0,cpuDisposed=0;
 gpuTexture.addEventListener('dispose',()=>gpuDisposed++);
 const writer:ReceiverDynamicWriter={compose:(prefix:Float32Array)=>({texture:gpuTexture,extraDataOffset:prefix.length/4,texels:prefix.length/4+1})};
 const bridge=new ReceiverBridge(scene,()=>true,16384,256,sand,{extraDynamicData:()=>new Float32Array([11,22,33,44]),dynamicWriter:()=>useGPU?writer:undefined});
 try{
  assert.equal(bridge.diagnostics.available,true,bridge.diagnostics.reason);assert.equal(bridge.uniforms.receiverDynamic.value,gpuTexture);
  useGPU=false;assert.equal(bridge.sync(),true);const cpu=bridge.uniforms.receiverDynamic.value as THREE.DataTexture;
  assert.notEqual(cpu,gpuTexture);assert.equal(bridge.diagnostics.dynamicBackend,'cpu');cpu.addEventListener('dispose',()=>cpuDisposed++);
  const offset=bridge.uniforms.receiverExtraDataOffset.value*4;assert.deepEqual(Array.from((cpu.image.data as Float32Array).subarray(offset,offset+4)),[11,22,33,44]);
  useGPU=true;assert.equal(bridge.sync(),true);assert.equal(bridge.uniforms.receiverDynamic.value,gpuTexture);
  writer.compose=()=>null;assert.equal(bridge.sync(),false);assert.equal(bridge.uniforms.receiverAvailable.value,0);
  bridge.dispose();bridge.dispose();assert.equal(cpuDisposed,1);assert.equal(gpuDisposed,0);
 }finally{bridge.dispose();gpuTexture.dispose();sand.dispose();material.dispose();geometry.dispose();if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}
});
