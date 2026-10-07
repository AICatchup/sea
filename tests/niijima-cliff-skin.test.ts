import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNiijimaCliffSkin,createCliffSurfaceQuery} from '../src/world/niijima-cliff-skin.ts';
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
test('meso carving is bounded, solid and buried with no borrowed-resource changes',()=>{
 const material=new THREE.MeshStandardMaterial(),skin=createNiijimaCliffSkin(ground,material,{...options,meso:true});
 assert.ok(skin.geometries.length>0);assert.ok(skin.diagnostics.maxCarving>.7);assert.ok(skin.diagnostics.maxCarving<=1.4);assert.ok(skin.diagnostics.maxRelief<=.22);assert.ok(skin.diagnostics.frontTriangles<=260000);assert.ok(skin.diagnostics.minBackBurial>=.08);
 for(const g of skin.geometries){const p=g.getAttribute('position'),n=g.userData.frontVertexCount,source=g.userData.sourcePoints as number[];for(let i=0;i<n;i++){assert.ok(source[i*3]-p.getX(i)<=1.401);assert.ok(p.getX(i)-source[i*3]<=.221);assert.ok(p.getX(i+ n)<p.getX(i)-.1);assert.ok(ground.heightAt(p.getX(i+n),p.getZ(i+n))-p.getY(i+n)>=.079);}const edges=new Map<string,number>(),idx=g.index!;for(let i=0;i<idx.count;i+=3)for(let k=0;k<3;k++){const a=idx.getX(i+k),b=idx.getX(i+(k+1)%3),key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)??0)+1);}assert.ok([...edges.values()].every(n=>n===2));}
 skin.dispose();material.dispose();
});
test('meso default coastline stays bounded and legacy default has no replacement mask',()=>{
 const material=new THREE.MeshStandardMaterial(),skin=createNiijimaCliffSkin(ground,material,{meso:true});assert.ok(skin.diagnostics.meshes>0);assert.ok(skin.diagnostics.meshes<=16);assert.ok(skin.diagnostics.frontTriangles<=260000);assert.ok(skin.diagnostics.maxCarving<=1.4);skin.dispose();
 const legacy=createNiijimaCliffSkin(ground,material,options);assert.equal(legacy.surfaceHeightAt(5985,-70),null);assert.equal(legacy.coversOriginalTriangle([{x:5985,y:28,z:-70},{x:5986,y:26,z:-69},{x:5984,y:30,z:-69}]),false);legacy.dispose();material.dispose();
});
test('meso query matches actual front triangles independently via downward ray hits',()=>{
 const material=new THREE.MeshStandardMaterial(),skin=createNiijimaCliffSkin(ground,material,{...options,meso:true}),rayMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();let compared=0;
 for(const g of skin.geometries){const clone=g.clone();clone.setIndex(Array.from(g.index!.array).slice(0,g.userData.frontTriangleCount*3));const mesh=new THREE.Mesh(clone,rayMaterial);mesh.updateMatrixWorld();const p=g.getAttribute('position'),idx=g.index!;
 for(let i=0;i<g.userData.frontTriangleCount*3;i+=129){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2),x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3,h=skin.surfaceHeightAt(x,z);if(h===null)continue;
 ray.set(new THREE.Vector3(x,1000,z),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(mesh,false);assert.ok(hits.length);assert.ok(Math.abs(h-hits[0].point.y)<1e-5);compared++;if(compared>=12)break;}
 clone.dispose();if(compared>=12)break;}assert.ok(compared>=12);skin.dispose();material.dispose();rayMaterial.dispose();
});
test('barycentric query chooses the highest overhang and excludes vertical degenerate faces',()=>{
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,10,0,2,12,0,0,14,2,0,20,0,2,22,0,0,24,2,1,90,0,1,91,1,1,92,2],3));g.setIndex([0,1,2,3,4,5,6,7,8]);g.userData.sourcePoints=Array.from({length:9},()=>[0,10,0]).flat();g.userData.queryStrips=[{z0:0,z1:2,start:0,end:9,minX:0,maxX:2,coreMinX:-1,coreMaxX:3,top:40}];
 const query=createCliffSurfaceQuery([g]);assert.ok(Math.abs(query.surfaceHeightAt(.5,.5)!-21.5)<1e-9);assert.equal(query.surfaceHeightAt(4,.5),null);assert.ok(query.surfaceHeightAt(1,.25)!<30);g.dispose();
});
test('patch borders and low strand return null; mask only accepts wholly interior original triangles',()=>{
 const material=new THREE.MeshStandardMaterial(),skin=createNiijimaCliffSkin(ground,material,{...options,meso:true});
 assert.equal(skin.surfaceHeightAt(5990,options.zMin),null);assert.equal(skin.surfaceHeightAt(5990,options.zMax),null);assert.equal(skin.surfaceHeightAt(6010,-70),null);assert.equal(skin.surfaceHeightAt(NaN,-70),null);
 const tri=[{x:5985,y:28,z:-70},{x:5986,y:26.2,z:-69},{x:5984,y:29.8,z:-69}] as const;assert.equal(skin.coversOriginalTriangle(tri),true);
 assert.equal(skin.coversOriginalTriangle([{...tri[0],z:options.zMin},tri[1],tri[2]]),false);assert.equal(skin.coversOriginalTriangle([{...tri[0],y:2},tri[1],tri[2]]),false);
 skin.dispose();assert.equal(skin.surfaceHeightAt(5985,-70),null);assert.equal(skin.coversOriginalTriangle(tri),false);material.dispose();
});
test('meso vanishes before lower and chunk cutout guards; talus is strongly attenuated',()=>{
 const material=new THREE.MeshStandardMaterial();
 const steep=createNiijimaCliffSkin(ground,material,{...options,faceSteps:144,meso:true});
 let deep=0,ledge=0,guardChecks=0;
 for(const g of steep.geometries){const p=g.getAttribute('position'),s=g.userData.sourcePoints as number[],n=g.userData.frontVertexCount,stride=145,z0=p.getZ(0),z1=p.getZ(n-1);
 for(let i=0;i<n;i++){const row=Math.floor(i/stride),j=i%stride,y=s[i*3+1],z=s[i*3+2],delta=p.getX(i)-s[i*3];if(row===0||row===n/stride-1||j===0||j===144)continue;
 if(y<=10||z<=z0+5||z>=z1-5){assert.ok(Math.abs(delta+.025)<.001);guardChecks++;}
 if(y>18&&y<50&&z>z0+12&&z<z1-12){deep=Math.max(deep,-delta);ledge=Math.max(ledge,delta);}}
 }assert.ok(guardChecks>100);assert.ok(deep>.5);assert.ok(ledge>.025);
 const talus=createNiijimaCliffSkin({heightAt(x){return 1+Math.max(0,Math.min(65,(6000-x)*.5));}},material,{...options,westX:5800,faceSteps:144,meso:true});assert.ok(talus.geometries.length>0);let maxTalus=0;
 for(const g of talus.geometries){const p=g.getAttribute('position'),s=g.userData.sourcePoints as number[],n=g.userData.frontVertexCount,stride=145,z0=p.getZ(0),z1=p.getZ(n-1);for(let i=0;i<n;i++){const y=s[i*3+1],z=s[i*3+2];if(y>18&&y<50&&z>z0+12&&z<z1-12&&i%stride>0&&i%stride<144)maxTalus=Math.max(maxTalus,Math.abs(p.getX(i)-s[i*3]));}}
 assert.ok(maxTalus<.01);assert.ok(maxTalus<deep*.05);steep.dispose();talus.dispose();material.dispose();
});
