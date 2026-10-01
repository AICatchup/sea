import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NiijimaCoast, NIIJIMA_DETAIL_PROVENANCE, NIIJIMA_NORTH_PROVENANCE, NIIJIMA_COAST_BOOKMARKS } from '../src/world/niijima-coast.ts';
import { IslandElevation } from '../src/world/geodata.ts';
import { geoToWorld, worldToGeo } from '../src/world/contracts.ts';
import { DESTINATION_SEEDS } from '../src/world/locations.ts';
import { footSegmentClear, isNavigableWater, planWaterRoute, waterSegmentClear } from '../src/world/navigation.ts';

const base = new IslandElevation(), borrowed = new THREE.MeshStandardMaterial(), coast = new NiijimaCoast(base, borrowed);
const ground = { heightAt: (x: number, z: number) => coast.contains(x, z) ? coast.heightAt(x, z) : base.heightAt(x, z) };

function gpuHeight(x: number, z: number): number {
  const map = coast.waterMap(x, z), image = map.texture.image;
  const px = (x - map.origin.x) / map.size.x * image.width - .5, pz = (z - map.origin.y) / map.size.y * image.height - .5;
  const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
  const read = (x: number, z: number) => THREE.DataUtils.fromHalfFloat((image.data as Uint16Array)[(z * image.width + x) * 4]);
  const a=read(ix,iz),b=read(ix+1,iz),c=read(ix,iz+1),d=read(ix+1,iz+1);
  return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
}

test('Niijima macroshape is bound to high-resolution GSI sources and distinct official surf markers', () => {
  const p = NIIJIMA_DETAIL_PROVENANCE;
  assert.equal(p.publisher, '国土地理院 / Geospatial Information Authority of Japan');
  assert.ok(p.tiles.filter(t => t.url.includes('dem5a_png/15/')).length >= 12);
  assert.ok(p.tiles.every(t => "sha256" in t ? /^[a-f0-9]{64}$/.test(t.sha256) : "status" in t && t.status===404));
  assert.match(p.authored, /bathymetry is inferred/);
  assert.deepEqual(p.markers.map(m => [m.lat, m.lon]), [[34.35561844, 139.2758477], [34.34428046, 139.2757618]]);
  const peak = geoToWorld(34.348, 139.270);
  assert.ok(coast.dem.heightAt(peak.x, peak.z) > 140, 'white cliffs retain measured mountain height');
  assert.ok(Math.abs(coast.heightAt(peak.x, peak.z) - coast.dem.heightAt(peak.x, peak.z)) < 2.5);
});

test('every close ground query agrees with its visible indexed triangle and mesh normals are unit length', () => {
  for (const object of coast.group.children) {
    const mesh = object as THREE.Mesh, geometry = mesh.geometry, pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), index = geometry.index!;
    for (let j = 0; j < index.count; j += Math.max(3, Math.floor(index.count / 110 / 3) * 3)) {
      const ids = [index.getX(j), index.getX(j + 1), index.getX(j + 2)], weights = [.23, .31, .46];
      let x = 0, y = 0, z = 0;
      ids.forEach((id, i) => { x += pos.getX(id) * weights[i]; y += pos.getY(id) * weights[i]; z += pos.getZ(id) * weights[i]; });
      assert.ok(Math.abs(coast.heightAt(x, z) - y) < .006, `${mesh.name}: feet disagree with rendered triangle`);
      const id = ids[0]; assert.ok(Math.abs(Math.hypot(normals.getX(id), normals.getY(id), normals.getZ(id)) - 1) < 1e-6);
    }
  }
});

test('all nested surfaces and legacy field join continuously', () => {
  for (const surface of coast.surfaces) {
    const b = surface.bounds;
    for (let i = 0; i <= 130; i++) {
      const t = i / 130;
      for (const [x, z, dx, dz] of [[b.minX, b.minZ + t * (b.maxZ - b.minZ), .00001, 0], [b.maxX, b.minZ + t * (b.maxZ - b.minZ), .00001, 0], [b.minX + t * (b.maxX - b.minX), b.minZ, 0, .00001], [b.minX + t * (b.maxX - b.minX), b.maxZ, 0, .00001]]) {
        assert.ok(Math.abs(ground.heightAt(x + dx, z + dz) - ground.heightAt(x - dx, z - dz)) < .004);
        if (surface === coast.surfaces[0]) assert.ok(Math.abs(coast.heightAt(x, z) - base.heightAt(x, z)) < .00002);
      }
    }
  }
});

