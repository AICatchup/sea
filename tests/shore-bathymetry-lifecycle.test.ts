import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ShoreSolver} from '../src/ocean/shore-solver.ts';

test('stored water depth is reinitialized when its bathymetry contract changes',()=>{
  const modes:number[]=[];
  const renderer={xr:{enabled:false},extensions:{has:()=>true},getRenderTarget:()=>null,setRenderTarget:()=>{},
    render:(scene:THREE.Scene)=>modes.push(((scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uMode.value)} as unknown as THREE.WebGLRenderer;
  const solver=new ShoreSolver(renderer,{resolution:16,span:192});
  const first=new THREE.Texture(),second=new THREE.Texture(),waves=new THREE.Texture();
  const shared={uBathymetry:{value:first},uBathyBounds:{value:new THREE.Vector4(5000,-1500,512,512)},
    uBathyResolution:{value:new THREE.Vector2(2049,2049)},uBathyTriangulated:{value:1},
    uLongWaves:{value:waves},uShortWaves:{value:waves},uSwell:{value:1},uChoppiness:{value:1}};
  solver.bindUniforms(shared);
  try{
    solver.update(0,5200,-1200);assert.deepEqual(modes,[2]);modes.length=0;
    solver.update(0,5200,-1200);assert.deepEqual(modes,[]);
    solver.update(0,5220,-1200);assert.deepEqual(modes,[1],'ordinary motion may reproject the same bed');modes.length=0;
    shared.uBathymetry.value=second;solver.update(0,5220,-1200);assert.deepEqual(modes,[2],'depth from the previous bed must not become cliff-top water');modes.length=0;
    shared.uBathyBounds.value.x+=64;solver.update(0,5220,-1200);assert.deepEqual(modes,[2]);modes.length=0;
    second.needsUpdate=true;solver.update(0,5220,-1200);assert.deepEqual(modes,[2]);modes.length=0;
    shared.uBathyResolution.value.set(1025,1025);solver.update(0,5220,-1200);assert.deepEqual(modes,[2]);modes.length=0;
    shared.uBathyTriangulated.value=0;solver.update(0,5220,-1200);assert.deepEqual(modes,[2]);
  }finally{solver.dispose();first.dispose();second.dispose();waves.dispose();}
});
