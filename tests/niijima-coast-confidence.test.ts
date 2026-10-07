import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {NIIJIMA_DETAIL_RASTER as raster} from '../src/world/niijima-detail-repaired.generated.ts';
import {NIIJIMA_COAST_CONFIDENCE as source,NIIJIMA_COARSE_SEA_CELLS} from '../src/world/niijima-coast-confidence.generated.ts';
import {reconcileNiijimaCoast} from '../src/world/niijima-coast-confidence.ts';
import {NiijimaDEM} from '../src/world/niijima-detail.ts';
const raw=Buffer.from(raster.elevations,'base64');
const values=()=>Int16Array.from({length:raw.length/2},(_,i)=>raw.readInt16LE(i*2));
test('coast correction is bound to immutable source bytes and touches only enumerated coarse extensions',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),source.originalGridSha256);
 const original=values(),candidate=values(),patch=new Set(NIIJIMA_COARSE_SEA_CELLS.map(p=>p[0]));
 assert.deepEqual(reconcileNiijimaCoast(candidate,raster),{compatible:true,removed:source.changedCells});
 for(let i=0;i<original.length;i++)assert.equal(candidate[i],patch.has(i)?-32768:original[i]);
 const relocated=values();assert.equal(reconcileNiijimaCoast(relocated,{...raster,minX:raster.minX+1}).compatible,false);assert.deepEqual(relocated,original);
 const stale=values();stale[0]+=1;const before=stale.slice();assert.equal(reconcileNiijimaCoast(stale,raster).compatible,false);assert.deepEqual(stale,before);
});
test('the observed coarse ridge becomes continuous inferred water while the real inland scarp stays',()=>{
 const old=new NiijimaDEM(),next=new NiijimaDEM(undefined,{coastConfidence:true});
 assert.ok(old.heightAt(5900,-1125)>10);assert.ok(next.heightAt(5900,-1125)<0);
 assert.ok(old.heightAt(5876,-1029)>3);assert.ok(next.heightAt(5876,-1029)<1);
 assert.ok(old.heightAt(5920,-1321)>20);assert.ok(next.heightAt(5920,-1321)<0);
 assert.ok(old.heightAt(5860,-1125)>1);assert.equal(next.heightAt(5860,-1125),old.heightAt(5860,-1125));
 for(const [i]of NIIJIMA_COARSE_SEA_CELLS){assert.equal(next.land[i],0);assert.ok(next.heights[i]<0);}
});
