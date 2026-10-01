import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {NiijimaCoast} from '../src/world/niijima-coast.ts';
import {IslandElevation} from '../src/world/geodata.ts';
import {HabushiMainGate} from '../src/world/habushi-main-gate.ts';
import {WorldCollision} from '../src/world/world-collision.ts';

test('the actual graded Habushi terrain and gate support all stairs and a dry open passage',()=>{
  const material=new THREE.MeshStandardMaterial(),coast=new NiijimaCoast(new IslandElevation(),material);
  const gate=new HabushiMainGate(coast),collision=new WorldCollision();
  try{
    coast.applyGrading(gate.grading);gate.group.updateMatrixWorld(true);
    gate.solidsGroup.traverse(o=>{if(o instanceof THREE.Mesh)collision.addMesh(o);});
    const point=(x:number,y:number,z:number)=>gate.group.localToWorld(new THREE.Vector3(x,y,z));
    for(const side of [-1,1])for(let i=0;i<20;i++){
      const p=point(side*9,(i+1)*.21+.028,9-i*.44);
      const support=collision.supportHeightAt(p.x,p.z,p.y,.32,.1);
      assert.ok(support!==null&&Math.abs(support-p.y)<.04,`side ${side}, stair ${i}`);
      assert.ok(coast.heightAt(p.x,p.z)<p.y+.04,`terrain must not bury stair ${i}`);
    }
    for(let z=-5;z<=10;z+=.5){
      const p=point(0,.1,z),q=point(0,.1,z+.5);
      assert.ok(coast.heightAt(p.x,p.z)>0,'gate approach must remain above sea level');
      assert.ok(Math.abs(coast.heightAt(p.x,p.z)-gate.grading.level)<.01,'passage terrain stays level');
      assert.equal(collision.bodySegmentBlocked(p,q),false,'central passage must remain traversable');
    }
  }finally{collision.dispose();gate.dispose();coast.dispose();material.dispose();}
});

test('landmark grading invalidates pre-existing water tiles and the next tile contains the new foundation',()=>{
  const material=new THREE.MeshStandardMaterial(),coast=new NiijimaCoast(new IslandElevation(),material);
  const gate=new HabushiMainGate(coast);
  try{
    const {x,z}=gate.grading.center,before=coast.waterMap(x,z);let disposed=0;
    before.texture.addEventListener('dispose',()=>disposed++);
    coast.applyGrading(gate.grading);
    assert.equal(disposed,1,'stale GPU ground texture must be released');
    const after=coast.waterMap(x,z);assert.notEqual(after.texture,before.texture);
    const image=after.texture.image;
    const ix=Math.round((x-after.origin.x)/after.size.x*image.width-.5);
    const iz=Math.round((z-after.origin.y)/after.size.y*image.height-.5);
    const value=THREE.DataUtils.fromHalfFloat((image.data as Uint16Array)[(iz*image.width+ix)*4]);
    assert.ok(Math.abs(value-gate.grading.level)<.02,'GPU foundation agrees within half-float precision');
  }finally{gate.dispose();coast.dispose();material.dispose();}
});
