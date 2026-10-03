import test from 'node:test';
import assert from 'node:assert/strict';
import {CoastalFoliage} from '../src/world/foliage.ts';
import {ModelResources} from '../src/world/models/procedural.ts';

test('loading a far LOD slot does not overwrite the independently retained near and mid sources',()=>{
 const resources=new ModelResources(),foliage=new CoastalFoliage(resources);
 try{
  for(const levels of [foliage.pineLevels,foliage.shrubLevels]){
   const near=levels.near[0],mid=levels.mid[0],far={...levels.far[0],triangles:1};
   levels.far[0]=far;
   assert.equal(levels.near[0],near);assert.equal(levels.mid[0],mid);
   levels.mid[0]={...mid,triangles:2};assert.equal(levels.near[0],near);assert.equal(levels.far[0],far);
  }
 }finally{foliage.dispose();resources.dispose();}
});
