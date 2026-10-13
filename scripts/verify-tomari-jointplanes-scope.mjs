import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Root's independent rock seating integration changes renderer.ts. This check
// certifies the cliff's terrain/data guards, not an unchanged whole renderer.
const protectedFiles=['src/assets/coast/tomari-west-volume-v32.glb','scripts/build-tomari-cliff.py','src/world/geodata.ts','src/world/terrain.ts','src/world/bathymetry.ts'];
const protectedDigests={};
for(const file of protectedFiles){
 if(!fs.existsSync(file))continue;
 const current=fs.readFileSync(file),pinned=execFileSync('git',['show',`416fdc3:${file}`],{maxBuffer:30*1024*1024});
 const canonical=b=>file.endsWith('.glb')?b:Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'));
 assert.equal(hash(canonical(current)),hash(canonical(pinned)),`Protected source changed: ${file}`);protectedDigests[file]=hash(canonical(current));
}
async function points(file){const b=fs.readFileSync(file),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');g.scene.updateMatrixWorld(true);const points=[];g.scene.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.clone().applyMatrix4(o.matrixWorld).getAttribute('position');for(let i=0;i<p.count;i++)points.push([p.getX(i),p.getY(i),p.getZ(i)]);});return points;}
const baseline=await points(protectedFiles[0]),candidate=await points('src/assets/coast/tomari-west-volume-v69-jointplanes.glb');
const key=p=>p.map(v=>v.toFixed(4)).join(','),baseSet=new Set(baseline.map(key));
let guardSamples=0,changedInterior=0;
for(const p of candidate){const outside=p[2]<=-34||p[2]>=17||p[1]<=5||p[1]>=23;if(outside){guardSamples++;assert.ok(baseSet.has(key(p)),`Guard differs: ${p}`);}else if(!baseSet.has(key(p)))changedInterior++;}
assert.ok(changedInterior>1000,'No meaningful physical geometry change');
const source=fs.readFileSync('src/world/tomari-cliff-volume.ts','utf8');
assert.match(source,/import\.meta\.env\?\.DEV===true/);assert.match(source,/get\('cliffvolume'\)==='jointplanes'/);assert.match(source,/jointPlanes\?jointPlanesUrl:defaultUrl/);
const result={scope:'Cliff asset perimeter and terrain/data source preservation only; root renderer integration reviewed separately',protectedDigests,guardSamples,changedInterior,baselineVertices:baseline.length,candidateExportVertices:candidate.length,candidateAssetSha256:hash(fs.readFileSync('src/assets/coast/tomari-west-volume-v69-jointplanes.glb'))};
console.log(JSON.stringify(result,null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
