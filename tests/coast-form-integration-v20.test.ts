import test from 'node:test';
import assert from 'node:assert/strict';
import {IslandElevation} from '../src/world/geodata.ts';
import {IslandWorld} from '../src/world/terrain.ts';
import {planWaterRoute,waterSegmentClear} from '../src/world/navigation.ts';

test('actual connected-form raster changes dry cliffs and preserves V19 wet triangle samples and joins',()=>{
  const original=new IslandElevation(true,true),candidate=new IslandElevation(true,true,true),a=original.coast!,b=candidate.coast!;
  let changed=0,max=0,protectedSamples=0;
  for(let iz=0;iz<a.height-1;iz++)for(let ix=0;ix<a.width-1;ix++){
    for(const [fx,fz] of [[0,0],[.25,.25],[.75,.2],[.3,.7]]){
      const x=a.minX+(ix+fx)*a.dx,z=a.minZ+(iz+fz)*a.dz,old=original.heightAt(x,z),next=candidate.heightAt(x,z),delta=Math.abs(next-old);
      assert.ok(Number.isFinite(next));if(delta>.05)changed++;max=Math.max(max,delta);
      if(old<=1.1){protectedSamples++;assert.ok(delta<1e-5,`protected low point ${x},${z}: ${old} -> ${next}`);}
    }
  }
  for(let z=a.minZ;z<=a.maxZ;z+=3)for(const x of [a.minX,a.maxX])assert.ok(Math.abs(b.heightAt(x,z)-a.heightAt(x,z))<1e-8,'source X join changed beyond floating interpolation precision');
  for(let x=a.minX;x<=a.maxX;x+=3)for(const z of [a.minZ,a.maxZ])assert.ok(Math.abs(b.heightAt(x,z)-a.heightAt(x,z))<1e-8,'source Z join changed beyond floating interpolation precision');
  assert.ok(changed>500);assert.ok(max>.5&&max<6.1);assert.ok(protectedSamples>100);
  console.log(JSON.stringify({connectedRaster:{changed,max,protectedSamples}}));
});

test('connected indexed cliff volume leaves real strand and vessel approaches open',()=>{
  const world=new IslandWorld(true,true,true);
  try{
    const paths=[[-42,9,-42,-12],[-36,27,-60,19],[-116,-90,-116,-150]];
    for(const [ax,az,bx,bz] of paths){
      const from={x:ax,y:world.heightAt(ax,az)<0?-.3:world.heightAt(ax,az)+.1,z:az},to={x:bx,y:world.heightAt(bx,bz)<0?-.3:world.heightAt(bx,bz)+.1,z:bz};
      assert.equal(world.bodySegmentBlocked(from,to),false,`approach ${ax},${az} to ${bx},${bz}`);
    }
    for(const destination of world.destinations){
      const route=planWaterRoute(world,{x:-142,z:-97},destination);assert.equal(route.error,undefined,destination.id);
      for(let i=1;i<route.points.length;i++){
        assert.ok(waterSegmentClear(world,route.points[i-1],route.points[i]));
        assert.equal(world.bodySegmentBlocked({...route.points[i-1],y:-.2},{...route.points[i],y:-.2},1.4,1.7),false,destination.id);
      }
    }
    const mesh=world.group.children.find(o=>(o as any).geometry?.userData.connectedFormCandidate) as any;
    assert.ok(mesh?.geometry.index);assert.ok(mesh.geometry.userData.closedVolumes);
  }finally{world.dispose();}
});
