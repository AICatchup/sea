import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createServer} from 'vite';
function native(prefix:string){
 const file=readFileSync(new URL(`../src/assets/foliage/cc0/${prefix==='shrub'?'shrub-lod-1k.glb':`canopy/${prefix}-lod-1k.glb`}`,import.meta.url));
 const length=file.readUInt32LE(12),j=JSON.parse(file.subarray(20,20+length).toString()),offset=28+length;
 return [0,1,2].map(v=>{
 const node=j.nodes.find((n:{name:string})=>n.name===`${prefix}_near_${prefix==='shrub'?v:0}`);
 const parts=j.meshes[node.mesh].primitives.map((p:{attributes:{POSITION:number};material:number})=>{
 const a=j.accessors[p.attributes.POSITION],b=j.bufferViews[a.bufferView],array=new Float32Array(a.count*3);
 for(let i=0;i<array.length;i++)array[i]=file.readFloatLE(offset+(b.byteOffset??0)+(a.byteOffset??0)+i*4);
 const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(array,3));
 const material=new THREE.MeshStandardMaterial();material.name=j.materials[p.material].name??'';
 material.userData.foliageRole=prefix==='shrub'||material.name.includes('leaves')?'leaves':material.name.includes('branches')?'branches':'trunk';return {geometry,material};
 });return {parts,triangles:0};});
}
test('native crown support uses baked bounds and conservative leaf envelope on terrain',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
 const {crownSupportedPlacements,soilPocket}=await server.ssrLoadModule('/src/world/crown-support.ts');
 const {IslandElevation}=await server.ssrLoadModule('/src/world/geodata.ts');
 const ground=new IslandElevation(true,true,true);
 const pines=['canopy0','canopy1','canopy2'].map(p=>native(p)[0]),shrubs=native('shrub');
 const result=crownSupportedPlacements(ground,pines,shrubs);
 assert.ok(result.diagnostics.accepted>0);assert.ok(result.diagnostics.leafClearanceMin>=.034999);
 assert.ok(!soilPocket(ground,-36,27));assert.ok(!soilPocket({heightAt:()=>1},120,90));
 assert.ok(!soilPocket({heightAt:(x:number)=>20+x*2},120,90));
 const repeat=crownSupportedPlacements(ground,pines,shrubs);
 assert.deepEqual(result.trees.map((a:THREE.Matrix4[])=>a.map(m=>m.elements)),repeat.trees.map((a:THREE.Matrix4[])=>a.map(m=>m.elements)));
 console.log(JSON.stringify(result.diagnostics));
 }finally{await server.close();}
});
test('false crown support freezes V20 placements',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 const {AssetWorld}=await server.ssrLoadModule('/src/world/assets.ts');
 const ground={heightAt:(x:number,z:number)=>Math.hypot(x,z)<100?20+x*.1:-10};
 const a=new AssetWorld(ground,{canopyContinuity:true}),b=new AssetWorld(ground,{canopyContinuity:true,crownSupport:false});
 try{for(const key of ['pineField','shrubField'])assert.deepEqual(a[key].plants.map((p:{matrix:THREE.Matrix4})=>p.matrix.elements),b[key].plants.map((p:{matrix:THREE.Matrix4})=>p.matrix.elements));}
 finally{a.dispose();b.dispose();await server.close();}
});

