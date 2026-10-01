import test from 'node:test';
import assert from 'node:assert/strict';
import {IslandElevation} from '../src/world/geodata.ts';
import {cliffOutcrops} from '../src/world/cliff-detail.ts';

test('integrated coherent coast keeps source data, raster joins and low sea vertices while changing dry rock',()=>{
  const legacy=new IslandElevation(),candidate=new IslandElevation(true);
  assert.equal(legacy.coherentRock,false);assert.equal(candidate.coherentRock,true);
  assert.deepEqual(candidate.tomari!.ground,legacy.tomari!.ground,'source elevations are unchanged');
  const a=legacy.coast!,b=candidate.coast!;
  assert.deepEqual([b.width,b.height,b.dx,b.dz,b.minX,b.maxX,b.minZ,b.maxZ],[a.width,a.height,a.dx,a.dz,a.minX,a.maxX,a.minZ,a.maxZ]);
  let changed=0,low=0,border=0;
  for(let iz=0;iz<b.height;iz++)for(let ix=0;ix<b.width;ix++){
    const i=iz*b.width+ix,x=b.minX+ix*b.dx,z=b.minZ+iz*b.dz;
    assert.ok(Number.isFinite(b.ground[i]));
    if(ix===0||iz===0||ix===b.width-1||iz===b.height-1){assert.equal(b.ground[i],a.ground[i]);border++;}
    if(legacy.tomari!.heightAt(x,z)<=1.1){assert.equal(b.ground[i],a.ground[i]);low++;}
    if(Math.abs(b.ground[i]-a.ground[i])>.05)changed++;
  }
  assert.ok(changed>1000&&low>1000&&border>1000,`${changed}/${low}/${border}`);
  for(const [x,z] of [[-36,27],[-42,9],[-145,-113],[-118,-90]])assert.equal(candidate.heightAt(x,z),legacy.heightAt(x,z),'beach/underwater/vessel anchor preserved');
  const geometry=cliffOutcrops(candidate,b,true);
  try{
    assert.ok(geometry.userData.rockPieces>100&&geometry.userData.triangleCount<=80000);
    assert.equal(geometry.userData.collisionProxies.length,geometry.userData.rockPieces);
    assert.ok(geometry.userData.minExposedVertexHeightM>=2.2);
  }finally{geometry.dispose();}
});
