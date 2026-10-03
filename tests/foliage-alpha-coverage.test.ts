import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {representativeLeaves,sampleLeafAlpha,type LeafAlphaLayer} from '../src/world/foliage-coverage.ts';
const identity=[1,0,0,0,1,0,0,0,1];
test('alpha sampling respects RGB green, diffuse alpha, matrix, flip, wrap and product cutoff',()=>{
 const layer:LeafAlphaLayer={width:2,height:2,data:new Uint8Array([0,255,0,128,0,0,0,255,0,0,0,255,0,255,0,128]),component:1,uvs:new Float32Array(),matrix:identity,flipY:false,wrapS:1001,wrapT:1001};
 assert.equal(sampleLeafAlpha(layer,.25,.25),1);assert.equal(sampleLeafAlpha({...layer,flipY:true},.25,.25),0);
 assert.equal(sampleLeafAlpha({...layer,wrapS:1000},1.25,.25),1);assert.equal(sampleLeafAlpha({...layer,wrapS:1002},1.25,.25),0);
 assert.equal(sampleLeafAlpha({...layer,matrix:[1,0,0,0,1,0,.5,0,1]},.25,.25),0);
 assert.equal(sampleLeafAlpha({...layer,component:3},.25,.25),128/255);
 const p=new Float32Array([0,0,0,1,0,0,0,1,0]),ix=new Uint32Array([0,1,2]),uvs=new Float32Array([.25,.25,.25,.25,.25,.25]);
 const a={...layer,uvs};assert.ok(representativeLeaves(p,ix,1,16,{layers:[a,{...a,component:3}],threshold:.38,opacity:1}).candidatePixels[2]>0);
 assert.equal(representativeLeaves(p,ix,1,16,{layers:[a,{...a,component:3}],threshold:.38,opacity:.5}).candidatePixels[2],0);
});
// PNG decoder for local evidence only: 8-bit RGB/RGBA/gray, all five scanline filters.
function png(data:Buffer){let w=0,h=0,ch=0,depth=8;const chunks:Buffer[]=[];for(let o=8;o<data.length;){const len=data.readUInt32BE(o),type=data.toString('ascii',o+4,o+8),b=data.subarray(o+8,o+8+len);if(type==='IHDR'){w=b.readUInt32BE(0);h=b.readUInt32BE(4);depth=b[8];assert.ok(depth===8||depth===16);ch=({0:1,2:3,4:2,6:4} as Record<number,number>)[b[9]];assert.ok(ch);assert.equal(b[12],0);}if(type==='IDAT')chunks.push(b);o+=len+12;}
 const channels=ch;ch*=depth/8;const raw=inflateSync(Buffer.concat(chunks)),scan=new Uint8Array(w*h*ch),rgba=new Uint8Array(w*h*4);let o=0;
 const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<h;y++){const filter=raw[o++];for(let x=0;x<w*ch;x++){const i=y*w*ch+x,a=x>=ch?scan[i-ch]:0,b=y?scan[i-w*ch]:0,c=y&&x>=ch?scan[i-w*ch-ch]:0;scan[i]=(raw[o++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 for(let i=0;i<w*h;i++){const step=depth/8;rgba[i*4]=scan[i*ch];rgba[i*4+1]=channels<=2?scan[i*ch]:scan[i*ch+step];rgba[i*4+2]=channels<=2?scan[i*ch]:scan[i*ch+2*step];rgba[i*4+3]=channels===4?scan[i*ch+3*step]:channels===2?scan[i*ch+step]:255;}return {width:w,height:h,data:rgba};}
test('packaged near GLB photo alpha coverage compared against geometric selection, same axes',()=>{
 for(let k=0;k<3;k++){
 const glb=readFileSync(new URL(`../src/assets/foliage/cc0/canopy/canopy${k}-lod-1k.glb`,import.meta.url)),len=glb.readUInt32LE(12),j=JSON.parse(glb.subarray(20,20+len).toString()),binary=28+len;
 const node=j.nodes.find((n:any)=>n.name===`canopy${k}_near_0`),primitive=j.meshes[node.mesh].primitives.find((p:any)=>j.materials[p.material].name.includes('leaves'));
 function attribute(id:number){const a=j.accessors[id],v=j.bufferViews[a.bufferView],n=a.type==='VEC3'?3:a.type==='VEC2'?2:1,bytes=a.componentType===5123?2:4,stride=v.byteStride??n*bytes,offset=binary+(v.byteOffset??0)+(a.byteOffset??0);return Array.from({length:a.count*n},(_,i)=>{const o=offset+Math.floor(i/n)*stride+i%n*bytes;return a.componentType===5126?glb.readFloatLE(o):bytes===2?glb.readUInt16LE(o):glb.readUInt32LE(o);});}
 const positions=new Float32Array(attribute(primitive.attributes.POSITION)),indices=new Uint32Array(attribute(primitive.indices)),uvs=new Float32Array(attribute(primitive.attributes.TEXCOORD_0));
 const alpha=png(readFileSync(new URL(`../src/assets/foliage/cc0/canopy/canopy${k}-leaf-alpha-1k.png`,import.meta.url)));
 const mat=j.materials[primitive.material],map=j.textures[mat.pbrMetallicRoughness.baseColorTexture.index],im=j.images[map.source];
 assert.equal(im.mimeType,"image/jpeg"); // JPEG diffuse has alpha=1.
 const diffuse={width:1,height:1,data:new Uint8Array([255,255,255,255])};
 const sampling={layers:[{...alpha,uvs,component:1 as const,matrix:identity,flipY:false,wrapS:1001,wrapT:1001},{...diffuse,uvs,component:3 as const,matrix:identity,flipY:false,wrapS:1000,wrapT:1000}],threshold:.38,opacity:1};
 for(const budget of [720,1440,2880]){
 const geometric=representativeLeaves(positions,indices,budget,128),aware=representativeLeaves(positions,indices,budget,128,sampling);
 // Re-evaluate selected indices against original bounding domain by retaining full positions.
 const oldPhoto=representativeLeaves(positions,geometric.indices,budget,128,sampling);
 assert.ok(aware.candidatePixels.every((n,i)=>n<=aware.originalPixels[i]));
 console.log(JSON.stringify({canopy:k,budget,sourceTriangles:indices.length/3,geometricOriginal:geometric.originalPixels,geometricSelected:geometric.candidatePixels,photoOriginal:aware.originalPixels,photoGeometricSelection:oldPhoto.candidatePixels,photoAwareSelection:aware.candidatePixels,ratio:aware.candidatePixels.map((v,i)=>v/aware.originalPixels[i])}));
 }
 }
});

test('alpha-aware selection rejects invisible components while default is identical',()=>{
 const positions=new Float32Array([0,0,0,3,0,0,0,3,0,4,0,0,5,0,0,4,1,0]),indices=new Uint32Array([0,1,2,3,4,5]);
 const layer:LeafAlphaLayer={width:2,height:1,data:new Uint8Array([0,0,0,255,0,255,0,255]),component:1,uvs:new Float32Array([.25,.5,.25,.5,.25,.5,.75,.5,.75,.5,.75,.5]),matrix:identity,flipY:false,wrapS:1001,wrapT:1001};
 assert.deepEqual(Array.from(representativeLeaves(positions,indices,1,32).indices),[0,1,2]);
 assert.deepEqual(Array.from(representativeLeaves(positions,indices,1,32,{layers:[layer],threshold:.38,opacity:1}).indices),[3,4,5]);
});
