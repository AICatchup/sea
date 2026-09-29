import * as THREE from 'three';
import { type MapOutline, type WorldDestination } from './contracts.ts';
import { ElevationField, IslandElevation, sandAt, shelterAt, smoothstep } from './geodata.ts';
import { DESTINATION_SEEDS } from './locations.ts';
const atlasURL=new URL('../assets/tomari-atlas-v1.png',import.meta.url).href;

interface WaterMap { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2; }
const fract = (n: number) => n - Math.floor(n);
const random = (x: number, z: number, seed = 1) => fract(Math.sin(x * 12.9898 + z * 78.233 + seed * 23.13) * 43758.5453);

function detailTexture(): THREE.DataTexture {
  const size = 256, bytes = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const veins = Math.sin(x * 0.2 + Math.sin(z * 0.081) * 3.2) * Math.sin(z * 0.115 + x * 0.013);
    const grain = random(x, z, 3), fleck = Math.pow(random(x, z, 9), 13);
    const v = Math.round(149 + grain * 60 + veins * 17 - fleck * 44);
    const i = (z * size + x) * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = v; bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** Standard lit material. Only texture projection and grain are extended; the renderer owns grading. */
function makeTerrainMaterial(texture: THREE.DataTexture, atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0, bumpMap: texture, bumpScale: 0 });
  material.name = 'GSI coast: rhyolite / sand / evergreen';
  material.onBeforeCompile = shader => {
    shader.uniforms.uCoastDetail = { value: texture };
    shader.uniforms.uCoastAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoastPoint;\nvarying vec3 vCoastAxis;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoastPoint = position; vCoastAxis = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uCoastDetail;
      uniform sampler2D uCoastAtlas;
      varying vec3 vCoastPoint;
      varying vec3 vCoastAxis;
      vec3 coastTile(vec2 p, vec2 tile) {
        vec2 uv=fract(p), alt=fract(uv+.5);
        float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));
        vec2 a=(tile+clamp(uv,.004,.996))*.5,b=(tile+clamp(alt,.004,.996))*.5;
        return mix(texture2D(uCoastAtlas,a).rgb,texture2D(uCoastAtlas,b).rgb,1.0-smoothstep(0.0,.09,edge));
      }
      vec3 cliffAlbedo(vec3 p, vec3 axis) {
        vec3 w=pow(abs(normalize(axis)),vec3(5.0));w/=w.x+w.y+w.z;
        return coastTile(p.zy*.095,vec2(0,1))*w.x+coastTile(p.xz*.095,vec2(0,1))*w.y+coastTile(p.xy*.095,vec2(0,1))*w.z;
      }
      float coastGrain(vec3 p, vec3 axis, float scale) {
        vec3 weights = pow(abs(normalize(axis)), vec3(4.0));
        weights /= max(weights.x + weights.y + weights.z, 0.0001);
        return texture2D(uCoastDetail, p.zy * scale).r * weights.x
          + texture2D(uCoastDetail, p.xz * scale).r * weights.y
          + texture2D(uCoastDetail, p.xy * scale).r * weights.z;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float axisUp=abs(normalize(vCoastAxis).y);
      float sandMix=(1.0-smoothstep(1.7,7.0,vCoastPoint.y))*smoothstep(.58,.88,axisUp);
      float greenMix=smoothstep(5.0,18.0,vCoastPoint.y)*smoothstep(.65,.92,axisUp);
      vec3 stoneColor=cliffAlbedo(vCoastPoint,vCoastAxis)*.83;
      vec3 drySand=coastTile(vCoastPoint.xz*.38,vec2(1,1))*.78;
      vec3 wetSand=coastTile(vCoastPoint.xz*.38,vec2(1,0))*.83;
      vec3 sandColor=mix(wetSand,drySand,smoothstep(-.25,.8,vCoastPoint.y));
      vec3 greenColor=coastTile(vCoastPoint.xz*.18,vec2(0,0))*.58;
      diffuseColor.rgb=mix(mix(stoneColor,greenColor,greenMix),sandColor,sandMix);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float stoneRelief = dot(cliffAlbedo(vCoastPoint,vCoastAxis),vec3(.3,.5,.2));
      float microRelief=coastGrain(vCoastPoint,vCoastAxis,.75);
      float relief=stoneRelief*.8+microRelief*.2;
      normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(relief), dFdy(relief)) * .62, faceDirection);`);
  };
  material.customProgramCacheKey = () => 'gsi-coast-generated-photographic-v2';
  return material;
}

function traceOutline(field: ElevationField): [number, number][] {
  // Marching squares, then assemble the largest loop. Half-cell contour reflects source mask precision.
  const r = field.raster, segments: [[number, number], [number, number]][] = [];
  const step = r.id === 'shikine' ? 2 : 1;
  const cases: [number, number][][] = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 2], [0, 1]], [[0, 2]], [[3, 2]], [[2, 3]], [[2, 0]], [[0, 3], [1, 2]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], []];
  for (let z = 0; z + step < r.height; z += step) for (let x = 0; x + step < r.width; x += step) {
    const code = field.land[z * r.width + x] + field.land[z * r.width + x + step] * 2 + field.land[(z + step) * r.width + x + step] * 4 + field.land[(z + step) * r.width + x] * 8;
    if (!code || code === 15) continue;
    const px = r.minX + x * field.dx, pz = r.minZ + z * field.dz, dx = step * field.dx, dz = step * field.dz;
    const edge: [number, number][] = [[px + dx * 0.5, pz], [px + dx, pz + dz * 0.5], [px + dx * 0.5, pz + dz], [px, pz + dz * 0.5]];
    for (const [a, b] of cases[code]) segments.push([edge[a], edge[b]]);
  }
  const key = (point: [number, number]) => `${Math.round(point[0] * 100)}:${Math.round(point[1] * 100)}`;
  const joins = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) for (const point of segments[i]) { const k = key(point); if (!joins.has(k)) joins.set(k, []); joins.get(k)!.push(i); }
  const used = new Set<number>(); let largest: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const loop = [segments[i][0], segments[i][1]]; used.add(i);
    for (;;) {
      const endpoint = loop[loop.length - 1], next = joins.get(key(endpoint))?.find(index => !used.has(index));
      if (next === undefined) break;
      used.add(next); const pair = segments[next];
      loop.push(key(pair[0]) === key(endpoint) ? pair[1] : pair[0]);
    }
    if (loop.length > largest.length) largest = loop;
  }
  return largest.filter((_, index) => index % 2 === 0 || index === largest.length - 1);
}

export class IslandWorld {
  readonly group = new THREE.Group();
  readonly destinations: WorldDestination[];
  readonly mapOutlines: MapOutline[];
  readonly spawnPoint: THREE.Vector3;
  readonly elevation = new IslandElevation();
  private readonly maps = new Map<string, WaterMap>();
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    this.group.name = '式根島・泊 / GSI land DEM with inferred seabed';
    const grain = detailTexture(); this.textures.push(grain);
    const atlas=typeof document==='undefined'?new THREE.Texture():new THREE.TextureLoader().load(atlasURL);atlas.colorSpace=THREE.SRGBColorSpace;
    atlas.anisotropy=8;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.magFilter=THREE.LinearFilter;
    this.textures.push(atlas);
    const terrainMaterial = makeTerrainMaterial(grain, atlas); this.materials.push(terrainMaterial);
    for (const field of this.elevation.fields) this.buildTerrain(field, terrainMaterial);
    this.buildForest();
    this.spawnPoint = new THREE.Vector3(-36, this.heightAt(-36, 27) + 1.72, 27);
    this.destinations = DESTINATION_SEEDS.map(seed => {
      const arrival = this.elevation.arrival(seed.x, seed.z);
      return { ...seed, ...arrival, ...(seed.id === 'tomari' ? { landingX: -36, landingZ: 27 } : {}) };
    });
    this.mapOutlines = this.elevation.fields.filter(field => field.raster.id !== 'tomari').map(field => ({ id: field.raster.id, label: field.raster.name, points: traceOutline(field) }));
  }

  heightAt(x: number, z: number): number { return this.elevation.heightAt(x, z); }
  update(_time: number): void { /* Terrain is static; wave shelter and water depth are sampled by the ocean. */ }

  waterMapFor(x: number, z: number): WaterMap {
    const field = this.elevation.fieldAt(x, z);
    const id = field?.raster.id ?? 'open-sea';
    const cached = this.maps.get(id); if (cached) return cached;
    if (!field) {
      const data = new Uint16Array([THREE.DataUtils.toHalfFloat(-110), THREE.DataUtils.toHalfFloat(1), 0, THREE.DataUtils.toHalfFloat(1)]);
      const texture = this.makeWaterTexture(data, 1, 1);
      const result = { texture, origin: new THREE.Vector2(-30000, -30000), size: new THREE.Vector2(60000, 60000) };
      this.maps.set(id, result); return result;
    }
    const r = field.raster, data = new Uint16Array(r.width * r.height * 4);
    for (let iz = 0; iz < r.height; iz++) for (let ix = 0; ix < r.width; ix++) {
      const px = r.minX + ix * field.dx, pz = r.minZ + iz * field.dz, i = (iz * r.width + ix) * 4;
      const ground = this.heightAt(px, pz);
      const sand = Math.max(sandAt(px, pz), (1 - smoothstep(0, 7, Math.abs(ground))) * (1 - smoothstep(20, 65, Math.abs(field.shoreAt(px, pz)))) * 0.45);
      data[i] = THREE.DataUtils.toHalfFloat(ground);
      data[i + 1] = THREE.DataUtils.toHalfFloat(shelterAt(px, pz));
      data[i + 2] = THREE.DataUtils.toHalfFloat(sand);
      data[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const texture = this.makeWaterTexture(data, r.width, r.height);
    const result = { texture, origin: new THREE.Vector2(r.minX, r.minZ), size: new THREE.Vector2(r.maxX - r.minX, r.maxZ - r.minZ) };
    this.maps.set(id, result); return result;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.maps.clear(); this.group.clear();
  }

  private makeWaterTexture(data: Uint16Array, width: number, height: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
    texture.name = 'R: ground metres; G: wave shelter; B: sand; A: 1';
    this.textures.push(texture); return texture;
  }

  private buildTerrain(field: ElevationField, material: THREE.MeshStandardMaterial): void {
    const r = field.raster, detail = r.id === 'tomari', step = detail ? 1 : 2;
    const nx = Math.ceil((r.width - 1) / step) + 1, nz = Math.ceil((r.height - 1) / step) + 1;
    const positions = new Float32Array(nx * nz * 3), colors = new Float32Array(nx * nz * 3), uvs = new Float32Array(nx * nz * 2);
    const indices: number[] = [], scratch = new THREE.Color();
    const sand = new THREE.Color('#e2d4b6'), stone = new THREE.Color('#a3a396'), forest = new THREE.Color('#405342'), deepStone = new THREE.Color('#5c6457');
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = r.minX + Math.min(ix * step, r.width - 1) * field.dx, z = r.minZ + Math.min(iz * step, r.height - 1) * field.dz;
      const y = this.heightAt(x, z), slope = Math.hypot(this.heightAt(x + 3, z) - this.heightAt(x - 3, z), this.heightAt(x, z + 3) - this.heightAt(x, z - 3)) / 6;
      const i = iz * nx + ix, p = i * 3, uv = i * 2;
      positions[p] = x; positions[p + 1] = y; positions[p + 2] = z;
      uvs[uv] = x * 0.18; uvs[uv + 1] = z * 0.18;
      const sandy = Math.max(sandAt(x, z) * (1 - smoothstep(5, 12, y)), (1 - smoothstep(1.4, 6, y)) * (1 - smoothstep(0.18, 0.6, slope)) * (1 - smoothstep(20, 80, Math.abs(field.shoreAt(x, z)))) * 0.8);
      const canopy = smoothstep(3, 15, y) * (1 - smoothstep(0.32, 0.95, slope));
      scratch.copy(stone).lerp(forest, canopy).lerp(sand, sandy);
      if (y < -0.5) scratch.lerp(deepStone, (1 - sandy) * 0.26);
      const mottling = 0.92 + random(Math.floor(x / 10), Math.floor(z / 10), 14) * 0.16;
      scratch.multiplyScalar(mottling); colors[p] = scratch.r; colors[p + 1] = scratch.g; colors[p + 2] = scratch.b;
    }
    for (let iz = 0; iz + 1 < nz; iz++) for (let ix = 0; ix + 1 < nx; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      const mx = (positions[a * 3] + positions[d * 3]) * 0.5, mz = (positions[a * 3 + 2] + positions[d * 3 + 2]) * 0.5;
      if (r.id === 'shikine' && this.elevation.tomari?.contains(mx, mz)) continue;
      if (!detail && field.shoreAt(mx, mz) < -200) continue;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${r.name} / ${detail ? '4m' : r.id === 'shikine' ? '16m' : '64m'} DEM coast`;
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.userData = { source: 'GSI land elevations', seabed: 'Inferred', triangleCount: indices.length / 3 };
    this.geometries.push(geometry); this.group.add(mesh);
  }

  private buildForest(): void {
    const close: { x: number; z: number; y: number; size: number; seed: number }[] = [], distant: typeof close = [];
    const accept = (x: number, z: number, local: boolean) => {
      if (Math.hypot(x + 36, z - 27) < 250) return; // Foreground pine/brush belongs to the asset writer.
      const y = this.heightAt(x, z), shore = this.elevation.shoreAt(x, z);
      if (y < 7 || shore < 7 || sandAt(x, z) > 0.18) return;
      const slope = Math.hypot(this.heightAt(x + 5, z) - this.heightAt(x - 5, z), this.heightAt(x, z + 5) - this.heightAt(x, z - 5)) / 10;
      if (slope > 0.92) return;
      const seed = random(x, z, 72);
      if (seed < (local ? 0.51 : 0.75)) return;
      const tree = { x, z, y, size: 0.8 + random(x, z, 47) * 0.72, seed };
      (local ? close : distant).push(tree);
    };
    const main = this.elevation.shikine.raster;
    for (let z = main.minZ + 10; z < main.maxZ; z += 37) for (let x = main.minX + 10; x < main.maxX; x += 37) {
      const px = x + (random(x, z, 33) - 0.5) * 25, pz = z + (random(x, z, 37) - 0.5) * 25;
      if (Math.hypot(px + 40, pz) < 340) continue;
      accept(px, pz, false);
    }
    for (let z = -280; z < 210; z += 16) for (let x = -295; x < 230; x += 16) accept(x + random(x, z, 91) * 11, z + random(x, z, 94) * 11, true);
    close.splice(190); distant.splice(760);
    const leaves = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.97, metalness: 0 });
    const bark = new THREE.MeshStandardMaterial({ color: '#665a46', roughness: 1, metalness: 0 });
    const localCrown = new THREE.SphereGeometry(1, 8, 4), farCrown = new THREE.IcosahedronGeometry(1, 0), trunk = new THREE.CylinderGeometry(0.10, 0.22, 1, 5);
    this.materials.push(leaves, bark); this.geometries.push(localCrown, farCrown, trunk);
    const count = close.length + distant.length;
    const trunks = new THREE.InstancedMesh(trunk, bark, count), nearLeaves = new THREE.InstancedMesh(localCrown, leaves, close.length * 4), farLeaves = new THREE.InstancedMesh(farCrown, leaves, distant.length * 2);
    const matrix = new THREE.Object3D(), tint = new THREE.Color(); let trunkIndex = 0;
    const fill = (trees: typeof close, crowns: THREE.InstancedMesh, clusters: number) => {
      for (let i = 0; i < trees.length; i++) {
        const tree = trees[i], height = (4.8 + tree.seed * 2.5) * tree.size;
        matrix.position.set(tree.x, tree.y + height * 0.42, tree.z); matrix.scale.set(tree.size, height * 0.86, tree.size);
        matrix.rotation.set(0.04 * Math.sin(tree.x), tree.seed * Math.PI, -0.055); matrix.updateMatrix(); trunks.setMatrixAt(trunkIndex++, matrix.matrix);
        for (let c = 0; c < clusters; c++) {
          const angle = c * 2.39996 + tree.seed * 5, radius = c ? 1.6 * tree.size : 0;
          matrix.position.set(tree.x + Math.cos(angle) * radius, tree.y + height - c * 0.4, tree.z + Math.sin(angle) * radius);
          matrix.scale.set((2.6 - c * 0.18) * tree.size, (0.9 + tree.seed * 0.35) * tree.size, (2.3 - c * 0.12) * tree.size);
          matrix.rotation.set(0, angle, 0.04 * Math.sin(angle)); matrix.updateMatrix(); crowns.setMatrixAt(i * clusters + c, matrix.matrix);
          tint.setRGB(0.11 + tree.seed * 0.052, 0.15 + tree.seed * 0.07, 0.075 + tree.seed * 0.027); crowns.setColorAt(i * clusters + c, tint);
        }
      }
    };
    fill(close, nearLeaves, 4); fill(distant, farLeaves, 2);
    trunks.name = 'Procedural black-pine trunks'; nearLeaves.name = 'Wind-shaped Tomari pine crowns'; farLeaves.name = '式根島 evergreen cover';
    for (const mesh of [trunks, nearLeaves, farLeaves]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.group.add(mesh); }
  }
}
