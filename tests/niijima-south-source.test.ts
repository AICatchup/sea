import test from 'node:test';
import assert from 'node:assert/strict';
import { NiijimaDEM } from '../src/world/niijima-detail.ts';
import { NIIJIMA_SOUTH_RASTER,NIIJIMA_SOUTH_PROVENANCE } from '../src/world/niijima-south.generated.ts';
import {geoToWorld} from '../src/world/contracts.ts';

test('HTTP-successful high-resolution NA pixels use valid coarse land instead of inventing sea',()=>{
  const dem=new NiijimaDEM(NIIJIMA_SOUTH_RASTER);
  // Independent public-layer probes: 5A NA, 5B 404, 10B 2.27/3.36/3.16m.
  for(const [lat,lon] of [[34.330865583,139.27167975],[34.3328445,139.271700889],[34.334521056,139.272118028]]){
    const p=geoToWorld(lat,lon),height=dem.heightAt(p.x,p.z);
    assert.ok(height>1.5&&height<5,`${lat},${lon}: missing coverage became ${height}m`);
  }
  assert.ok(NIIJIMA_SOUTH_PROVENANCE.sourceChoices.dem10b>5000);
  assert.ok(NIIJIMA_SOUTH_PROVENANCE.sourceChoices.missing>0,'remaining NA stays missing');
  assert.match(NIIJIMA_SOUTH_PROVENANCE.sourceSelection,/missing, not measured sea/);
});
