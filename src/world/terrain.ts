import * as THREE from 'three';
import {createNiijimaCliffSkin,type CliffSkin} from './niijima-cliff-skin.ts';
import type {NiijimaPointCliff} from './niijima-point-cliff.ts';
import { PLAYER_DIMENSIONS, type MapOutline, type WorldDestination } from './contracts.ts';
import { ElevationField, IslandElevation, sandAt, shelterAt, smoothstep } from './geodata.ts';
import { DESTINATION_SEEDS } from './locations.ts';
import { cliffOutcrops, cliffBodySegmentBlocked, type CliffCollisionProxy, type BodyPoint } from './cliff-detail.ts';
import { CoastalFoliage } from './foliage.ts';
import { ModelResources } from './models/procedural.ts';
import { loadSandTextures } from './sand-material.ts';
import { makeTerrainMaterial,makeCliffMaterial } from './coast-material.ts';
import { NiijimaCoast } from './niijima-coast.ts';
import { HabushiMainGate } from './habushi-main-gate.ts';
import { HabushiGround } from './habushi-ground.ts';
import { NiijimaScarpVolume } from './niijima-scarp-volume.ts';
import {TomariMeasuredCoast} from './tomari-measured.ts';
import { TomariCliffVolume } from './tomari-cliff-volume.ts';
const atlasURL=new URL('../assets/tomari-atlas-v1.png',import.meta.url).href;

