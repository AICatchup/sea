import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MeshoptSimplifier} from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

// Reuse the original photographed maps. Only the geometry is regenerated;
// V32's pinned GLBs remain immutable inputs for its cliff reproduction.
const output=process.argv[2];if(!output)throw new Error('Usage: node scripts/rebuild-coast-geometry.mjs OUTPUT_DIRECTORY');
const destination=path.resolve(output),marine=path.resolve(import.meta.dirname,'../src/assets/marine');
await fs.mkdir(destination,{recursive:true});
const receipts=JSON.parse(await fs.readFile(path.join(marine,'provenance.json'),'utf8')).assets;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function original(source){
 const file=path.join(destination,path.basename(source.url));let bytes;
 try{bytes=await fs.readFile(file);}catch{const response=await fetch(source.url);if(!response.ok)throw new Error(`Source ${response.status}: ${source.url}`);bytes=Buffer.from(await response.arrayBuffer());}
 if(bytes.length!==source.bytes||sha(bytes)!==source.sha256)throw new Error(`Pinned source mismatch: ${source.url}`);
 await fs.writeFile(file,bytes);return bytes;
}
await MeshoptSimplifier.ready;
const results=[];
for(const name of receipts.map(r=>r.asset)){
 const receipt=receipts.find(r=>r.asset===name),gltfSource=receipt.sources.find(s=>s.url.endsWith('.gltf')),binSource=receipt.sources.find(s=>s.url.endsWith('.bin'));
 const [jsonBytes,binary]=await Promise.all([original(gltfSource),original(binSource)]),source=JSON.parse(jsonBytes.toString('utf8'));
 if(source.nodes.some(n=>n.matrix||n.translation||n.rotation||n.scale)||source.meshes.length!==1||source.meshes[0].primitives.length!==1)throw new Error('Expected one untransformed coastal scan');
 const primitive=source.meshes[0].primitives[0];
 function array(id){const a=source.accessors[id],v=source.bufferViews[a.bufferView],offset=(v.byteOffset??0)+(a.byteOffset??0),width={SCALAR:1,VEC2:2,VEC3:3}[a.type];if(v.byteStride)throw new Error('Unexpected interleaved source');const buffer=Uint8Array.from(binary.subarray(offset,offset+a.count*width*(a.componentType===5123?2:4))).buffer;return a.componentType===5126?new Float32Array(buffer):a.componentType===5123?new Uint32Array(new Uint16Array(buffer)):new Uint32Array(buffer);}
 const input=array(primitive.indices),positions=array(primitive.attributes.POSITION),normals=array(primitive.attributes.NORMAL),uv=array(primitive.attributes.TEXCOORD_0),vertices=positions.length/3;
 const attributes=new Float32Array(vertices*5);for(let i=0;i<vertices;i++)attributes.set([normals[i*3],normals[i*3+1],normals[i*3+2],uv[i*2],uv[i*2+1]],i*5);
 // No Permissive: an edge may not collapse across a disconnected UV chart.
 const [indices,error]=MeshoptSimplifier.simplifyWithAttributes(input,positions,3,attributes,5,[.1,.1,.1,.4,.4],null,54000,.012,[]);
 const parents=Uint32Array.from({length:vertices},(_,i)=>i),find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 for(let t=0;t<input.length;t+=3){const a=find(input[t]);parents[find(input[t+1])]=a;parents[find(input[t+2])]=a;}
 let crossedCharts=0;for(let t=0;t<indices.length;t+=3)if(find(indices[t])!==find(indices[t+1])||find(indices[t])!==find(indices[t+2]))crossedCharts++;
 if(crossedCharts)throw new Error('A simplified triangle crossed source chart components');
 const previous=await fs.readFile(path.join(marine,receipt.output.file)),oldJsonLength=previous.readUInt32LE(12),old=JSON.parse(previous.subarray(20,20+oldJsonLength).toString('utf8')),oldPrimitive=old.meshes[0].primitives[0];
 const oldArray=id=>{const a=old.accessors[id],v=old.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3}[a.type],offset=28+oldJsonLength+(v.byteOffset??0)+(a.byteOffset??0),b=Uint8Array.from(previous.subarray(offset,offset+a.count*width*(a.componentType===5123?2:4))).buffer;return a.componentType===5126?new Float32Array(b):a.componentType===5123?new Uint16Array(b):new Uint32Array(b);};
 const op=oldArray(oldPrimitive.attributes.POSITION),on=oldArray(oldPrimitive.attributes.NORMAL),ou=oldArray(oldPrimitive.attributes.TEXCOORD_0),oi=oldArray(oldPrimitive.indices);
 const key=(p,n,u,i)=>[p[i*3],p[i*3+1],p[i*3+2],n[i*3],n[i*3+1],n[i*3+2],u[i*2],u[i*2+1]].join(',');
 const oldKeys=Array.from({length:op.length/3},(_,i)=>key(op,on,ou,i)),lookup=new Map(oldKeys.map(k=>[k,-1]));
 for(let i=0;i<vertices;i++){const k=key(positions,normals,uv,i);if(lookup.has(k))lookup.set(k,find(i));}
 const oldCharts=oldKeys.map(k=>lookup.get(k));let previousCrossedCharts=0;
 for(let t=0;t<oi.length;t+=3)if(oldCharts[oi[t]]!==oldCharts[oi[t+1]]||oldCharts[oi[t]]!==oldCharts[oi[t+2]])previousCrossedCharts++;
 if(oldCharts.includes(-1))throw new Error('Previous vertex could not be traced to pinned source');
 const [remap,count]=MeshoptSimplifier.compactMesh(indices),compact=(data,stride)=>{const result=new Float32Array(count*stride);for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)for(let k=0;k<stride;k++)result[remap[i]*stride+k]=data[i*stride+k];return result;};
 const chunks=[],views=[],accessors=[];let offset=0;
 function append(data,type,target){const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),view=views.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});const padding=Buffer.alloc((4-bytes.length%4)%4);chunks.push(bytes,padding);offset+=bytes.length+padding.length;const dimension={SCALAR:1,VEC2:2,VEC3:3}[type],a={bufferView:view,componentType:data instanceof Float32Array?5126:5125,count:data.length/dimension,type};if(type==='VEC3'&&target===34962){a.min=Array(3).fill(Infinity);a.max=Array(3).fill(-Infinity);for(let i=0;i<data.length;i++){a.min[i%3]=Math.min(a.min[i%3],data[i]);a.max[i%3]=Math.max(a.max[i%3],data[i]);}}accessors.push(a);return accessors.length-1;}
 const next={attributes:{POSITION:append(compact(positions,3),'VEC3',34962),NORMAL:append(compact(normals,3),'VEC3',34962),TEXCOORD_0:append(compact(uv,2),'VEC2',34962)},indices:append(indices,'SCALAR',34963),material:0};
 const metadata={source:receipt.source,license:'CC0-1.0',sourceTriangles:input.length/3,triangles:indices.length/3,sourceChartComponents:new Set(Array.from(parents,(_,i)=>find(i))).size,crossedCharts,previousCrossedCharts,normalizedError:error,method:'Meshopt attribute-aware, no Permissive, original UV charts retained',maps:'Unchanged original 2K maps in existing GLB'};
 const gltf={asset:{version:'2.0',generator:'SEA seam-preserving coastal geometry',extras:metadata},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[next]}],materials:[{name:receipt.asset,pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.94}}],buffers:[{byteLength:offset}],bufferViews:views,accessors};
 const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),data=Buffer.concat(chunks),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
 header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+data.length,8);jh.writeUInt32LE(padded.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(data.length);bh.writeUInt32LE(0x004e4942,4);
 const glb=Buffer.concat([header,jh,padded,bh,data]),file=name.replaceAll('_','-')+'-seams-v34.glb';await fs.writeFile(path.join(destination,file),glb);
 results.push({...metadata,sources:[gltfSource,binSource],output:{file,bytes:glb.length,sha256:sha(glb)}});console.log(JSON.stringify(results.at(-1)));
}
await fs.writeFile(path.join(destination,'seams-provenance.json'),JSON.stringify({assets:results},null,2)+'\n');