test('cell-centre water UVs match ground nodes and triangulated wet strand stays within 2.5cm', () => {
  const map = coast.waterMap(), image = map.texture.image, bytes = image.data as Uint16Array;
  assert.ok(map.size.x / image.width <= 2 && map.size.y / image.height <= 2);
  assert.ok(bytes.byteLength < 66_000_000);
  for (let iz = 0; iz < image.height; iz += 73) for (let ix = 0; ix < image.width; ix += 67) {
    const x = map.origin.x + (ix + .5) * map.size.x / image.width, z = map.origin.y + (iz + .5) * map.size.y / image.height;
    assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(bytes[(iz * image.width + ix) * 4]) - coast.heightAt(x, z)) < Math.max(.001, Math.abs(coast.heightAt(x, z)) * .001));
  }
  let samples = 0, maximum = 0;
  for (let z = -3150.37; z < -720; z += 7.63) for (let x = 5860.29; x < 5970; x += .71) {
    const y = coast.heightAt(x, z); if (Math.abs(y) > 1.2) continue;
    maximum = Math.max(maximum, Math.abs(gpuHeight(x, z) - y)); samples++;
  }
  assert.ok(samples > 10_000); assert.ok(maximum <= .025, `maximum triangulated water error ${maximum}m`);
});

test('new east coast arrivals are open water and seamless boat routes preserve existing Maehama destination', () => {
  const start = base.arrival(-64, -70);
  for (const id of ['habushi', 'horikiri', 'secret', 'niijima']) {
    const seed = DESTINATION_SEEDS.find(seed => seed.id === id)!;
    const goal = id === 'niijima' ? base.arrival(seed.x, seed.z) : seed;
    assert.ok(isNavigableWater(ground, goal), id);
    const route = planWaterRoute(ground, start, goal); assert.equal(route.error, undefined, id);
    for (let i = 1; i < route.points.length; i++) assert.ok(waterSegmentClear(ground, route.points[i - 1], route.points[i]), `${id} boat clips land`);
    if (id === 'secret') {
      const location = worldToGeo(seed.x, seed.z);
      assert.ok(Math.abs(location.lat - 34.34428046) < 1e-9); assert.ok(Math.abs(location.lon - (139.2757618 + .0011)) < 1e-9);
    }
  }
});

test('pumice cliffs block walking and detailed coast stays within memory/draw budgets', () => {
  assert.equal(footSegmentClear(ground, { x: 5883, z: -2186 }, { x: 5750, z: -2186 }), false);
  assert.ok(coast.triangleCount < 3_000_000); assert.equal(coast.group.children.length, 9);
  const close = coast.surfaces[1]; assert.ok(close.dx < 2 && close.dz < 2); assert.ok(close.bounds.maxX - close.bounds.minX < 500); assert.ok(close.bounds.maxZ - close.bounds.minZ < 2000);
});

