import test from 'node:test';
import assert from 'node:assert/strict';
import {IslandElevation} from '../src/world/geodata.ts';
import {TOMARI_STRAND_POINTS,tomariStrandReferenceAt} from '../src/world/tomari-strand.ts';

test('reference arc interpolates its controls with continuous slopes and no segment overshoot',()=>{
 const points=TOMARI_STRAND_POINTS;
 assert.equal(tomariStrandReferenceAt(points[0][0]-1),null);assert.equal(tomariStrandReferenceAt(NaN),null);
 for(let i=0;i<points.length;i++){
  assert.ok(Math.abs(tomariStrandReferenceAt(points[i][0])!.z-points[i][1])<1e-9);
  if(i>0&&i<points.length-1){const x=points[i][0],l=tomariStrandReferenceAt(x-1e-5)!,r=tomariStrandReferenceAt(x+1e-5)!;assert.ok(Math.abs(l.slope-r.slope)<.0001);}
  if(i===points.length-1)continue;
  for(let j=1;j<20;j++){const z=tomariStrandReferenceAt(points[i][0]+(points[i+1][0]-points[i][0])*j/20)!.z;
   assert.ok(z>=Math.min(points[i][1],points[i+1][1])-1e-8&&z<=Math.max(points[i][1],points[i+1][1])+1e-8);}
 }
});

test('actual refined heightfield follows the supported reference arc without the previous western clipped ledge',()=>{
 const before=new IslandElevation(true,true,false),after=new IslandElevation(true,true,false,true);
 let oldResidual=0,newResidual=0,count=0;
 // The western 8 m intentionally joins the unchanged rock-foot contour.
 for(let x=-85;x<=10;x+=.25){const curve=tomariStrandReferenceAt(x)!;assert.equal(curve.endWeight,1);
  const old=Math.abs(before.heightAt(x,curve.z)),next=Math.abs(after.heightAt(x,curve.z));
  assert.ok(next<.004,`arc at x=${x}: height residual ${next} m`);oldResidual+=old;newResidual+=next;count++;}
 assert.ok(newResidual/count<.001);assert.ok(oldResidual/count>.1);
});

test('water used for navigation and land outside the low strand retain the old triangle samples',()=>{
 const before=new IslandElevation(true,true,false),after=new IslandElevation(true,true,false,true);let deep=0,changed=0;
 for(let x=-130;x<70;x+=.5)for(let z=-85;z<50;z+=.5){const old=before.heightAt(x,z),next=after.heightAt(x,z);
  assert.ok(Number.isFinite(next));
  if(old<=-.9){assert.equal(next,old,`protected water at ${x},${z}`);deep++;}
  // Include the western connection and the support of its boundary triangles.
  if(old>=3||x< -97-before.beach!.dx||x>TOMARI_STRAND_POINTS.at(-1)![0]+before.beach!.dx)assert.equal(next,old);
  if(Math.abs(next-old)>1e-7)changed++;
 }
 assert.ok(deep>10000&&changed>1000);
 const a=before.beach!,b=after.beach!;assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.dx,b.dx);assert.equal(a.dz,b.dz);
});
