import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { makeTerrainMaterial } from '../src/world/coast-material.ts';
import { SAND_SURFACE, loadSandTextures } from '../src/world/sand-material.ts';
import { FOREST_GROUND_SURFACE } from '../src/world/forest-ground.ts';

const compile = (material: THREE.MeshStandardMaterial) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
};
test('default terrain remains the explicit false shader path; ground replaces only the original green domain', async () => {
  const sand = loadSandTextures(), detail = new THREE.DataTexture(), atlas = new THREE.Texture();
  const baseline = makeTerrainMaterial(detail, atlas, sand), off = makeTerrainMaterial(detail, atlas, sand, false);
  const ground = makeTerrainMaterial(detail, atlas, sand, true);
  const a = compile(baseline), b = compile(off), c = compile(ground);
  const original = execFileSync('git', ['show', 'e3b16dc:src/world/coast-material.ts'], { encoding: 'utf8' });
  const body = stripTypeScriptTypes(original.replace(/^import .*;$/gm, '').replace(/export /g, '').replace(/import.meta.url/g, JSON.stringify(import.meta.url)));
  const originalFactory = new Function('THREE', 'SAND_SURFACE', body + '\nreturn makeTerrainMaterial;')(THREE, SAND_SURFACE);
  const originalMaterial = originalFactory(detail, atlas, sand);
  const originalShader = compile(originalMaterial);
  assert.equal(a.fragmentShader, originalShader.fragmentShader);
  assert.equal(a.vertexShader, originalShader.vertexShader);
  assert.equal(a.fragmentShader, b.fragmentShader);
  originalMaterial.dispose();
  assert.equal(a.vertexShader, b.vertexShader);
  assert.equal(baseline.customProgramCacheKey(), off.customProgramCacheKey());
  assert.match(a.fragmentShader, /coastCover\(vCoastPoint.xz \* .18\) \* .58/);
  assert.match(c.fragmentShader, /canopyColor = coastCover/);
  assert.match(c.fragmentShader, /forestUV = vec2\(vCoastPoint.x, -vCoastPoint.z\) \/ 2.14/);
  assert.match(c.fragmentShader, /textureGrad\(uForestNormal, forestUV, forestDx, forestDy\)/);
  assert.match(c.fragmentShader, /greenMix \* forestMix \* uForestReady/);
  assert.match(c.fragmentShader, /sandMix \* uSandReady/);
  assert.equal(c.vertexShader, a.vertexShader);
  // 11 material samplers leaves 5 for renderer lighting/environment under WebGL minimum 16.
  const declarations = [...c.fragmentShader.matchAll(/uniform sampler2D ([^;]+);/g)];
  assert.equal(declarations.reduce((sum, item) => sum + item[1].split(',').filter(name => name.trim().startsWith('uCoast') || name.trim().startsWith('uSand') || name.trim().startsWith('uForest')).length, 0), 11);
  await ground.userData.ready;
  const maps = ground.userData.forestGroundTextures as THREE.Texture[];
  assert.equal(maps[0].colorSpace, THREE.SRGBColorSpace);
  assert.equal(maps[1].colorSpace, THREE.NoColorSpace);
  assert.equal(maps[2].colorSpace, THREE.NoColorSpace);
  let disposed = 0, sandDisposed = 0;
  maps.forEach(map => map.addEventListener('dispose', () => disposed++));
  sand.textures.forEach(map => map.addEventListener('dispose', () => sandDisposed++));
  ground.dispose(); ground.dispose();
  assert.equal(disposed, 3); assert.equal(sandDisposed, 0);
  assert.equal((c.uniforms as any).uForestReady.value, 0); // CPU fallback, no synthetic ready.
  baseline.dispose(); off.dispose();
});
test('unchanged official forest scan hashes and millimetre-to-metre scale', () => {
  const directory = new URL('../src/assets/forest-ground/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.license, 'CC0-1.0'); assert.equal(manifest.modified, false);
  assert.ok(Math.abs(manifest.info.dimensions[0] / 1000 - FOREST_GROUND_SURFACE.tileSpanMeters) < 1e-6);
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(file.file, directory));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('md5').update(bytes).digest('hex'), file.md5);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
});


