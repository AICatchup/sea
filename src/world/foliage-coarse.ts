import * as THREE from 'three';
// @ts-expect-error Three bundles the official meshoptimizer JS/WASM helper without typings.
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import type { FoliagePart, FoliageVariant } from './foliage.ts';
import type { ModelResources } from './models/procedural.ts';
import { representativeLeaves, type LeafAlphaSampling, type LeafAlphaLayer } from './foliage-coverage.ts';

/** Preserve subpixel needle coverage after decimation, without filling crown gaps or adding blobs. */
export function preserveLeafCoverage(positions: Float32Array, indices: Uint32Array, displacement = .15): { components: number; maxDisplacement: number } {
  const count = positions.length / 3, parents = Uint32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => { let root = i; while (parents[root] !== root) root = parents[root]; while (parents[i] !== i) { const next = parents[i]; parents[i] = root; i = next; } return root; };
  const join = (a: number, b: number) => { parents[find(b)] = find(a); };
  const welded = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(positions[i * 3] * 1e5)},${Math.round(positions[i * 3 + 1] * 1e5)},${Math.round(positions[i * 3 + 2] * 1e5)}`;
    const previous = welded.get(key); if (previous !== undefined) join(i, previous); else welded.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) { join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]); }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) { const root = find(i), list = groups.get(root) ?? []; list.push(i); groups.set(root, list); }
  let maxDisplacement = 0;
  for (const vertices of groups.values()) {
    const center = new THREE.Vector3(); vertices.forEach(i => { center.x += positions[i * 3]; center.y += positions[i * 3 + 1]; center.z += positions[i * 3 + 2]; }); center.multiplyScalar(1 / vertices.length);
    let radius = 0;
    vertices.forEach(i => { radius = Math.max(radius, Math.hypot(positions[i * 3] - center.x, positions[i * 3 + 1] - center.y, positions[i * 3 + 2] - center.z)); });
    // Each original disconnected needle/fascicle stays a separate real 3D component.
    // Uniform scaling preserves its original normals and UVs. The 15cm displacement cap
    // is below two screen pixels at 100m and cannot turn a branch into an oversized card.
    const factor = Math.min(3.6, 1 + displacement / Math.max(1e-6, radius));
    vertices.forEach(i => {
      const x = positions[i * 3] - center.x, y = positions[i * 3 + 1] - center.y, z = positions[i * 3 + 2] - center.z;
      positions[i * 3] = center.x + x * factor; positions[i * 3 + 1] = center.y + y * factor; positions[i * 3 + 2] = center.z + z * factor;
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(x, y, z) * (factor - 1));
    });
  }
  return { components: groups.size, maxDisplacement };
}

const alphaPixels = new WeakMap<THREE.Texture, {width:number;height:number;data:ArrayLike<number>}>();
function alphaSampling(g: THREE.BufferGeometry, material: THREE.MeshStandardMaterial): LeafAlphaSampling {
  const layers: LeafAlphaLayer[]=[];
  for(const [texture,component] of [[material.map,3],[material.alphaMap,1]] as const) {
    if(!texture)continue;
    let pixels=alphaPixels.get(texture);
    if(!pixels){
      const image=texture.image as {width:number;height:number;data?:ArrayLike<number>};
      if(image.data)pixels={width:image.width,height:image.height,data:image.data};
      else {const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Alpha coverage canvas unavailable');
        context.drawImage(texture.image as CanvasImageSource,0,0);pixels={width:image.width,height:image.height,data:context.getImageData(0,0,image.width,image.height).data};}
      alphaPixels.set(texture,pixels);
    }
    const uv=g.getAttribute(texture.channel===0?'uv':`uv${texture.channel}`);
    if(!uv)throw new Error(`Alpha coverage missing UV channel ${texture.channel}`);
    if(texture.matrixAutoUpdate)texture.updateMatrix();
    layers.push({...pixels,uvs:new Float32Array(uv.array),component,matrix:texture.matrix.elements.slice(),flipY:texture.flipY,wrapS:texture.wrapS,wrapT:texture.wrapT});
  }
  return {layers,threshold:material.alphaTest,opacity:material.opacity};
}

/** Reduce the original all-angle model, retaining original UVs and a connected woody hierarchy. */
export async function coarseFoliage(source: FoliageVariant, resources: ModelResources, kind: 'pine' | 'shrub', cancelled = () => false, shrubTriangles=96, refinement=false, pineLeafTriangles=720, alphaAware=false): Promise<FoliageVariant> {
  await MeshoptSimplifier.ready;
  if (cancelled()) return { parts: [], triangles: 0 };
  const parts: FoliagePart[] = [];
  for (const part of source.parts) {
    const g = part.geometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const positions = new Float32Array(p.array), normals = new Float32Array(n.array), uvs = new Float32Array(uv.array);
    const indices = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: p.count }, (_, i) => i);
    if(refinement && (kind==='shrub'||part.material.userData.foliageRole==='leaves')) {
      const selection=representativeLeaves(positions,indices,kind==='shrub'?shrubTriangles:pineLeafTriangles,128,alphaAware?alphaSampling(g,part.material):undefined);
      if(selection.unsupported) throw new Error(`Unsupported connected foliage topology: ${selection.components} components cannot fit native leaf budget`);
      const geometry=g.clone();geometry.setIndex(new THREE.BufferAttribute(selection.indices,1));
      geometry.userData={...g.userData,derivation:alphaAware?'intact native components selected by three-axis base-level photographic alpha coverage':'intact native components selected by three-axis marginal coverage',coverage:selection};
      geometry.computeBoundingBox();geometry.computeBoundingSphere();resources.geometry(geometry);parts.push({geometry,material:part.material});continue;
    }
    if(refinement && kind==='pine') {const geometry=g.clone();resources.geometry(geometry);parts.push({geometry,material:part.material});continue;}
    const bark = kind === 'pine' && part.material.name.includes('bark');
    const target = kind === 'shrub' ? shrubTriangles : bark ? 72 : 160;
    const attributes = new Float32Array(p.count * 5);
    for (let i = 0; i < p.count; i++) attributes.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uvs[i * 2], uvs[i * 2 + 1]], i * 5);
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, 5,
      [.05, .05, .05, .2, .2], null, Math.min(indices.length, target * 3), .16, ['Permissive']);
    const [remap, count] = MeshoptSimplifier.compactMesh(reduced);
    const compact = (array: Float32Array, stride: number) => {
      const out = new Float32Array(count * stride);
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let axis = 0; axis < stride; axis++) out[remap[i] * stride + axis] = array[i * stride + axis];
      return out;
    };
    const geometry = new THREE.BufferGeometry();
    const reducedPositions = compact(positions, 3);
    const coverage = kind === 'pine' && !bark ? preserveLeafCoverage(reducedPositions, new Uint32Array(reduced)) : undefined;
    geometry.setAttribute('position', new THREE.BufferAttribute(reducedPositions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(compact(normals, 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(compact(uvs, 2), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(reduced), 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.userData = { source: part.material.userData.source, derivation: 'UV/normal-aware reduction of CC0 middle model', targetTriangles: target,
      triangles: reduced.length / 3, normalizedError: error, kind: bark ? 'connected woody hierarchy' : 'original needle / leaf geometry', coverage };
    resources.geometry(geometry); parts.push({ geometry, material: part.material });
  }
  return { parts, triangles: parts.reduce((sum, p) => sum + (p.geometry.index!.count / 3), 0) };
}
