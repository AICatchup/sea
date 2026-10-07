import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNiijimaCliffSkin} from '../src/world/niijima-cliff-skin.ts';
const ground={heightAt(x:number,z:number){return 1+Math.max(0,Math.min(65,(6000-x)*1.8))+Math.sin(z/37)*.15;}};
const options={zMin:-100,zMax:20,eastX:6030,westX:5900,alongZ:1.25,faceSteps:64,chunkLength:64};
function make(){const material=new THREE.MeshStandardMaterial();return {...createNiijimaCliffSkin(ground,material,options),material};}
test('finite continuous volume stays in geometry and relief budgets',()=>{
 const skin=make();assert.ok(skin.geometries.length>0);assert.ok(skin.geometries.length<=16);assert.ok(skin.diagnostics.frontTriangles<=260000);assert.ok(skin.diagnostics.maxRelief<=.25);
 for(const g of skin.geometries){for(const name of ['position','normal','uv']){const a=g.getAttribute(name);for(const v of a.array)assert.ok(Number.isFinite(v));}assert.ok(g.boundingSphere!.radius>0);}
 skin.dispose();skin.material.dispose();
});
test('closed manifold has exactly two opposing uses of every edge',()=>{
 const skin=make();for(const g of skin.geometries){const index=g.index!,edges=new Map<string,{count:number,sum:number}>();
 for(let i=0;i<index.count;i+=3)for(let k=0;k<3;k++){const a=index.getX(i+k),b=index.getX(i+(k+1)%3),key=a<b?`${a},${b}`:`${b},${a}`,e=edges.get(key)??{count:0,sum:0};e.count++;e.sum+=a<b?1:-1;edges.set(key,e);}
 for(const e of edges.values()){assert.equal(e.count,2);assert.equal(e.sum,0);}}
 skin.dispose();skin.material.dispose();
});
test('front winds east and back winds west, with nonzero actual thickness',()=>{
 const skin=make();for(const g of skin.geometries){const p=g.getAttribute('position'),idx=g.index!,n=g.userData.frontTriangleCount;
 const normalX=(i:number)=>{const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);return(p.getY(b)-p.getY(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getY(c)-p.getY(a));};
 for(let i=0;i<n*3;i+=3)assert.ok(normalX(i)>0);
 for(let i=n*3;i<n*6;i+=3)assert.ok(normalX(i)<0);
 const count=g.userData.frontVertexCount;for(let i=0;i<count;i++)assert.ok(p.getX(i)-p.getX(i+count)>.09);}
 skin.dispose();skin.material.dispose();
});
test('DEM source bounds remain intact, back and end/bottom caps are buried',()=>{
 const skin=make();assert.ok(skin.diagnostics.minBackBurial>=.08);assert.ok(skin.diagnostics.minBoundaryBurial>=.015);
 for(const g of skin.geometries){const p=g.getAttribute('position'),count=g.userData.frontVertexCount,source=g.userData.sourcePoints as number[];
 for(let i=0;i<count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),sx=source[i*3],sy=source[i*3+1];assert.ok(x-sx<=.251);assert.ok(Math.abs(y-sy)<=.36);assert.ok(y>2.5);assert.ok(y<=180.36);assert.ok(ground.heightAt(p.getX(i+count),z)-p.getY(i+count)>=.079);
 if(z===g.boundingBox!.min.z||z===g.boundingBox!.max.z||sy===3)assert.ok(ground.heightAt(x,z)-y>.014);}}
 skin.dispose();skin.material.dispose();
});
test('borrowed material, texture, shader are unchanged; dispose is owned and idempotent',()=>{
 const material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();material.map=texture;const hook=material.onBeforeCompile;let materialDisposals=0,textureDisposals=0,geometryDisposals=0;material.addEventListener('dispose',()=>materialDisposals++);texture.addEventListener('dispose',()=>textureDisposals++);
 const skin=createNiijimaCliffSkin(ground,material,options);for(const obj of skin.group.children){assert.equal((obj as THREE.Mesh).material,material);assert.equal(obj.userData.worldSolid,true);assert.equal(obj.userData.recon_part,'shiromama-cliff-detail');}
 for(const g of skin.geometries)g.addEventListener('dispose',()=>geometryDisposals++);skin.dispose();skin.dispose();assert.equal(geometryDisposals,skin.geometries.length);assert.equal(materialDisposals,0);assert.equal(textureDisposals,0);assert.equal(material.map,texture);assert.equal(material.onBeforeCompile,hook);assert.equal(skin.group.children.length,0);
});
test('flat, invalid or absent cliff returns empty group without fallback',()=>{
 const material=new THREE.MeshStandardMaterial();for(const h of [()=>1,()=>NaN,()=>5]){const skin=createNiijimaCliffSkin({heightAt:h},material,options);assert.equal(skin.group.children.length,0);assert.equal(skin.diagnostics.meshes,0);skin.dispose();}material.dispose();
});
test('full default coastline fits the budget and short steep cliffs keep positive winding',()=>{
 const material=new THREE.MeshStandardMaterial(),full=createNiijimaCliffSkin(ground,material);
 assert.ok(full.diagnostics.meshes>0);assert.ok(full.diagnostics.meshes<=16);assert.ok(full.diagnostics.frontTriangles<=260000);assert.ok(full.diagnostics.maxRelief<=.25);full.dispose();
 const short=createNiijimaCliffSkin({heightAt(x){return 1+Math.max(0,Math.min(10,(6000-x)*2));}},material,{...options,faceSteps:180});
 assert.ok(short.geometries.length>0);
 for(const g of short.geometries){const p=g.getAttribute('position'),idx=g.index!;for(let i=0;i<g.userData.frontTriangleCount*3;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);assert.ok((p.getY(b)-p.getY(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getY(c)-p.getY(a))>0);}}
 short.dispose();material.dispose();
});
