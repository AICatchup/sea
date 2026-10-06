import * as THREE from 'three';

export interface ReceiverOptions {
  /** Explicit authored coverage. Exclude water, DEM, foliage, particles and first-person bodies here. */
  include: (mesh: THREE.Mesh) => boolean;
  /** Dynamic spatial eligibility belongs to refit, never the immutable BLAS signature. */
  active?: (mesh: THREE.Mesh) => boolean;
  coverage?: string;
  maxTriangles?: number; maxInstances?: number; maxDepth?: number; leafSize?: number;
}
export interface ReceiverHit { distance: number; point: THREE.Vector3; normal: THREE.Vector3; uv: THREE.Vector2; materialId: number; vertexColor: THREE.Color; }
type Triangle = { p: THREE.Vector3[]; n: THREE.Vector3[]; uv: THREE.Vector2[]; c: THREE.Color[]; material: number; box: THREE.Box3 };
type Node = { box: THREE.Box3; left: number; right: number; start: number; count: number };
type Blas = { root: number; box: THREE.Box3 };
type Instance = { mesh: THREE.Mesh; index: number; blas: Blas; inverse: THREE.Matrix4; normal: THREE.Matrix3; box: THREE.Box3 };
const WIDTH = 1024;
const texture = (values: number[]) => {
  const height = Math.max(1, Math.ceil(values.length / (WIDTH * 4)));
  const data = new Float32Array(WIDTH * height * 4); data.set(values);
  const result = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  result.minFilter = result.magFilter = THREE.NearestFilter; result.generateMipmaps = false; result.needsUpdate = true;
  return result;
};
const packNodes = (nodes: Node[]) => nodes.flatMap(n => [...n.box.min.toArray(), n.left, ...n.box.max.toArray(), n.right, n.start, n.count, 0, 0]);
const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const visible = (o: THREE.Object3D): boolean => o.visible && (!o.parent || visible(o.parent));

