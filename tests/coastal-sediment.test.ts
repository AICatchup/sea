import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {inferredSedimentHeight} from '../src/world/niijima-detail.ts';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';
import {IslandElevation} from '../src/world/geodata.ts';
import {loadSandTextures} from '../src/world/sand-material.ts';
import {wetSandUniforms} from '../src/world/coastal-wet-sand.ts';

test('sediment preserves measured land, contact contour, offshore depth and unrelated shores',()=>{
  for(const y of [-.35,0,.2,2,20,160])assert.equal(inferredSedimentHeight(5980,-4200,y,-30),y);
  for(const d of [10,0,-2,-6,-145,-200])assert.equal(inferredSedimentHeight(5980,-4200,-3,d),-3);
  for(const [x,z,y] of [[5500,-4200,-3],[5980,-6500,-3],[5980,-700,-3],[5980,-4200,-10],[5980,-4200,-80]])assert.equal(inferredSedimentHeight(x,z,y,-30),y);
});

test('inferred bars are bounded, deterministic, smooth and interrupted alongshore',()=>{
  let min=0,max=0,gradient=0;const along:number[]=[];
  for(let z=-6200;z<=-1000;z+=10){
    let sectionMax=0;
    for(let d=6;d<145;d+=.5){
      const base=-.2-d*.075,y=inferredSedimentHeight(6000,z,base,-d),delta=y-base;
      assert.equal(y,inferredSedimentHeight(6000,z,base,-d));assert.ok(y<0);
      min=Math.min(min,delta);max=Math.max(max,delta);sectionMax=Math.max(sectionMax,delta);
      const next=inferredSedimentHeight(6000,z,-.2-(d+.1)*.075,-d-.1);
      gradient=Math.max(gradient,Math.abs((next-y)/.1));
    }
    along.push(sectionMax);
  }
  assert.ok(min>=-.22&&max<=.65);assert.ok(max>.25&&min<-.02);
  assert.ok(gradient<.18,'bounded submarine slopes do not form walls');
  assert.ok(along.some(y=>y<.01)&&along.some(y=>y>.25),'longshore gaps avoid one continuous identical ridge');
});

test('wet-sand material borrows the live ocean uniforms without mutating or disposing them',()=>{
  const sand=loadSandTextures(),base=new THREE.MeshStandardMaterial(),coast=new NiijimaCoast(new IslandElevation(),base,{sand});
  const water=wetSandUniforms(),long=new THREE.Texture();water.uLongWaves.value=long;water.uBathyResolution.value.set(2049,2049);
  coast.bindWaterSurface(water);
  const material=(coast.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer);
  assert.equal((shader.uniforms as Record<string,THREE.IUniform>).uLongWaves,water.uLongWaves);
  assert.equal((shader.uniforms as Record<string,THREE.IUniform>).uShoreState,water.uShoreState);
  assert.match(shader.fragmentShader,/sandWaterFilm\(vNiijimaPoint\+vec3\(5500,0,-2000\)\)/);
  let disposed=0;long.addEventListener('dispose',()=>disposed++);coast.dispose();assert.equal(disposed,0);
  long.dispose();sand.textures.forEach(t=>t.dispose());base.dispose();
});
