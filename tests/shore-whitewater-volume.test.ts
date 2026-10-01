import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WhitewaterVolumePool, ShoreWhitewaterVolume, createWhitewaterVolumeGeometry, VOLUME_CAPACITY } from '../src/ocean/shore-whitewater-volume.ts';
import { ShoreSpray } from '../src/ocean/shore-spray.ts';
import { ShoreWhitewater, type WhitewaterSample } from '../src/ocean/shore-whitewater.ts';
const birth={x:0,z:0,height:.4,energy:.85,nx:1,nz:0,seed:.4};
const water:WhitewaterSample={height:.4,compression:.85,depth:1,shelter:1,ground:-1,gradientX:1,gradientZ:0,waveGradientX:0,waveGradientZ:0};
const sample=(_x:number,_z:number,out:WhitewaterSample)=>{Object.assign(out,water);return true;};
test('fixed volume pool fills, rejects invalid input, pauses and recycles',()=>{
  const p=new WhitewaterVolumePool(2);assert.ok(p.emit(birth));assert.ok(p.emit(birth));assert.equal(p.emit(birth),false);
  p.advance(.15,sample);assert.ok(p.alpha[0]>0);assert.ok(p.positions[0]>0);
  const snapshot=[p.positions.slice(),p.shape.slice(),p.alpha.slice()];
  for(const dt of [0,-1,Infinity,NaN])p.advance(dt,sample);
  assert.deepEqual([p.positions,p.shape,p.alpha],snapshot);
  p.advance(20,sample);assert.equal(p.active,0);assert.ok(p.emit(birth));
  assert.equal(p.emit({...birth,energy:NaN}),false);assert.equal(p.emit({...birth,nx:0}),false);
  assert.throws(()=>new WhitewaterVolumePool(VOLUME_CAPACITY+1));p.dispose();assert.equal(p.emit(birth),false);
});
test('energy controls real thickness, collapse spreads and sampled wave slope changes flow',()=>{
  const a=new WhitewaterVolumePool(1),b=new WhitewaterVolumePool(1);a.emit(birth);b.emit({...birth,energy:.2});
  a.advance(.15,sample);b.advance(.15,sample);assert.ok(a.shape[1]>b.shape[1]*2);
  const thickness=a.shape[1],depth=a.shape[2];a.advance(.6,sample);assert.ok(a.shape[1]<thickness);assert.ok(a.shape[2]>depth);assert.ok(a.motion[0]>0);
  const c=new WhitewaterVolumePool(1),d=new WhitewaterVolumePool(1);c.emit(birth);d.emit(birth);
  c.advance(.1,sample);d.advance(.1,(_x,_z,out)=>{Object.assign(out,{...water,waveGradientX:.4,waveGradientZ:.3,height:.9});return true;});
  assert.ok(d.positions[0]<c.positions[0]);assert.ok(d.positions[2]<0);assert.ok(Math.abs(d.positions[1]-.9)<1e-6);
  assert.ok([...a.positions,...a.shape,...a.motion,...a.alpha].every(Number.isFinite));
});
test('dry land, deep, sheltered, missing and invalid cache cull volume',()=>{
  for(const change of [{ground:.4},{depth:0},{depth:5},{shelter:.1},{height:NaN},{waveGradientX:NaN}]){
    const p=new WhitewaterVolumePool(1);p.emit(birth);p.advance(.1,(_x,_z,out)=>{Object.assign(out,{...water,...change});return true;});assert.equal(p.active,0);
  }
  const p=new WhitewaterVolumePool(1);p.emit(birth);p.advance(.1,()=>false);assert.equal(p.active,0);
});
test('geometry occupies all axes, has closed edges and fixed real normals',()=>{
  const g=createWhitewaterVolumeGeometry(),p=g.getAttribute('position'),n=g.getAttribute('normal');
  assert.equal(p.count/3,80);assert.equal(n.count,p.count);g.computeBoundingBox();
  const size=g.boundingBox!.getSize(new THREE.Vector3());assert.ok(size.x>1&&size.y>1&&size.z>1);
  const edges=new Map<string,number>(),key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
  for(let i=0;i<p.count;i+=3)for(const [a,b] of [[i,i+1],[i+1,i+2],[i+2,i]]){const k=[key(a),key(b)].sort().join('|');edges.set(k,(edges.get(k)??0)+1);}
  assert.ok([...edges.values()].every(v=>v===2));g.dispose();
});
test('volume material uses depth, has fixed attributes, hides underwater and disposes once',()=>{
  const v=new ShoreWhitewaterVolume();assert.equal(v.geometry.instanceCount,384);assert.equal(v.material.depthWrite,true);assert.equal(v.material.transparent,false);
  const geometry=v.geometry,position=geometry.getAttribute('position');v.pool.emit(birth);v.update(.1,sample,true);assert.equal(v.group.visible,false);v.update(.1,sample,false);assert.equal(v.group.visible,true);
  assert.equal(v.geometry,geometry);assert.equal(v.geometry.getAttribute('position'),position);
  let disposed=0;v.material.addEventListener('dispose',()=>disposed++);v.dispose();v.dispose();assert.equal(disposed,1);assert.equal(v.pool.active,0);
});
test('volume opt-in reuses exactly the existing 24-square cache; legacy/off remain selectable',async()=>{
  let reads=0;const pixels=new Uint8Array(2304);for(let i=0;i<pixels.length;i+=4){pixels[i]=132;pixels[i+1]=204;pixels[i+2]=220;pixels[i+3]=32;}
  const renderer={getRenderTarget(){return null;},setRenderTarget(){},render(){},readRenderTargetPixelsAsync(){reads++;return Promise.resolve(pixels);},getDrawingBufferSize(v:THREE.Vector2){return v.set(800,600);}} as unknown as THREE.WebGLRenderer;
  const ground={heightAt:(x:number)=>-1+x*.001};const off=new ShoreSpray(renderer,ground);assert.equal(off.whitewater,null);off.dispose();
  const legacy=new ShoreSpray(renderer,ground,{whitewater:true});assert.ok(legacy.whitewater instanceof ShoreWhitewater);legacy.dispose();
  const s=new ShoreSpray(renderer,ground,{volume:true});assert.ok(s.whitewater instanceof ShoreWhitewaterVolume);
  const u={uLongWaves:{value:new THREE.Texture()},uShortWaves:{value:new THREE.Texture()},uBathymetry:{value:new THREE.Texture()},uSunDirection:{value:new THREE.Vector3(1,1,0).normalize()}};
  const camera=new THREE.PerspectiveCamera();for(let i=0;i<30;i++){s.update(1+i*.05,.05,camera,u);await new Promise(r=>setImmediate(r));}
  assert.ok(reads>0&&reads<12);assert.ok(s.diagnostics.whitewaterActive>0);assert.equal(s.diagnostics.whitewaterTriangles,30720);assert.equal(s.diagnostics.readbackBytes,2304);assert.equal(s.diagnostics.drawCalls,2);
  assert.equal(s.whitewater!.material.uniforms.uSunDirection,u.uSunDirection);
  const active=s.diagnostics.whitewaterActive;s.update(3,0,camera,u);assert.equal(s.diagnostics.whitewaterActive,active);s.dispose();
});
