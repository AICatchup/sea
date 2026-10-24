import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {createReflectionSky,photographicSkyPixelDirection,rotateSkyDirection} from '../src/ocean/photographic-sky.ts';

test('reflection removes the solar disk before downsampling without changing the photographed sky',()=>{
  const w=512,h=256,data=new Float32Array(w*h*4),x=180,y=70;
  for(let i=0;i<data.length;i+=4)data.set([1,2,3,1],i);
  const sun=photographicSkyPixelDirection(x,y,w,h);
  data.set([10000,10000,10000,1],(y*w+x)*4);
  data.set([4,8,12,1],0);
  const original=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);original.flipY=true;
  const result=createReflectionSky(original,rotateSkyDirection(sun,1.7),1.7);
  const image=result.image as {data:Uint16Array;width:number;height:number};
  const pixel=(Math.floor(y/2)*image.width+Math.floor(x/2))*4;
  assert.deepEqual(Array.from(image.data.slice(pixel,pixel+3),v=>THREE.DataUtils.fromHalfFloat(v)),[1,2,3]);
  assert.equal(THREE.DataUtils.fromHalfFloat(image.data[0]),1.75,'cloud radiance outside the solar cone remains in the average');
  assert.equal(data[(y*w+x)*4],10000,'the visible sky retains its sun');
  assert.equal(result.flipY,true);assert.equal(image.width,256);assert.equal(image.height,128);
  result.dispose();original.dispose();
});