test('full Habushi coverage retains the immutable southern source and verified Main Gate bookmark', () => {
  const p = NIIJIMA_NORTH_PROVENANCE;
  const original = readFileSync(new URL('../src/world/niijima-detail.generated.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(original).digest('hex'), p.originalSecretSnapshot.sha256);
  assert.equal(p.originalSecretSnapshot.commit, 'ac6ff1ed38e4956544e1d55a4eed14329411ef11');
  assert.ok(p.tiles.filter(tile => 'sha256' in tile).length >= 20); assert.match(p.measured, /DEM10B fallback/);
  const bookmark = NIIJIMA_COAST_BOOKMARKS.find(bookmark => bookmark.id === 'habushi')!;
  assert.deepEqual([bookmark.lat, bookmark.lon], [34.3764393, 139.2755897]);
  assert.ok(coast.bounds.maxZ - coast.bounds.minZ > 8000);
  for (const [lat, lon] of [[34.39217298, 139.2794526], [34.3764393, 139.2755897], [34.35561844, 139.2758477], [34.34428046, 139.2757618]]) {
    const point = geoToWorld(lat, lon); assert.ok(coast.contains(point.x, point.z));
  }
  const gate = geoToWorld(bookmark.lat, bookmark.lon);
  assert.ok(coast.northDem.heightAt(gate.x, gate.z) > 5); assert.ok(coast.heightAt(gate.x, gate.z) > 5);
});

test('northern dry strand has a continuous walkable 400m segment and matched wet shoreline', () => {
  assert.ok(ground.heightAt(5900, -4503) > 2 && ground.heightAt(5900, -4100) > 2);
  assert.ok(footSegmentClear(ground, { x: 5900, z: -4503 }, { x: 5900, z: -4100 }));
  const dem = coast.northDem; let samples = 0, maximum = 0;
  for (let z = -6350.19; z < -3360; z += 13.37) {
    const iz = Math.round((z - dem.raster.minZ) / dem.dz); let last = 0;
    for (let ix = 0; ix < dem.raster.width; ix++) if (dem.land[iz * dem.raster.width + ix]) last = ix;
    const shoreX = dem.raster.minX + last * dem.dx;
    for (let x = shoreX - 16.37; x < shoreX + 18; x += .71) {
      const y = coast.heightAt(x, z); if (Math.abs(y) > 1.2) continue;
      maximum = Math.max(maximum, Math.abs(gpuHeight(x, z) - y)); samples++;
    }
  }
  assert.ok(samples > 1500); assert.ok(maximum <= .025, `northern wet-strand bilinear error ${maximum}m`);
});

test('water tiles stay bounded, match their shared samples and replace owned cached textures', () => {
  const a = coast.waterMap(5990, -4500), b = coast.waterMap(5990, -3400);
  assert.equal(a.texture.image.width, 2049); assert.equal(a.texture.image.height, 2049);
  assert.ok((a.texture.image.data as Uint16Array).byteLength < 34_000_000);
  const x = 6000, z = -4200;
  const sample = (map: ReturnType<NiijimaCoast['waterMap']>) => {
    const image = map.texture.image, ix = Math.round((x - map.origin.x) / map.size.x * image.width - .5), iz = Math.round((z - map.origin.y) / map.size.y * image.height - .5);
    assert.ok(ix >= 0 && ix < image.width && iz >= 0 && iz < image.height);
    return (image.data as Uint16Array)[(iz * image.width + ix) * 4];
  };
  assert.equal(sample(a), sample(b)); assert.equal(coast.waterMap(5990, -3400), b);
  let removed = 0; a.texture.addEventListener('dispose', () => removed++);
  coast.waterMap(7000, -7500); assert.equal(removed, 1);
});

test('bounded landmark grading changes rendered and sampled ground together and preserves distant coast',()=>{
  const centre=geoToWorld(34.3764393,139.2755897),level=coast.heightAt(centre.x,centre.z);
  const far={x:5990,z:-1600},before=coast.heightAt(far.x,far.z);
  coast.applyGrading({center:centre,level,halfWidth:20,halfDepth:11,feather:5,rotation:-Math.PI/2});
  assert.equal(coast.heightAt(far.x,far.z),before);
  for(let z=centre.z-16;z<=centre.z+16;z+=2)for(let x=centre.x-8;x<=centre.x+8;x+=2){
    assert.ok(Math.abs(coast.heightAt(x,z)-level)<.002,'the built footprint is level');
  }
  for(const mesh of coast.group.children as THREE.Mesh[]){
    const pos=mesh.geometry.getAttribute('position');
    for(let i=0;i<pos.count;i++)if(Math.hypot(pos.getX(i)-centre.x,pos.getZ(i)-centre.z)<24){
      assert.ok(Math.abs(pos.getY(i)-coast.heightAt(pos.getX(i),pos.getZ(i)))<.003,'visible grading matches physical samples');
    }
  }
});

test('disposing Niijima releases only owned geometry, material and texture', () => {
  let borrowedDisposals = 0, materialDisposals = 0, geometryDisposals = 0, textureDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  const meshes = coast.group.children as THREE.Mesh[];
  (meshes[0].material as THREE.Material).addEventListener('dispose', () => materialDisposals++);
  meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => geometryDisposals++));
  coast.waterMap().texture.addEventListener('dispose', () => textureDisposals++);
  coast.dispose(); assert.equal(borrowedDisposals, 0); assert.equal(materialDisposals, 1); assert.equal(geometryDisposals, 9); assert.equal(textureDisposals, 1);
});
