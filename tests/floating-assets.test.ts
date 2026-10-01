import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

test('existing markers and placed buoys follow the same local rendered-water sampler',async()=>{
  // Assets use bundler-only URL imports and parameter properties. Exercise the
  // actual module through the existing Vite transform, without opening a port.
  const server=await createServer({server:{middlewareMode:true},appType:'custom'});
  const {AssetWorld}=await server.ssrLoadModule('/src/world/assets.ts');
  const world=new AssetWorld({heightAt:()=>-10});
  try{
    world.place('buoy',0,0,0);
    const state=world as unknown as {floatingMarkers:{object:THREE.Object3D}[];placementBatches:Map<string,{mesh:THREE.InstancedMesh}[]>};
    const position=new THREE.Vector3(),matrix=new THREE.Matrix4();world.update(2,position,false);
    const markers=state.floatingMarkers.map(m=>m.object.position.y);
    const batches=state.placementBatches.get('buoy')!;
    const previous=batches.map(b=>{b.mesh.getMatrixAt(0,matrix);return matrix.elements[13];});
    world.setWaterHeightSampler(()=>1.25);world.update(2,position,false);
    assert.ok(state.floatingMarkers.length>0,'existing floating markers are exercised');
    state.floatingMarkers.forEach((m,i)=>assert.ok(Math.abs(m.object.position.y-markers[i]-1.25)<1e-6));
    batches.forEach((b,i)=>{b.mesh.getMatrixAt(0,matrix);assert.ok(Math.abs(matrix.elements[13]-previous[i]-1.25)<1e-5);});
    world.setWaterHeightSampler(()=>NaN);world.update(2,position,false);
    state.floatingMarkers.forEach((m,i)=>assert.ok(Math.abs(m.object.position.y-markers[i])<1e-6));
  }finally{world.dispose();await server.close();}
});
