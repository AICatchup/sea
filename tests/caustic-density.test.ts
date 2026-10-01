import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaveCaustics } from '../src/ocean/caustics.ts';

function fixture(photonResolution?:128|256|512) {
  const rendered:THREE.Scene[]=[];
  const renderer={ autoClear:true, getRenderTarget:()=>null, getActiveCubeFace:()=>0,
    getActiveMipmapLevel:()=>0, getClearAlpha:()=>1, getClearColor:(c:THREE.Color)=>c.set(0),
    setClearColor:()=>{},setRenderTarget:()=>{},clear:()=>{},render:(s:THREE.Scene)=>rendered.push(s) };
  const caustics=new WaveCaustics(renderer as unknown as THREE.WebGLRenderer,{span:32,photonResolution});
  const texture=new THREE.Texture({width:2,height:2});
  const update=()=>caustics.update(10,.016,texture,texture,{texture,origin:new THREE.Vector2(),size:new THREE.Vector2(32,32)},new THREE.Vector3(),new THREE.Vector3(0,1,0),1,8);
  update();
  const photons=rendered[0].children[0] as THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const quad=rendered[1].children[0] as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  return {caustics,texture,update,photons,quad};
}

test('lazy density switching couples metric normals, clears only caustic history and reuses geometry',()=>{
  const f=fixture();
  assert.equal(f.caustics.photonResolution,256);
  assert.equal(f.photons.geometry.getAttribute('position').count,65536);
  assert.equal(f.photons.material.uniforms.uNormalStep.value,.1875);
  const legacy=f.photons.geometry;
  const borrowedShore={value:f.texture};
  f.caustics.bindShore({uShoreState:borrowedShore});
  assert.equal(f.photons.material.uniforms.uShoreState,borrowedShore);
  f.update(); assert.ok(f.quad.material.uniforms.uHistoryWeight.value>0);
  f.caustics.setPhotonResolution(512);
  const fine=f.photons.geometry;
  assert.equal(fine.getAttribute('position').count,262144);
  assert.equal(f.photons.material.uniforms.uNormalStep.value,24/256);
  assert.equal(f.photons.material.uniforms.uTime.value,10);
  assert.equal(f.photons.material.uniforms.uShortWaves.value,f.texture);
  f.update(); assert.equal(f.quad.material.uniforms.uHistoryWeight.value,0);
  f.update(); assert.ok(f.quad.material.uniforms.uHistoryWeight.value>0);
  f.caustics.setPhotonResolution(512);
  assert.equal(f.photons.geometry,fine);
  assert.ok(f.quad.material.uniforms.uHistoryWeight.value>0);
  f.caustics.setPhotonResolution(256); assert.equal(f.photons.geometry,legacy);
  f.update(); assert.equal(f.quad.material.uniforms.uHistoryWeight.value,0);
  f.caustics.setPhotonResolution(512); assert.equal(f.photons.geometry,fine);
  let legacyDisposals=0,fineDisposals=0,borrowedDisposals=0,materialDisposals=0;
  f.photons.material.addEventListener('dispose',()=>materialDisposals++);
  legacy.addEventListener('dispose',()=>legacyDisposals++);
  fine.addEventListener('dispose',()=>fineDisposals++);
  f.texture.addEventListener('dispose',()=>borrowedDisposals++);
  f.caustics.dispose();f.caustics.dispose();
  assert.deepEqual([legacyDisposals,fineDisposals,borrowedDisposals,materialDisposals],[1,1,0,1]);
  assert.throws(()=>f.caustics.setPhotonResolution(256));
});

test('budgets reject unbounded parameters before allocating resources',()=>{
  for(const value of [0,255,1024,NaN]) assert.throws(()=>new WaveCaustics({} as THREE.WebGLRenderer,{photonResolution:value as 256}));
  for(const span of [31,97,Infinity,NaN]) assert.throws(()=>new WaveCaustics({} as THREE.WebGLRenderer,{span}));
  const f=fixture(128); const geometry=f.photons.geometry;
  assert.throws(()=>f.caustics.setPhotonResolution(1024 as 256));
  assert.equal(f.photons.geometry,geometry);f.caustics.dispose();
});

// Independent numerical disk integration and translated infinite-lattice reconstruction.
// These validate the continuous physical model, not WebGL rasterization or photographs.
test('every density conserves integrated photon flux and flat water has no strong lattice grid',()=>{
  const flux=.97963;
  for(const count of [128,256,512]) {
    const cell=48/count, radius=Math.max(cell*1.7,.14);
    const integral=Math.PI*(1-Math.exp(-4))/4;
    const amplitude=flux*cell*cell/(radius*radius*integral);
    let disk=0; const steps=20000;
    for(let i=0;i<steps;i++) {const r=(i+.5)/steps;disk+=Math.exp(-4*r*r)*2*Math.PI*r/steps;}
    assert.ok(Math.abs(amplitude*radius*radius*disk-flux*cell*cell)<1e-8);
    let min=Infinity,max=0,total=0;
    for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
      let energy=0;
      for(let j=-3;j<=3;j++) for(let i=-3;i<=3;i++) {
        const r2=(((x+.5)/64-i)*cell)**2+(((y+.5)/64-j)*cell)**2;
        if(r2<=radius*radius) energy+=amplitude*Math.exp(-4*r2/(radius*radius));
      }
      min=Math.min(min,energy);max=Math.max(max,energy);total+=energy;
    }
    assert.ok(Math.abs(total/4096-flux)<.002);
    assert.ok((max-min)/flux<.04,`density ${count}: ${min}..${max}`);
  }
});


test('sub-cell footprint negative control cannot reconstruct uniform flat-water light',()=>{
  // Radius .5 cell leaves the midpoint between four incident rays entirely dark.
  const radius=.5, centerDistanceSquared=.5;
  assert.ok(centerDistanceSquared>radius*radius);
  // A seemingly sharper point cloud therefore cannot establish physical caustics.
  assert.equal(4*(centerDistanceSquared<=radius*radius ? Math.exp(-4*centerDistanceSquared/(radius*radius)):0),0);
});