interface WaterMap { texture: THREE.DataTexture; origin: THREE.Vector2; size: THREE.Vector2; triangulated?:boolean; }
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
  readonly sandAppearance = { value: 0 };
  readonly group = new THREE.Group();
  readonly destinations: WorldDestination[];
  readonly mapOutlines: MapOutline[];
  readonly spawnPoint: THREE.Vector3;
  readonly ready:Promise<void>;
  readonly elevation:IslandElevation;
  readonly cliffCollisionProxies: CliffCollisionProxy[] = [];
  readonly niijimaCoast:NiijimaCoast;
  readonly habushiGate:HabushiMainGate;
  readonly habushiGround:HabushiGround;
  readonly scarpVolume:NiijimaScarpVolume|null;
  readonly cliffVolume:TomariCliffVolume|null;
  readonly tomariMeasured:TomariMeasuredCoast|null;
  readonly niijimaCliffSkin:CliffSkin|null;
  private pointCliffValue:NiijimaPointCliff|null=null;
  get niijimaPointCliff():NiijimaPointCliff|null{return this.pointCliffValue;}
  private disposed=false;
  private readonly maps = new Map<string, WaterMap>();
  private readonly niijimaShaderMaps = new WeakMap<THREE.Texture, WaterMap>();
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(coherentRock=false,dryToe=false,connectedForm=false,forestGround=false,joinedCliffSkin=false,photoStrand=false) {
    this.elevation=new IslandElevation(coherentRock,dryToe,connectedForm,photoStrand);
    this.group.name = '式根島・泊 / GSI land DEM with inferred seabed';
    const grain = detailTexture(); this.textures.push(grain);
    let atlas=new THREE.Texture();let atlasReady=Promise.resolve();
    if(typeof document!=='undefined')atlasReady=new Promise<void>((resolve,reject)=>{atlas=new THREE.TextureLoader().load(atlasURL,()=>resolve(),undefined,reject);});
    atlas.colorSpace=THREE.SRGBColorSpace;
    atlas.anisotropy=8;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.magFilter=THREE.LinearFilter;
    this.textures.push(atlas);
    const sand=loadSandTextures(8,this.sandAppearance);this.textures.push(...sand.textures);
    const terrainMaterial = makeTerrainMaterial(grain, atlas, sand,forestGround); this.materials.push(terrainMaterial);
    this.tomariMeasured=typeof location!=='undefined'&&new URLSearchParams(location.search).get('tomarisurvey')==='1'?new TomariMeasuredCoast(this.elevation,terrainMaterial):null;
    if(this.tomariMeasured)this.group.add(this.tomariMeasured.group);
    this.cliffVolume=!this.tomariMeasured&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('cliffvolume')!=='0'?new TomariCliffVolume(terrainMaterial):null;
    if(this.cliffVolume)this.group.add(this.cliffVolume.group);
    const scarp=typeof location!=='undefined'&&new URLSearchParams(location.search).get('scarp')==='1';
    const volume=typeof location!=='undefined'&&new URLSearchParams(location.search).get('volume')==='1';
    const coastConfidence=typeof location==='undefined'||new URLSearchParams(location.search).get('coastconfidence')!=='0';
    const cliffDetail=typeof location==='undefined'||new URLSearchParams(location.search).get('cliffdetail')!=='0';
    const measured=typeof location==='undefined'||new URLSearchParams(location.search).get('measuredcoast')!=='0';
    const pumiceGrain=import.meta.env?.DEV===true&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('pumicegrain')==='1';
    this.niijimaCoast=new NiijimaCoast(this.elevation,terrainMaterial,{scarp,sand,volume,coastConfidence,cliffDetail,measured,pumiceGrain});this.group.add(this.niijimaCoast.group);
    const cliffMaterial=(this.niijimaCoast.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const cliffMeso=typeof location==='undefined'||new URLSearchParams(location.search).get('cliffmeso')!=='0';
    const pointVariant=typeof location!=='undefined'?new URLSearchParams(location.search).get('poissoncoast'):null;
    const pointCliff=import.meta.env?.DEV===true&&(pointVariant==='1'||pointVariant==='2'||pointVariant==='3');
    const nativeGeology=import.meta.env?.DEV===true&&!pointCliff&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('nativegeology')==='1';
    this.niijimaCliffSkin=cliffDetail&&nativeGeology&&this.niijimaCoast.measuredPatch?
      createNiijimaCliffSkin({heightAt:(x,z)=>this.niijimaCoast.measuredPatch!.surfaceHeightAt(x,z)??this.niijimaCoast.baseHeightAt(x,z)},cliffMaterial,
        {zMin:-1070,zMax:-960,eastX:5950,westX:5810,sampleX:.25,alongZ:.5,faceSteps:512,chunkLength:120,meso:true,geology:true,topLimit:85}):
      cliffDetail&&!measured?createNiijimaCliffSkin({heightAt:(x,z)=>this.niijimaCoast.baseHeightAt(x,z)},cliffMaterial,{faceSteps:144,meso:cliffMeso}):null;
    if(this.niijimaCliffSkin){
      const c=new THREE.Color();for(const g of this.niijimaCliffSkin.geometries){const p=g.getAttribute('position'),colors=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){this.niijimaCoast.colorAt(p.getX(i),p.getY(i),p.getZ(i),c);colors.set([c.r,c.g,c.b],i*3);}g.setAttribute('color',new THREE.BufferAttribute(colors,3));}
      this.niijimaCliffSkin.group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});this.group.add(this.niijimaCliffSkin.group);
      if(nativeGeology&&this.niijimaCoast.measuredPatch){
        if(this.niijimaCliffSkin.geometries.length){
          this.niijimaCliffSkin.group.updateMatrixWorld(true);
          this.niijimaCoast.measuredPatch.replaceInteriorSurface(this.niijimaCliffSkin,new THREE.Box3().setFromObject(this.niijimaCliffSkin.group));
          this.niijimaCoast.invalidateWaterMaps();
          this.niijimaCliffSkin.group.userData.provenance='Photo-informed inferred geological relief, bounded to 0.8m visible carving / 0.3m relief, with buried guard bands, anchored to the Tokyo native heightfield. Not measured sidewall geometry.';
        }
      }else if(cliffMeso)this.niijimaCoast.replaceCliffSurface(this.niijimaCliffSkin);
    }
    // Rejected look-development assets stay out of the normal release bundle.
    const pointCliffReady=pointCliff&&this.niijimaCoast.measuredPatch?import('./niijima-point-cliff.ts').then(async({NiijimaPointCliff})=>{
      if(this.disposed)return;
      const value=new NiijimaPointCliff(this.niijimaCoast.measuredPatch!,cliffMaterial,
        {continuous:pointVariant==='2',expanded:pointVariant==='3',colorAt:(x,y,z,c)=>this.niijimaCoast.colorAt(x,y,z,c),invalidateWaterMaps:()=>this.niijimaCoast.invalidateWaterMaps()});
      this.pointCliffValue=value;this.group.add(value.group);await value.ready;
    }):Promise.resolve();
    this.scarpVolume=volume?new NiijimaScarpVolume(this.niijimaCoast,this.niijimaCoast.dem,cliffMaterial):null;
    if(this.scarpVolume)this.group.add(this.scarpVolume.group);
    this.habushiGate=new HabushiMainGate(this.niijimaCoast);
    this.niijimaCoast.applyGrading(this.habushiGate.grading);this.group.add(this.habushiGate.group);
    this.habushiGround=new HabushiGround(this.habushiGate,typeof location!=='undefined'&&new URLSearchParams(location.search).get('pavement')!=='0');
    this.ready=Promise.allSettled([atlasReady,sand.ready,terrainMaterial.userData.ready??Promise.resolve(),this.niijimaCoast.ready,this.habushiGate.ready,this.habushiGround.ready,this.cliffVolume?.ready??Promise.resolve(),pointCliffReady]).then(()=>{});
    this.niijimaCoast.applyGrading(this.habushiGround.grading);this.group.add(this.habushiGround.group);
    for (const field of this.elevation.fields) this.buildTerrain(field, terrainMaterial);
    if (this.elevation.tomari && this.elevation.coast) {
      this.buildTerrain(this.elevation.tomari, terrainMaterial, true);
      this.buildTerrain(this.elevation.tomari, terrainMaterial, true, true);
      const geometry = cliffOutcrops(this, this.elevation.coast,coherentRock,this.elevation.connectedForm||joinedCliffSkin,this.tomariMeasured?.bounds);
      this.cliffCollisionProxies.push(...geometry.userData.collisionProxies as CliffCollisionProxy[]);
      const tomariCliffMaterial=makeCliffMaterial(terrainMaterial);this.materials.push(tomariCliffMaterial);
      const outcrops = new THREE.Mesh(geometry, tomariCliffMaterial);
      outcrops.name = 'Tomari jointed rhyolite ledges and fissures'; outcrops.castShadow = outcrops.receiveShadow = true;
      this.geometries.push(geometry); this.group.add(outcrops);
    }
    this.buildForest();
    this.spawnPoint = new THREE.Vector3(-36, this.heightAt(-36, 27) + PLAYER_DIMENSIONS.eyeHeight, 27);
    this.destinations = DESTINATION_SEEDS.map(seed => {
      let arrival = this.elevation.arrival(seed.x, seed.z);
      if(this.niijimaCoast.contains(seed.x,seed.z)){
        let waterScore=Infinity,landScore=Infinity;
        for(let dz=-200;dz<=200;dz+=4)for(let dx=-200;dx<=200;dx+=4){
          const x=seed.x+dx,z=seed.z+dz,h=this.heightAt(x,z),distance=Math.hypot(dx,dz);
          if(h< -2.4&&h> -18){const score=distance+Math.abs(h+5)*4;if(score<waterScore){waterScore=score;arrival={...arrival,x,z};}}
          if(h>.55&&h<8){const score=distance+h*2;if(score<landScore){landScore=score;arrival={...arrival,landingX:x,landingZ:z};}}
        }
      }
      return { ...seed, ...arrival, ...(seed.id === 'tomari' ? { landingX: -36, landingZ: 27 } : {}) };
    });
    this.mapOutlines = this.elevation.fields.filter(field => field.raster.id !== 'tomari').map(field => ({ id: field.raster.id, label: field.raster.name, points: traceOutline(field) }));
  }

  heightAt(x: number, z: number): number { return this.tomariMeasured?.heightAt(x,z)??(this.niijimaCoast?.contains(x,z)?this.niijimaCoast.heightAt(x,z):this.elevation.heightAt(x, z)); }
  /** Inputs are the feet position, not the camera position. Conservative collision for non-heightfield ledges. */
  bodySegmentBlocked(from: BodyPoint, to: BodyPoint, radius = .38, bodyHeight = 1.72): boolean {
    return cliffBodySegmentBlocked(this.cliffCollisionProxies, from, to, radius, bodyHeight);
  }
  update(_time: number): void { /* Terrain is static; wave shelter and water depth are sampled by the ocean. */ }

  waterMapFor(x: number, z: number): WaterMap {
    if(this.niijimaCoast.contains(x,z)){
      const raw=this.niijimaCoast.waterMap(x,z),cached=this.niijimaShaderMaps.get(raw.texture);
      if(cached)return cached;
      const image=raw.texture.image as {width:number;height:number};
      const dx=raw.size.x/image.width,dz=raw.size.y/image.height;
      // Niijima supplies padded texel-centre bounds; all ocean shaders add the
      // half-texel transform themselves, so expose the first/last sample bounds.
      const map={texture:raw.texture,origin:raw.origin.clone().add(new THREE.Vector2(dx*.5,dz*.5)),size:new THREE.Vector2(raw.size.x-dx,raw.size.y-dz),triangulated:true};
      this.niijimaShaderMaps.set(raw.texture,map);return map;
    }
    const field = this.elevation.fieldAt(x, z);
    const id = field?.raster.id ?? 'open-sea';
    const cached = this.maps.get(id); if (cached) return cached;
    if (!field) {
      const data = new Uint16Array([THREE.DataUtils.toHalfFloat(-110), THREE.DataUtils.toHalfFloat(1), 0, THREE.DataUtils.toHalfFloat(1)]);
      const texture = this.makeWaterTexture(data, 1, 1);
      const result = { texture, origin: new THREE.Vector2(-30000, -30000), size: new THREE.Vector2(60000, 60000) };
      this.maps.set(id, result); return result;
    }
    const r = field.raster, subdivisions = r.id === 'tomari' ? 8 : 1;
    const width = (r.width - 1) * subdivisions + 1, height = (r.height - 1) * subdivisions + 1;
    const data = new Uint16Array(width * height * 4);
    for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
      const px = r.minX + ix * field.dx / subdivisions, pz = r.minZ + iz * field.dz / subdivisions, i = (iz * width + ix) * 4;
      const ground = this.heightAt(px, pz);
      const sand = Math.max(sandAt(px, pz), (1 - smoothstep(0, 7, Math.abs(ground))) * (1 - smoothstep(20, 65, Math.abs(field.shoreAt(px, pz)))) * 0.45);
      data[i] = THREE.DataUtils.toHalfFloat(ground);
      data[i + 1] = THREE.DataUtils.toHalfFloat(shelterAt(px, pz));
      data[i + 2] = THREE.DataUtils.toHalfFloat(sand);
      data[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
    const texture = this.makeWaterTexture(data, width, height);
    const result = { texture, origin: new THREE.Vector2(r.minX, r.minZ), size: new THREE.Vector2(r.maxX - r.minX, r.maxZ - r.minZ) };
    this.maps.set(id, result); return result;
  }

  dispose(): void {
    if(this.disposed)return;this.disposed=true;
    this.niijimaPointCliff?.dispose();
    this.niijimaCliffSkin?.dispose();
    this.cliffVolume?.dispose();
    this.tomariMeasured?.dispose();
    this.scarpVolume?.dispose();
    this.habushiGround.dispose();
    this.habushiGate.dispose();
    this.niijimaCoast.dispose();
    this.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
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

  private buildTerrain(field: ElevationField, material: THREE.MeshStandardMaterial, fine = false, strand = false): void {
    const r = field.raster, detail = r.id === 'tomari', step = detail ? 1 : 2;
    const patch = fine ? (strand ? this.elevation.beach! : this.elevation.coast!) : undefined;
    const nx = patch?.width ?? Math.ceil((r.width - 1) / step) + 1, nz = patch?.height ?? Math.ceil((r.height - 1) / step) + 1;
    const positions = new Float32Array(nx * nz * 3), colors = new Float32Array(nx * nz * 3), uvs = new Float32Array(nx * nz * 2);
    const indices: number[] = [], scratch = new THREE.Color();
    const sand = new THREE.Color('#e2d4b6'), stone = new THREE.Color('#a3a396'), forest = new THREE.Color('#405342'), deepStone = new THREE.Color('#5c6457');
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = patch ? patch.minX + ix * patch.dx : r.minX + Math.min(ix * step, r.width - 1) * field.dx;
      const z = patch ? patch.minZ + iz * patch.dz : r.minZ + Math.min(iz * step, r.height - 1) * field.dz;
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
      if (r.id === 'niijima' && this.niijimaCoast.contains(mx,mz)) continue;
      if (this.tomariMeasured?.contains(mx,mz)) continue;
      if (detail && !fine && this.elevation.coast?.contains(mx, mz)) continue;
      if (fine && !strand && this.elevation.beach?.contains(mx, mz)) continue;
      if (!detail && field.shoreAt(mx, mz) < -200) continue;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${r.name} / ${strand ? '0.5m refined' : fine ? '1m refined' : detail ? '4m' : r.id === 'shikine' ? '16m' : '64m'} DEM coast`;
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.userData = { source: 'GSI land elevations', refinement: fine ? 'Authored 1m strand and rock relief, not a higher-resolution survey' : undefined, seabed: 'Inferred', triangleCount: indices.length / 3 };
    this.geometries.push(geometry); this.group.add(mesh);
  }

  private buildForest(): void {
    const close: { x: number; z: number; y: number; size: number; seed: number }[] = [], distant: typeof close = [];
    const accept = (x: number, z: number, local: boolean) => {
      if (Math.hypot(x + 36, z - 27) < 295) return; // The authored continuous cover extends to 320m; these bands overlap.
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
    const resources = new ModelResources(), foliage = new CoastalFoliage(resources);
    const trees = [...close, ...distant], matrix = new THREE.Object3D();
    for (let variant = 0; variant < 3; variant++) {
      const selected = trees.filter((_, i) => i % 3 === variant); if (!selected.length) continue;
      const trunks = new THREE.InstancedMesh(foliage.pines[variant].bark, foliage.bark, selected.length);
      const needles = new THREE.InstancedMesh(foliage.pines[variant].needles, foliage.leaves, selected.length);
      selected.forEach((tree, i) => {
        matrix.position.set(tree.x, tree.y - .16, tree.z); matrix.scale.set(tree.size, tree.size * .94, tree.size);
        matrix.rotation.set(.015, tree.seed * Math.PI * 2, -.045); matrix.updateMatrix();
        trunks.setMatrixAt(i, matrix.matrix); needles.setMatrixAt(i, matrix.matrix);
      });
      trunks.name = `Island black-pine branches ${variant}`; needles.name = `Island photographic pine sprays ${variant}`;
      for (const mesh of [trunks, needles]) {
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere(); this.group.add(mesh);
      }
    }
    this.materials.push(...resources.materials); this.geometries.push(...resources.geometries); this.textures.push(...resources.textures);
  }
}
