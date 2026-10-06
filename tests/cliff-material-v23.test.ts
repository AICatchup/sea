import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeTerrainMaterial,makeCliffMaterial} from '../src/world/coast-material.ts';
import {loadSandTextures} from '../src/world/sand-material.ts';

test('rock skin cannot turn into painted grass or sand on a fracture shoulder; texture ownership is shared',()=>{
 const sand=loadSandTextures(),base=makeTerrainMaterial(new THREE.DataTexture(),new THREE.Texture(),sand,true),cliff=makeCliffMaterial(base);
 const compile=(material:THREE.MeshStandardMaterial)=>{const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,{} as never);return shader;};
 const a=compile(base),b=compile(cliff),uniforms=b.uniforms as Record<string,THREE.IUniform>;
 assert.match(b.fragmentShader,/float greenMix = 0.0;/);assert.match(b.fragmentShader,/float sandMix = 0.0;/);
 assert.doesNotMatch(a.fragmentShader,/float greenMix = 0.0;/);
 assert.equal(uniforms.uCoastRockNormal.value,(a.uniforms as Record<string,THREE.IUniform>).uCoastRockNormal.value);
 assert.equal(cliff.userData.ready,base.userData.ready);
 base.onBeforeCompile=()=>{throw new Error('Terrain-only outer wrapper must not be applied twice to the rock material');};
 assert.doesNotThrow(()=>compile(cliff));
 let disposed=0;uniforms.uCoastRockNormal.value.addEventListener('dispose',()=>disposed++);
 cliff.dispose();assert.equal(disposed,0,'borrower must not free a map still used by the terrain');
 base.dispose();assert.equal(disposed,1);sand.textures.forEach(t=>t.dispose());
});
