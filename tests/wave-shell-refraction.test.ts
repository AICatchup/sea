import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SceneCompositor} from '../src/ocean/compositor.ts';

test('wave shell reads a separate base-water snapshot and preserves base depth',()=>{
 const land=new THREE.Scene(),water=new THREE.Scene(),base=new THREE.Mesh(),front=new THREE.Group();
 const material=new THREE.ShaderMaterial({uniforms:{uBehindWater:{value:null},uBehindWaterReady:{value:0}}});front.add(new THREE.Mesh(new THREE.PlaneGeometry(),material));water.add(base,front);
 let target:THREE.WebGLRenderTarget|null=null;const draws:{base:boolean;front:boolean;clear:boolean;target:unknown}[]=[];
 const renderer={autoClear:true,setClearColor(){},setRenderTarget(t:THREE.WebGLRenderTarget|null){target=t;},render(s:THREE.Scene){if(s===water)draws.push({base:base.visible,front:front.visible,clear:this.autoClear,target});}} as unknown as THREE.WebGLRenderer;
 const compositor=new SceneCompositor(renderer,{value:1},{value:0},{value:0});compositor.resize(64,64);
 compositor.render(land,water,new THREE.PerspectiveCamera(),front);
 assert.equal(draws.length,2);assert.deepEqual(draws.map(d=>[d.base,d.front,d.clear]),[[true,false,true],[false,true,false]]);
 assert.equal(draws[0].target,draws[1].target);assert.notEqual(material.uniforms.uBehindWater.value,compositor.waterTarget.texture);
 assert.equal(material.uniforms.uBehindWaterReady.value,1);assert.equal(base.visible,true);assert.equal(front.visible,true);assert.equal(renderer.autoClear,true);
 compositor.dispose();material.dispose();
});

test('foreground draw failure restores visibility and renderer clear state',()=>{
 const land=new THREE.Scene(),water=new THREE.Scene(),base=new THREE.Mesh(),front=new THREE.Group();water.add(base,front);
 const renderer={autoClear:true,setClearColor(){},setRenderTarget(){},render(s:THREE.Scene){if(s===water&&front.visible)throw Error('draw failed');}} as unknown as THREE.WebGLRenderer;
 const compositor=new SceneCompositor(renderer,{value:1},{value:0},{value:0});
 assert.throws(()=>compositor.render(land,water,new THREE.PerspectiveCamera(),front),/draw failed/);
 assert.equal(base.visible,true);assert.equal(front.visible,true);assert.equal(renderer.autoClear,true);compositor.dispose();
});
