import test from 'node:test';
import assert from 'node:assert/strict';
import { niijimaGeologicalSurface } from '../src/world/niijima-geological-surface.ts';

test('resistant beds create metre-scale relief interrupted along coast rather than a repeated stripe',()=>{
  const samples=[];
  for(let z=-1000;z<=-600;z+=7)for(let y=5;y<=115;y+=.3){
    const a=niijimaGeologicalSurface(z,y);
    assert.ok(Number.isFinite(a.retreat)&&a.tone>=.68&&a.tone<=.96);
    assert.deepEqual(a,niijimaGeologicalSurface(z,y));samples.push(a.retreat);
  }
  assert.ok(Math.max(...samples)-Math.min(...samples)>3,'physical hard/soft relief must survive at metre scale');
  for(const period of [4,8,16]) {
    let difference=0;
    for(let y=10;y<90;y+=.4)difference+=Math.abs(niijimaGeologicalSurface(-850,y).retreat-niijimaGeologicalSurface(-850,y+period).retreat);
    assert.ok(difference>20,`no repeating ${period}m strata`);
  }
  const profile=(z:number)=>Array.from({length:100},(_,i)=>niijimaGeologicalSurface(z,i+5).retreat);
  assert.ok(profile(-850).some((v,i)=>Math.abs(v-profile(-900)[i])>.8),'longitudinal bed breaks are geometric');
});
