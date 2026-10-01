import test from 'node:test';
import assert from 'node:assert/strict';
import { NIIJIMA_DETAIL_RASTER as original } from '../src/world/niijima-detail.generated.ts';
import { NIIJIMA_DETAIL_RASTER as repaired, NIIJIMA_DETAIL_PROVENANCE as p } from '../src/world/niijima-detail-repaired.generated.ts';
const decode=(r:typeof original|typeof repaired)=>{const b=Buffer.from(r.elevations,'base64');return Array.from({length:b.length/2},(_,i)=>b.readInt16LE(i*2));};
test('detail fallback preserves every original valid elevation and fills only missing coverage from recorded sources',()=>{
  for(const key of ['width','height','minX','maxX','minZ','maxZ'] as const)assert.equal(repaired[key],original[key]);
  const a=decode(original),b=decode(repaired);let fills=0,missing=0;
  for(let i=0;i<a.length;i++){if(a[i]!==-32768)assert.equal(b[i],a[i]);else if(b[i]!==-32768)fills++;if(b[i]===-32768)missing++;}
  assert.equal(fills,2278);assert.equal(fills,p.sourceChoices.dem10b);assert.equal(missing,p.sourceChoices.missing);
  assert.ok(p.tiles.some(t=>t.url.includes('/dem_png/14/')&&'sha256' in t));
});
