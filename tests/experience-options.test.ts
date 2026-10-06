import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceOptions} from '../src/qa/experience-options.ts';

test('Habushi assembled candidate connects coast, solver and volume without separating traveller from vessel',()=>{
  assert.deepEqual(experienceOptions('?experience=habushi'),{surf:true,whitewater:true,volume:true,photoCoast:true,view:null});
});
test('individual feature switches override the assembled candidate for isolation',()=>{
  assert.deepEqual(experienceOptions('?experience=habushi&surf=0&whitewater=0&coast=base&view=secret'),{surf:false,whitewater:false,volume:false,photoCoast:false,view:'secret'});
  assert.equal(experienceOptions('?experience=habushi&whitewater=1').volume,false);
});
test('normal travel includes coastal solving while retaining explicit opt-outs and geometry variants',()=>{
  assert.deepEqual(experienceOptions(''),{surf:true,whitewater:true,volume:false,photoCoast:false,view:null});
  assert.equal(experienceOptions('?surf=0').surf,false);
  assert.deepEqual(experienceOptions('?surf=1&whitewater=volume&coast=photo&view=shore'),{surf:true,whitewater:true,volume:true,photoCoast:true,view:'shore'});
});
