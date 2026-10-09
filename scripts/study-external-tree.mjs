/** Geometry-only study of a separately cloned, pinned MIT implementation.
 * It does not download source/assets or modify SEA's vegetation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'vite';

const [sourceArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!outputArg)throw new Error('Usage: node scripts/study-external-tree.mjs /path/to/ez-tree /path/to/new-output');
const source=path.resolve(sourceArg),output=path.resolve(outputArg);
const expected='dcf309bd86bd521083d9c70f01f2de45fdc7c457';
const revision=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(revision!==expected)throw new Error('Study requires the documented pinned EZ-Tree revision');
if(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Study requires an unmodified source checkout');
try{await fs.access(output);throw new Error('Choose a new output directory; existing output is preserved');}catch(error){if(error.code!=='ENOENT')throw error;}
const sha=data=>createHash('sha256').update(data).digest('hex');
await fs.mkdir(output,{recursive:true});
// Bundle just the geometry library. Host texture collection and UI are excluded.
await build({configFile:false,root:source,logLevel:'error',resolve:{alias:{three:fileURLToPath(import.meta.resolve('three'))}},build:{lib:{entry:path.join(source,'src/lib/tree.js'),formats:['es'],fileName:()=> 'ez-tree-study.mjs'},outDir:output,emptyOutDir:false}});
const {Tree}=await import(pathToFileURL(path.join(output,'ez-tree-study.mjs')).href);
const sources={};
for(const file of ['LICENSE','src/lib/tree.js','src/lib/options.js','src/lib/enums.js'])sources[file]=sha(await fs.readFile(path.join(source,file)));
const receipt={observedAt:new Date().toISOString(),source:{url:'https://github.com/dgreenheck/ez-tree',revision,license:'MIT',sources},execution:'Cloned library geometry methods bundled with Vite; no texture download, GPU render or runtime adoption.',cases:[],defaultAdoption:false,fullGoal:'active_unmet'};
for(const preset of ['Pine Medium','Bush 1'])for(const seed of [3917,4919,5923]){
 const tree=new Tree();tree.loadPreset(preset);tree.options.seed=seed;tree.generate();
 const skeletonHash=sha(JSON.stringify(tree.skeleton));
 const row={preset,seed,skeletonHash,branches:tree.skeleton.branches.length,leaves:tree.skeleton.leaves.length,levels:[]};
 for(const [name,sectionStride,leafStride] of [['near',1,1],['mid',3,2],['far',6,4]]){
  const started=performance.now();
  const geometry=tree.createGeometry({sectionStride,segmentFactor:name==='near'?1:name==='mid'?.75:.5,leafStride,leafScale:1});
  const level={name,leafStride,leafScale:1,skeletonUnchanged:skeletonHash===sha(JSON.stringify(tree.skeleton)),parts:[],milliseconds:0};
  for(const [kind,g] of Object.entries(geometry)){
   g.computeBoundingBox();const p=g.getAttribute('position'),idx=g.index;
   let maxIndex=0;for(const index of idx.array)maxIndex=Math.max(maxIndex,index);
   const finite=Array.from(p.array).every(Number.isFinite);
   level.parts.push({kind,vertices:p.count,triangles:idx.count/3,maxIndex,indexArray:idx.array.constructor.name,finite,bounds:{min:g.boundingBox.min.toArray(),max:g.boundingBox.max.toArray()},positionHash:sha(Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength))});
   if(!finite||maxIndex>=p.count)throw new Error('Invalid tree buffer');
   if(seed===3917)await fs.writeFile(path.join(output,`${preset.toLowerCase().replaceAll(' ','-')}-${name}-${kind}.json`),JSON.stringify(g.toJSON()));
   g.dispose();
  }
  level.milliseconds=performance.now()-started;row.levels.push(level);
 }
 receipt.cases.push(row);
 tree.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});
}
// Bundled library remains local study material with its original permission.
await fs.copyFile(path.join(source,'LICENSE'),path.join(output,'EZ-TREE-LICENSE.txt'));
await fs.copyFile(fileURLToPath(new URL('../LICENSE',import.meta.resolve('three'))),path.join(output,'THREE-LICENSE.txt'));
await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({cases:receipt.cases.length,allSameSkeleton:receipt.cases.every(c=>c.levels.every(l=>l.skeletonUnchanged)),adopted:false}));
