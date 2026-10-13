import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {makeMeasuredCoastMaterial,measuredRockExposure} from '../src/world/measured-rock-exposure.ts';
import {makeTerrainMaterial} from '../src/world/coast-material.ts';
import {loadSandTextures} from '../src/world/sand-material.ts';
import {IslandElevation} from '../src/world/geodata.ts';
import {TomariMeasuredCoast} from '../src/world/tomari-measured.ts';

test('source-verified raised dry rock loses the inherited strand material, unchanged beaches and inland ground retain it',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/tomari-dry-rock-source.json',import.meta.url),'utf8'));
  for(const p of fixture.samples)assert.equal(measuredRockExposure(p.height,p.previousAuthoredHeight),1);
  for(const h of [-4,-.2,.4,1.7,3,10,25])assert.equal(measuredRockExposure(h,h),0);
  assert.equal(measuredRockExposure(.3,-3),0,'wet unsurveyed bed must not become a dry rock shelf');
  assert.equal(measuredRockExposure(12,4),0,'an inland elevation difference is not substrate evidence');
});

test('rendered attribute is continuous across chunks and absent at the patch perimeter; actual ledges receive it',()=>{
  const elevation=new IslandElevation(true,true,false,true),base=new THREE.MeshStandardMaterial();
  const coast=new TomariMeasuredCoast(elevation,base),seen=new Map<string,number>();
  try{
    let seamCount=0,zeroPerimeter=0;
    for(const g of coast.patch.geometries){
      const p=g.getAttribute('position'),a=g.getAttribute('measuredRockExposure');
      assert.equal(a.count,p.count);
      for(let i=0;i<p.count;i++){
        const x=p.getX(i)+coast.bounds.minX,z=p.getZ(i)+coast.bounds.minZ,value=a.getX(i),key=`${p.getX(i)},${p.getZ(i)}`;
        assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
        if(seen.has(key)){assert.equal(value,seen.get(key),'duplicated boundary vertices must share material');seamCount++;}else seen.set(key,value);
        if(p.getX(i)===0||p.getZ(i)===0){assert.equal(value,0);zeroPerimeter++;}
        // This is the class-2 source fixture footprint on the actual rendered grid.
        if(x>-89&&x<-87&&z>-40&&z<-37&&p.getY(i)>4)assert.ok(value>.99);
      }
    }
    assert.ok(seamCount>1000&&zeroPerimeter>1000);
    assert.ok(coast.diagnostics.rockExposure.correctedVertices>100);
    assert.ok(coast.diagnostics.rockExposure.attributeBytes<3_000_000);
  }finally{coast.dispose();base.dispose();}
});

test('one mask precedes PBR selection and controls albedo, normal, roughness and occlusion without owning textures',()=>{
  const sand=loadSandTextures(),terrain=makeTerrainMaterial(new THREE.DataTexture(),new THREE.Texture(),sand,true);
  const coast=makeMeasuredCoastMaterial(terrain,true),original=makeMeasuredCoastMaterial(terrain,false);
  const compile=(m:THREE.MeshStandardMaterial)=>{
    const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    m.onBeforeCompile(s as never,{} as never);return s;
  };
  try{
    const a=compile(coast),b=compile(original),fs=a.fragmentShader;
    assert.ok(fs.indexOf('sandMix *=')<fs.indexOf('if ((1.0 - sandMix)'));
    assert.match(a.vertexShader,/vMeasuredRockExposure = measuredRockExposure/);
    assert.doesNotMatch(b.fragmentShader,/vMeasuredRockExposure/);
    assert.match(fs,/mix\(mix\(stoneColor, greenColor, greenMix\), sandColor, sandMix\)/);
    assert.match(fs,/mix\(normal, sandViewNormal, sandMix \* uSandReady\)/);
    assert.match(fs,/sandRough, sandMix\)/);assert.match(fs,/sandMix \* uSandReady\);\s+reflectedLight.indirectDiffuse/);
    const ua=a.uniforms as Record<string,THREE.IUniform>,ub=b.uniforms as Record<string,THREE.IUniform>;
    assert.equal(ua.uCoastRockNormal.value,ub.uCoastRockNormal.value);
    assert.equal(coast.userData.ready,terrain.userData.ready);
    assert.notEqual(coast.customProgramCacheKey(),original.customProgramCacheKey());
    let disposed=0;ua.uCoastRockNormal.value.addEventListener('dispose',()=>disposed++);
    coast.dispose();original.dispose();assert.equal(disposed,0);terrain.dispose();assert.equal(disposed,1);
  }finally{sand.textures.forEach(t=>t.dispose());}
});
