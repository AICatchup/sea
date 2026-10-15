import test from 'node:test';
import assert from 'node:assert/strict';
import {shoreGridChop} from '../src/ocean/shore-grid.ts';
import {shoreSurfaceBlend} from '../src/ocean/shore-surface-transition.ts';
test('a folded FFT parameter grid cannot overlap the interior SWE heightfield',()=>{
 const displacement=(x:number)=>2*Math.sin(x),height=(x:number)=>1.5*Math.cos(.3*x);
 let oldInversions=0,previousOld=-Infinity,previousNew=-Infinity;
 for(let i=0;i<=400;i++){
  const x=-10+i*.05,old=x+displacement(x),world=x+displacement(x)*shoreGridChop(.3,-2,1);
  if(old<previousOld)oldInversions++;
  assert.ok(world>previousNew);assert.equal(height(world),height(x));
  previousOld=old;previousNew=world;
 }
 assert.ok(oldInversions>100,'reproduce overlapping old mesh without flattening the solved wave');
});
test('grid transition only changes coordinates where SWE entirely owns height',()=>{
 for(let edge=-.05;edge<=.5;edge+=.005)for(let bed=-12;bed<=2;bed+=.1){
  const chop=shoreGridChop(edge,bed,1);assert.ok(chop>=0&&chop<=1);
  if(chop<1-1e-8)assert.ok(Math.abs(shoreSurfaceBlend(edge,bed,1)-1)<1e-12);
 }
 assert.equal(shoreGridChop(.4,-2,1,false),1);
 assert.equal(shoreGridChop(.4,-2,.1),1);
 assert.equal(shoreGridChop(0,-2,1),1);
 assert.equal(shoreGridChop(.4,-20,1),1);
});
