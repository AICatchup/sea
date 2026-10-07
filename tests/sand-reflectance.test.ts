import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {paleSandReflectance,SAND_REFLECTANCE,SAND_REFLECTANCE_GLSL} from '../src/world/sand-reflectance.ts';
import {loadSandTextures,SAND_SURFACE} from '../src/world/sand-material.ts';
import {makeTerrainMaterial,makeCliffMaterial} from '../src/world/coast-material.ts';
import {receiverMaterialGLSL} from '../src/ocean/receiver-bridge.ts';

test('pale sand retains ordered grain contrast with bounded diffuse reflectance and darker wet response',()=>{
 const m=SAND_REFLECTANCE.sourceLinearLuma,low=paleSandReflectance([m*.4,m*.4,m*.4]),mid=paleSandReflectance([m,m,m]),high=paleSandReflectance([m*3,m*3,m*3]);
 assert.deepEqual(mid,SAND_REFLECTANCE.dryTarget);
 for(let i=0;i<3;i++){assert.ok(low[i]<mid[i]&&mid[i]<high[i]);assert.ok(high[i]<=.88);assert.ok(mid[i]*SAND_SURFACE.wetAlbedoMultiplier<mid[i]);}
 assert.ok(mid[0]/low[0]<2.5,'a dark source grain is not simply multiplied into a clipped white plate');
 assert.throws(()=>paleSandReflectance([NaN,0,0]),/Finite/);assert.throws(()=>paleSandReflectance([-1,0,0]),/Finite/);
});

test('direct strand and refracted bed share the same reflectance function while normals/UV and cliff classification stay intact',()=>{
 const appearance={value:0},sand=loadSandTextures(8,appearance),detail=new THREE.DataTexture(),atlas=new THREE.Texture();
 const ground=makeTerrainMaterial(detail,atlas,sand,true),cliff=makeCliffMaterial(ground);
 const compile=(material:THREE.Material)=>{const s={uniforms:{} as Record<string,unknown>,vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(s as never,{} as never);return s;};
 try{
  const a=compile(ground),b=compile(cliff);
  assert.equal(a.uniforms.uSandAppearance,appearance);assert.equal(b.uniforms.uSandAppearance,appearance);
  assert.ok(a.fragmentShader.includes(SAND_REFLECTANCE_GLSL));assert.ok(receiverMaterialGLSL.includes(SAND_REFLECTANCE_GLSL));
  assert.match(a.fragmentShader,/sandColor = mix\(sandColor, paleSandReflectance\(sandPhoto\), uSandAppearance\)/);
  assert.match(receiverMaterialGLSL,/paleSandReflectance\(albedo\)/);
  assert.match(b.fragmentShader,/float sandMix = 0.0/);assert.match(a.fragmentShader,/sandViewNormal, sandMix \* uSandReady/);
  assert.equal(sand.albedo.colorSpace,THREE.SRGBColorSpace);assert.equal(sand.normalGL.colorSpace,THREE.NoColorSpace);
  appearance.value=1;assert.equal((a.uniforms.uSandAppearance as typeof appearance).value,1);
 }finally{ground.dispose();cliff.dispose();detail.dispose();atlas.dispose();sand.textures.forEach(t=>t.dispose());}
});
