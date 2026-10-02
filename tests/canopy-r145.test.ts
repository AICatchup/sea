import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

test('canopy continuity is opt-in, preserves roots, and restores low understory volume',async()=>{
  const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  const {AssetWorld}=await server.ssrLoadModule('/src/world/assets.ts');
  const ground={heightAt:(x:number,z:number)=>Math.hypot(x,z)<95?20+x*.12:-20};
  const base=new AssetWorld(ground), disabled=new AssetWorld(ground,{canopyContinuity:false}), candidate=new AssetWorld(ground,{canopyContinuity:true});
  type Plant={matrix:THREE.Matrix4};
  type Field={plants:Plant[];update:(p:THREE.Vector3,force:boolean)=>void};
  type Internal={pineField:Field;shrubField:Field};
  const fields=(w:unknown)=>w as Internal;
  try {
    for(const key of ['pineField','shrubField'] as const){
      const a=fields(base)[key].plants,b=fields(disabled)[key].plants,c=fields(candidate)[key].plants;
      assert.deepEqual(a.map(p=>p.matrix.elements),b.map(p=>p.matrix.elements),'default is exact V19');
      assert.equal(a.length,c.length,'no density increase');
      for(let i=0;i<a.length;i++){
        assert.equal(a[i].matrix.elements[12],c[i].matrix.elements[12]);
        assert.equal(a[i].matrix.elements[14],c[i].matrix.elements[14]);
        assert.ok(c[i].matrix.elements.every(Number.isFinite));
        assert.ok(c[i].matrix.elements[13]-a[i].matrix.elements[13]<=.350001);
        assert.ok(Math.hypot(c[i].matrix.elements[12]+25,c[i].matrix.elements[14]-36)>=6);
      }
    }
    assert.deepEqual(base.getTrunkProxies(),candidate.getTrunkProxies(),'true trunk collision positions/scales remain');
    const a=fields(base).shrubField.plants,c=fields(candidate).shrubField.plants;
    let restored=0;
    for(let i=0;i<a.length;i++){
      const sa=new THREE.Vector3().setFromMatrixScale(a[i].matrix),sc=new THREE.Vector3().setFromMatrixScale(c[i].matrix);
      if(sc.y>sa.y*2){restored++;assert.ok(Math.abs(sc.y/sa.y-2.25)<1e-8);assert.ok(sc.x<sa.x&&sc.z<sa.z);}
    }
    assert.ok(restored>100,'substantial low stratum restored');
    for(const position of [new THREE.Vector3(-36,1.72,27),new THREE.Vector3(120,25,0),new THREE.Vector3(-120,25,0)]){
      for(const key of ['pineField','shrubField'] as const) fields(candidate)[key].update(position,true);
      for(const name of ['coastalPineLod','coastalShrubLod']){
        const status=candidate.group.userData[name];
        assert.equal(status.instances.near+status.instances.mid+status.instances.far+(status.culled??0),status.placements);
        assert.ok(status.instances.near<=status.thresholds.nearCapacity);
        assert.ok(status.instances.mid<=status.thresholds.midCapacity);
        assert.ok(status.triangles<=status.thresholds.triangleBudget);
        assert.ok(status.draws<=18);
      }
    }
    console.log(JSON.stringify({counts:candidate.group.userData.environmentCounts,restored,pine:candidate.group.userData.coastalPineLod,shrub:candidate.group.userData.coastalShrubLod}));
  }finally{base.dispose();disabled.dispose();candidate.dispose();assert.equal(candidate.group.children.length,0);await server.close();}
});

