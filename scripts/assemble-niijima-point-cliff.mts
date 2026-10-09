/** CPU-only replay of the fixed V54 reconstruction. Writes a new study, never
 * installs assets or modifies native samples, the runtime or existing output. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import * as THREE from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MeasuredNiijimaTile} from '../src/world/niijima-measured.ts';
import {createMeasuredGridPatch,measuredReplacementFootprintSha256} from '../src/world/measured-grid-patch.ts';
import {decodeReconstructedMeshBuffer} from '../src/world/reconstructed-mesh-buffer.ts';
import {createProjectedMeshSurface} from '../src/world/projected-mesh-surface.ts';
import {clipProjectedSurface} from '../src/world/projected-surface-clip.ts';
import {pointCliffCoverage,continuousPointCliffCoverage,POINT_CLIFF_SOURCE,EXPANDED_CLIFF_SOURCE} from '../src/world/niijima-point-cliff.ts';
import {featherNativeSurfaceBoundary} from '../src/world/native-boundary-feather.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node --experimental-strip-types scripts/assemble-niijima-point-cliff.mts --output NEW_DIRECTORY [--study legacy|continuous|expanded] [--source FIXED_STUDY_SOURCE_BIN]');process.exit(0);}
const study=value('--study')??'legacy';if(!['legacy','continuous','expanded'].includes(study))throw new Error('Unknown fixed reconstruction study');
const expanded=study==='expanded',continuous=study!=='legacy',sourceDescriptor=expanded?EXPANDED_CLIFF_SOURCE:POINT_CLIFF_SOURCE;
const expectedSourceHash=expanded?'20eb881dab71abb686e626436bdb782a0c3ee27f35813cae218d8c83b8d48691':'563483a3474de29bb445e338ba8d468b1ea2f377f1e860f082e91029e00d9a19';
const outputArgument=value('--output');if(!outputArgument)throw new Error('A new --output directory is required');
const output=resolve(outputArgument),source=value('--source')?resolve(value('--source')!):new URL(expanded?'../src/assets/niijima/point-cliff-v55/source-expanded.bin':'../src/assets/niijima/point-cliff-v54/source.bin',import.meta.url);
try{await fs.access(output);throw new Error('Output already exists; use a new directory');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
if((await fs.stat(source)).size!==sourceDescriptor.positionsBytes+sourceDescriptor.indicesBytes)throw new Error('Fixed study source length mismatch');
const bytes=await fs.readFile(source),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
if(sha(bytes)!==expectedSourceHash)throw new Error('Fixed study source SHA256 mismatch');
const decoded=decodeReconstructedMeshBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),sourceDescriptor);
const material=new THREE.MeshStandardMaterial(),native=createMeasuredGridPatch(new MeasuredNiijimaTile().grid,{heightAt:()=>-30},material);
const projected=createProjectedMeshSurface(decoded.geometry,decoded.origin,{maxTriangles:1_000_000,maxGridEntries:8_000_000,numericalAreaTolerance:1e-12});
const bounds=decoded.geometry.boundingBox!.clone().translate(decoded.origin);bounds.min.y=-100;bounds.max.y=200;
const plan=native.prepareInteriorReplacement(continuous?continuousPointCliffCoverage(projected,expanded):pointCliffCoverage(projected),bounds),started=performance.now();
let clipped:THREE.BufferGeometry|null=null,merged:THREE.BufferGeometry|null=null;
try{
 const footprintSha256=await measuredReplacementFootprintSha256(plan);
 const result=clipProjectedSurface(decoded.geometry,decoded.origin,plan.coverageGeometry,plan.origin,
   {maxQueryOperations:300_000_000,maxCandidateTests:100_000_000,unionCoverageAreaToleranceM2:1e-12});
 clipped=result.geometry;merged=mergeVertices(clipped,1e-7);
 let featherDiagnostics=null;
 if(continuous){const f=featherNativeSurfaceBoundary(merged,decoded.origin,plan.coverageGeometry,plan.origin,(x,z)=>native.surfaceHeightAt(x,z),{featherWidthM:4,maxDistanceTests:200_000_000});merged.dispose();merged=f.geometry;featherDiagnostics=f.diagnostics;}
 const p=merged.getAttribute('position').array as Float32Array,index=merged.index!.array as Uint32Array;
 const binary=Buffer.concat([Buffer.from(p.buffer,p.byteOffset,p.byteLength),Buffer.from(index.buffer,index.byteOffset,index.byteLength)]);
 const descriptor={vertices:p.length/3,triangles:index.length/3,origin:decoded.origin.toArray(),positionsBytes:p.byteLength,indicesBytes:index.byteLength,sha256:sha(binary)};
 const receipt={study,sourceSha256:sha(bytes),descriptor,footprintSha256,native:plan.diagnostics,clip:result.diagnostics,feather:featherDiagnostics,clipAndMergeElapsedMs:performance.now()-started,
   scope:'Fixed inferred Poisson reconstruction clipped to the native footprint. Float32 output, not surveyed accuracy or visual/collision acceptance. No automatic runtime installation.'};
 await fs.mkdir(dirname(output),{recursive:true});await fs.mkdir(output);await fs.writeFile(resolve(output,'render.bin'),binary);await fs.writeFile(resolve(output,'render.json'),JSON.stringify(descriptor,null,2));
 await fs.writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{merged?.dispose();clipped?.dispose();plan.dispose();projected.dispose();native.dispose();decoded.geometry.dispose();material.dispose();}