/** Owns packed textures only; all scene geometry/materials remain borrowed. Rebuild for topology/material changes. */
export class GeometryReceivers {
  readonly materials: THREE.Material[] = [];
  readonly diagnostics: { available: boolean; reason: string; coverage: string; triangles: number; instances: number; nodes: number; bytes: number; version: number; rebuilds: number; refits: number; excludedSurfaces: number; lastChange?:string };
  readonly uniforms: Record<string, { value: THREE.DataTexture | number }>;
  private readonly options: Required<Omit<ReceiverOptions, 'include'>> & Pick<ReceiverOptions, 'include'>;
  private readonly triangles: Triangle[] = [];
  private readonly nodes: Node[] = [];
  private readonly instances: Instance[] = [];
  private readonly selected: THREE.Mesh[] = [];
  private readonly cache = new Map<string, Blas>();
  private blasNodeCount = 0;
  private disposed = false;
  private signature = '';
  private readonly attributeIds = new WeakMap<object, number>();
  private nextAttributeId = 0;
  private attributeId(value: object) { let id = this.attributeIds.get(value); if (id === undefined) { id = ++this.nextAttributeId; this.attributeIds.set(value, id); } return id; }
  private readonly scene: THREE.Object3D;
  /** Direct packed arrays for deterministic layout verification; treat as readonly. */
  get packed() { return { tlas: (this.uniforms.receiverTLAS.value as THREE.DataTexture).image.data as Float32Array, nodes: (this.uniforms.receiverNodes.value as THREE.DataTexture).image.data as Float32Array, triangles: (this.uniforms.receiverTriangles.value as THREE.DataTexture).image.data as Float32Array, instances: (this.uniforms.receiverInstances.value as THREE.DataTexture).image.data as Float32Array }; }
  constructor(scene: THREE.Object3D, options: ReceiverOptions) {
    this.scene = scene;
    this.options = { coverage: options.coverage ?? 'explicit include predicate; no coverage guarantee outside selected meshes', maxTriangles: options.maxTriangles ?? 1_000_000, maxInstances: options.maxInstances ?? 4096, maxDepth: options.maxDepth ?? 48, leafSize: options.leafSize ?? 8, include: options.include, active: options.active??(()=>true) };
    this.diagnostics = { available: true, reason: '', coverage: this.options.coverage, triangles: 0, instances: 0, nodes: 0, bytes: 0, version: 0, rebuilds: 0, refits: 0, excludedSurfaces: 0 };
    this.uniforms = { receiverNodes: { value: texture([]) }, receiverTLAS: { value: texture([]) }, receiverTriangles: { value: texture([]) }, receiverInstances: { value: texture([]) }, receiverTextureWidth: { value: WIDTH }, receiverRoot: { value: -1 }, receiverAvailable: { value: 0 } };
    try {
      if (this.options.maxDepth > 48 || this.options.maxDepth < 1 || this.options.leafSize < 1 || this.options.leafSize > 8) throw new Error('invalid BVH limits (depth 1..48, leaf 1..8)');
      this.rebuild();
      this.refit();
    } catch (error) { this.fail(error); }
  }
  private sceneSignature(): string {
    const keys: string[] = [];
    this.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !this.options.include(o)) return;
      const g = o.geometry, mats = Array.isArray(o.material) ? o.material : [o.material];
      const attrs = Object.entries(g.attributes as Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>).map(([k, a]) => `${k}:${this.attributeId(a)}:${a.count}:${'version' in a ? a.version : a.data.version}`).join(',');
      keys.push(`${o.uuid}:${g.uuid}:${g.index ? this.attributeId(g.index) : 0}:${g.index?.version}:${attrs}:${g.drawRange.start}:${g.drawRange.count}:${JSON.stringify(g.groups)}:${mats.map(m => `${m.uuid}:${m.version}:${m.visible}:${m.transparent}:${m.opacity}:${m.alphaTest}:${'alphaMap' in m && !!m.alphaMap}:${'transmission' in m ? m.transmission : 0}`).join(',')}`);
    });
    return keys.join('|');
  }
  private rebuild() {
    this.triangles.length = 0; this.nodes.length = 0; this.materials.length = 0; this.selected.length = 0; this.cache.clear(); this.diagnostics.excludedSurfaces = 0;
      this.scene.traverse(o => { if (o instanceof THREE.Mesh && this.options.include(o)) this.selected.push(o); });
      for (const mesh of this.selected) this.getBlas(mesh);
      this.blasNodeCount = this.nodes.length;
      this.replace('receiverNodes', texture(packNodes(this.nodes)));
      this.replace('receiverTriangles', texture(this.triangles.flatMap(t => [
        ...t.p[0].toArray(), t.material, ...t.p[1].toArray(), 0, ...t.p[2].toArray(), 0,
        ...t.n[0].toArray(), 0, ...t.n[1].toArray(), 0, ...t.n[2].toArray(), 0,
        ...t.uv[0].toArray(), 0, 0, ...t.uv[1].toArray(), 0, 0, ...t.uv[2].toArray(), 0, 0,
        ...t.c[0].toArray(), 0, ...t.c[1].toArray(), 0, ...t.c[2].toArray(), 0])));
      this.diagnostics.triangles = this.triangles.length;
    this.signature = this.sceneSignature(); this.diagnostics.rebuilds++;
  }
  private fail(error: unknown) { this.diagnostics.available = false; this.diagnostics.reason = error instanceof Error ? error.message : String(error); this.uniforms.receiverAvailable.value = 0; this.uniforms.receiverRoot.value = -1; }
  private replace(name: string, next: THREE.DataTexture) { (this.uniforms[name].value as THREE.DataTexture).dispose(); this.uniforms[name].value = next; }
  private build(items: { box: THREE.Box3; id: number }[], depth: number, leaf: (ids: number[]) => number): number {
    if (depth > this.options.maxDepth) throw new Error('BVH depth overflow');
    const box = new THREE.Box3(); for (const item of items) box.union(item.box);
    const index = this.nodes.length; this.nodes.push({ box, left: -1, right: -1, start: -1, count: 0 });
    if (items.length <= this.options.leafSize) { this.nodes[index].start = leaf(items.map(i => i.id)); this.nodes[index].count = items.length; }
    else {
      const size = box.getSize(new THREE.Vector3()); const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
      items.sort((a, b) => (a.box.min[axis] + a.box.max[axis]) - (b.box.min[axis] + b.box.max[axis]));
      const mid = Math.floor(items.length / 2);
      this.nodes[index].left = this.build(items.slice(0, mid), depth + 1, leaf); this.nodes[index].right = this.build(items.slice(mid), depth + 1, leaf);
    }
    return index;
  }
  private getBlas(mesh: THREE.Mesh): Blas {
    if (mesh instanceof THREE.SkinnedMesh || mesh.geometry.morphAttributes.position?.length) throw new Error('selected skinned/morph mesh unsupported; exclude explicitly');
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const key = mesh.geometry.uuid + ':' + mats.map(m => m.uuid).join(','); const cached = this.cache.get(key); if (cached) return cached;
    const geometry = mesh.geometry, pos = geometry.getAttribute('position'), norm = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv'), color = geometry.getAttribute('color'), indices = geometry.index;
    if (!pos || pos.itemSize < 3) throw new Error('selected geometry has no position');
    const total = indices?.count ?? pos.count, begin = Math.max(0, geometry.drawRange.start), end = Math.min(total, begin + geometry.drawRange.count);
    const local: Triangle[] = [];
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const group of groups) {
      const mat = mats[group.materialIndex ?? 0]; if (!mat) throw new Error('missing group material');
      const unsupported = !Number.isFinite(mat.opacity) || mat.transparent || mat.opacity < 1 || mat.alphaTest > 0 || ('alphaMap' in mat && !!mat.alphaMap) || ('transmission' in mat && Number(mat.transmission) > 0);
      const start = Math.max(begin, group.start), stop = Math.min(end, group.start + group.count);
      if (unsupported || !mat.visible) { this.diagnostics.excludedSurfaces += Math.max(0, Math.floor((stop - start) / 3)); continue; }
      if (start % 3 || stop % 3) throw new Error('unaligned drawRange/group triangle boundary');
      let material = this.materials.indexOf(mat); if (material < 0) { material = this.materials.length; this.materials.push(mat); }
      for (let offset = start; offset < stop; offset += 3) {
        if (this.triangles.length + local.length >= this.options.maxTriangles) throw new Error('unique triangle budget overflow');
        const ids = [0, 1, 2].map(k => indices ? indices.getX(offset + k) : offset + k);
        if (ids.some(i => i < 0 || i >= pos.count)) throw new Error('invalid triangle index');
        const p = ids.map(i => new THREE.Vector3().fromBufferAttribute(pos, i)); if (!p.every(finite)) throw new Error('non-finite triangle position');
        const face = new THREE.Triangle(...p as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getNormal(new THREE.Vector3());
        const n = ids.map(i => norm ? new THREE.Vector3().fromBufferAttribute(norm, i) : face.clone());
        const u = ids.map(i => uv ? new THREE.Vector2(uv.getX(i), uv.getY(i)) : new THREE.Vector2());
        const c = ids.map(i => color ? new THREE.Color(color.getX(i), color.getY(i), color.getZ(i)) : new THREE.Color(1, 1, 1));
        if (!n.every(finite) || !u.every(v => Number.isFinite(v.x) && Number.isFinite(v.y)) || !c.every(v => Number.isFinite(v.r) && Number.isFinite(v.g) && Number.isFinite(v.b))) throw new Error('non-finite normal/UV/color');
        local.push({ p, n, uv: u, c, material, box: new THREE.Box3().setFromPoints(p) });
      }
    }
    const root = local.length ? this.build(local.map((t, id) => ({ box: t.box, id })), 1, ids => { const start = this.triangles.length; for (const id of ids) this.triangles.push(local[id]); return start; }) : -1;
    const blas = { root, box: root >= 0 ? this.nodes[root].box.clone() : new THREE.Box3() }; this.cache.set(key, blas); return blas;
  }
  /** Call after scene.updateMatrixWorld(true). Reuses immutable BLAS/triangles; only small TLAS and instance textures change. */
  refit(): boolean {
    if (this.disposed || !this.diagnostics.available) return false;
    try {
      const signature=this.sceneSignature();
      if(signature!==this.signature){const a=this.signature.split('|'),b=signature.split('|'),index=b.findIndex((row,i)=>row!==a[i]),row=b[index]??'',uuid=row.split(':')[0],object=this.scene.getObjectByProperty('uuid',uuid);this.diagnostics.lastChange=`${object?.name??uuid} old=${a[index]?.slice(0,250)} new=${row.slice(0,250)}`;this.rebuild();}
      this.nodes.length = this.blasNodeCount; const found: Instance[] = [];
      for (const mesh of this.selected) {
        if (!visible(mesh)) continue;
        const count = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
        if (count < 0 || (mesh instanceof THREE.InstancedMesh && count > mesh.instanceMatrix.count)) throw new Error('invalid instance count');
        if(!count||!this.options.active(mesh))continue;
        const blas = this.getBlas(mesh); if (blas.root < 0) continue;
        for (let index = 0; index < count; index++) {
          if (found.length >= this.options.maxInstances) throw new Error('instance budget overflow');
          const world = mesh.matrixWorld.clone(); if (mesh instanceof THREE.InstancedMesh) { const local = new THREE.Matrix4(); mesh.getMatrixAt(index, local); world.multiply(local); }
          if (!world.elements.every(Number.isFinite) || Math.abs(world.determinant()) < 1e-12) throw new Error('singular/non-finite instance transform');
          found.push({ mesh, index, blas, inverse: world.clone().invert(), normal: new THREE.Matrix3().getNormalMatrix(world), box: blas.box.clone().applyMatrix4(world) });
        }
      }
      this.instances.length = 0;
      const root = found.length ? this.build(found.map((i, id) => ({ box: i.box, id })), 1, ids => { const start = this.instances.length; for (const id of ids) this.instances.push(found[id]); return start; }) : -1;
      const packed = this.instances.flatMap(i => [...i.inverse.elements, ...[0, 1, 2].flatMap(col => [i.normal.elements[col * 3], i.normal.elements[col * 3 + 1], i.normal.elements[col * 3 + 2], 0]), i.blas.root, i.index, 0, 0]);
      this.replace('receiverInstances', texture(packed));
      const topNodes = this.nodes.slice(this.blasNodeCount).map(n => ({ ...n, left: n.left < 0 ? -1 : n.left - this.blasNodeCount, right: n.right < 0 ? -1 : n.right - this.blasNodeCount }));
      this.replace('receiverTLAS', texture(packNodes(topNodes)));
      this.uniforms.receiverRoot.value = root < 0 ? -1 : root - this.blasNodeCount; this.uniforms.receiverAvailable.value = root >= 0 ? 1 : 0; this.diagnostics.instances = found.length; this.diagnostics.nodes = this.nodes.length; this.diagnostics.bytes = Object.values(this.packed).reduce((n, data) => n + data.byteLength, 0); this.diagnostics.refits++; this.diagnostics.version++; return true;
    } catch (error) { this.fail(error); return false; }
  }
  traceCPU(origin: THREE.Vector3, ray: THREE.Vector3, maxDistance: number): ReceiverHit | null {
    if (!this.diagnostics.available || this.disposed || !Number.isFinite(maxDistance) || maxDistance <= 0 || Math.abs(ray.length() - 1) > 1e-5) return null;
    let hit: ReceiverHit | null = null;
    // Independent triangle oracle deliberately ignores packed BVH traversal.
    for (const instance of this.instances) {
      if(!new THREE.Ray(origin,ray).intersectsBox(instance.box))continue;
      const o = origin.clone().applyMatrix4(instance.inverse), d = ray.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(instance.inverse));
      const localRay=new THREE.Ray(o,d);
      const visit = (nodeId: number) => { const node = this.nodes[nodeId];if(!localRay.intersectsBox(node.box))return; if (!node.count) { visit(node.left); visit(node.right); return; }
        for (let k = 0; k < node.count; k++) {
          const t = this.triangles[node.start + k], e1 = t.p[1].clone().sub(t.p[0]), e2 = t.p[2].clone().sub(t.p[0]), q = d.clone().cross(e2), det = e1.dot(q);
          if (Math.abs(det) < 1e-10) continue;
          const s = o.clone().sub(t.p[0]), u = s.dot(q) / det, r = s.clone().cross(e1), v = d.dot(r) / det, distance = e2.dot(r) / det;
          if (u < 0 || v < 0 || u + v > 1 || distance < 1e-5 || distance >= (hit?.distance ?? maxDistance)) continue;
          const w = 1 - u - v;
          const normal = t.n[0].clone().multiplyScalar(w).addScaledVector(t.n[1], u).addScaledVector(t.n[2], v).applyMatrix3(instance.normal).normalize(); if (normal.dot(ray) > 0) normal.negate();
          hit = { distance, point: origin.clone().addScaledVector(ray, distance), normal, uv: t.uv[0].clone().multiplyScalar(w).addScaledVector(t.uv[1], u).addScaledVector(t.uv[2], v), materialId: t.material, vertexColor: t.c[0].clone().multiplyScalar(w).add(t.c[1].clone().multiplyScalar(u)).add(t.c[2].clone().multiplyScalar(v)) };
        }
      }; visit(instance.blas.root);
    }
    return hit;
  }
  /** Bounded actual-triangle rays for developer GPU/CPU comparison, not synthetic proxy targets. */
  inspectionRays(center:THREE.Vector3,limit=4){
    const rays:{origin:THREE.Vector3;direction:THREE.Vector3;maxDistance:number;source:string}[]=[];
    for(const instance of [...this.instances].sort((a,b)=>a.box.distanceToPoint(center)-b.box.distanceToPoint(center))){
      if(rays.length>=Math.min(4,Math.max(0,limit)))break;
      let node=this.nodes[instance.blas.root];while(!node.count)node=this.nodes[node.left];const triangle=this.triangles[node.start];if(!triangle)continue;
      const matrix=instance.inverse.clone().invert(),point=triangle.p[0].clone().add(triangle.p[1]).add(triangle.p[2]).multiplyScalar(1/3).applyMatrix4(matrix);
      const normal=triangle.n[0].clone().add(triangle.n[1]).add(triangle.n[2]).applyMatrix3(instance.normal).normalize();if(normal.lengthSq()<.9)continue;
      rays.push({origin:point.clone().addScaledVector(normal,2),direction:normal.negate(),maxDistance:5,source:instance.mesh.name});
    }
    return rays;
  }
  dispose() { if (this.disposed) return; this.disposed = true; for (const key of ['receiverNodes', 'receiverTLAS', 'receiverTriangles', 'receiverInstances']) (this.uniforms[key].value as THREE.DataTexture).dispose(); this.uniforms.receiverAvailable.value = 0; }
}
