import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geoToWorld, worldToGeo } from '../src/world/contracts.ts';
import { IslandWorld } from '../src/world/terrain.ts';
import { GEODATA_PROVENANCE, IslandElevation, shelterAt } from '../src/world/geodata.ts';

const world = new IslandWorld();

test('GSI land snapshot contains all three real islands and a high-resolution Tomari patch', () => {
  const elevation = new IslandElevation();
  assert.deepEqual(elevation.fields.map(field => field.raster.id), ['shikine', 'tomari', 'niijima', 'kozushima']);
  for (const field of elevation.fields) {
    assert.equal(field.values.length, field.raster.width * field.raster.height);
    assert.ok(field.land.reduce((sum, cell) => sum + cell, 0) > 15000);
    if (field.raster.id !== 'tomari') {
      const { width, height } = field.raster;
      assert.ok(field.land.slice(0, width).every(cell => !cell), `${field.raster.name} north edge clips island`);
      assert.ok(field.land.slice((height - 1) * width).every(cell => !cell), `${field.raster.name} south edge clips island`);
      for (let z = 0; z < height; z++) assert.ok(!field.land[z * width] && !field.land[z * width + width - 1], `${field.raster.name} east/west edge clips island`);
    }
  }
  assert.ok(elevation.tomari!.dx < 4);
  assert.match(GEODATA_PROVENANCE.bathymetry, /Inferred/);
  assert.ok(geoToWorld(34.372, 139.252).x > 0);
  assert.ok(geoToWorld(34.372, 139.252).z < 0);
  assert.ok(geoToWorld(34.212, 139.155).x < 0);
  assert.ok(geoToWorld(34.212, 139.155).z > 0);
  const back = worldToGeo(...[1324, -823] as [number, number]);
  const converted = geoToWorld(back.lat, back.lon);
  assert.ok(Math.abs(converted.x - 1324) < 1e-7);
  assert.ok(Math.abs(converted.z + 823) < 1e-7);
});

test('the sandy Tomari spawn has camera height and a continuous walk into shallow water', () => {
  const { x, y, z } = world.spawnPoint;
  assert.ok(world.heightAt(x, z) > 0.8);
  assert.ok(Math.abs(y - world.heightAt(x, z) - 1.72) < 1e-8);
  assert.ok(world.heightAt(x, -18) < -0.7);
  for (let step = 0; step < 60; step++) {
    const a = world.heightAt(x, z - step), b = world.heightAt(x, z - step - 1);
    assert.ok(Math.abs(a - b) < 0.3, `sandy strand abrupt at ${z - step}: ${a} -> ${b}`);
  }
  assert.ok(shelterAt(-55, -30) >= 0.1 && shelterAt(-55, -30) <= 0.2);
  assert.ok(shelterAt(-500, -800) > 0.99);
});

test('arrival points are water and every island has a dry coastal landing', () => {
  assert.deepEqual(world.destinations.map(destination => destination.id), ['tomari', 'nakanoura', 'niijima', 'kozushima']);
  for (const destination of world.destinations) {
    assert.ok(world.heightAt(destination.x, destination.z) < -2.3, destination.label);
    assert.ok(world.heightAt(destination.landingX!, destination.landingZ!) > 0.55, destination.label);
    assert.ok(Number.isFinite(destination.heading));
  }
});

test('Tomari detail joins the main DEM continuously at all raster edges', () => {
  const r = world.elevation.tomari!.raster;
  for (const edge of [[r.minX, 80, 0.0001, 0], [r.maxX, 80, -0.0001, 0], [-100, r.minZ, 0, 0.0001], [-100, r.maxZ, 0, -0.0001]]) {
    const [x, z, dx, dz] = edge;
    assert.ok(Math.abs(world.heightAt(x + dx, z + dz) - world.heightAt(x - dx, z - dz)) < 0.01);
  }
});

test('depth maps store metre-valued half floats and preserve GSI cell order', () => {
  const result = world.waterMapFor(-36, 27), r = world.elevation.tomari!.raster;
  assert.equal(result.texture.type, THREE.HalfFloatType);
  assert.equal(result.texture.minFilter, THREE.LinearFilter);
  assert.equal(result.origin.x, r.minX); assert.equal(result.origin.y, r.minZ);
  assert.equal(result.size.x, r.maxX - r.minX); assert.equal(result.size.y, r.maxZ - r.minZ);
  const values = result.texture.image.data as Uint16Array;
  for (const [ix, iz] of [[60, 140], [110, 60], [150, 190]]) {
    const field = world.elevation.tomari!, x = r.minX + ix * field.dx, z = r.minZ + iz * field.dz;
    const i = (iz * r.width + ix) * 4;
    assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(values[i]) - world.heightAt(x, z)) < 0.045);
    assert.equal(THREE.DataUtils.fromHalfFloat(values[i + 3]), 1);
  }
  assert.equal(world.waterMapFor(-36, 27).texture, result.texture);
  const ocean = world.waterMapFor(20000, -20000);
  assert.equal(THREE.DataUtils.fromHalfFloat((ocean.texture.image.data as Uint16Array)[0]), -110);
});

test('terrain triangle budget and map outlines are bounded and useful', () => {
  const coast = world.group.children.filter(mesh => mesh.name.includes('DEM coast')) as THREE.Mesh[];
  const shikine = coast.filter(mesh => mesh.name.includes('式根島') || mesh.name.includes('泊'));
  assert.ok(shikine.reduce((count, mesh) => count + mesh.geometry.index!.count / 3, 0) <= 250000);
  assert.equal(world.mapOutlines.length, 3);
  for (const outline of world.mapOutlines) {
    assert.ok(outline.points.length > 100 && outline.points.length < 1200);
    assert.ok(outline.points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)));
  }
});

test('travel-island movement samples match visible coarse mesh surfaces', () => {
  const meshes = world.group.children.filter(mesh => mesh.name.includes('新島 /') || mesh.name.includes('神津島 /')) as THREE.Mesh[];
  for (const mesh of meshes) {
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!;
    for (let i = 0; i < indices.count; i += 153) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
      const z = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3;
      const visibleHeight = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
      assert.ok(Math.abs(world.heightAt(x, z) - visibleHeight) < 0.025, `${mesh.name}: movement clips visible ground`);
    }
  }
});
