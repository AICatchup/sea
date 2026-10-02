import * as THREE from 'three';

export interface SkinnedReceiverOptions { maxTriangles?: number; maxDepth?: number; leafSize?: number; }
export interface SkinnedReceiverHit { distance: number; point: THREE.Vector3; normal: THREE.Vector3; uv: THREE.Vector2; materialId: number; vertexColor: THREE.Color; tangent: THREE.Vector3; bitangent: THREE.Vector3; }
type Surface = { mesh: THREE.SkinnedMesh; vertices: Float32Array; normals: Float32Array; boneSkin: Float64Array; signature: string; attributes: object[] };
type Triangle = { surface: number; indices: number[]; material: number };
type Node = { left: number; right: number; start: number; count: number };
const finite = (values: ArrayLike<number>) => { for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i]))return false;return true; };
const visible = (object: THREE.Object3D): boolean => object.visible && (!object.parent || visible(object.parent));
const supported = (m: THREE.Material) => m.visible && !m.transparent && m.opacity === 1 && m.alphaTest === 0 && !('alphaMap' in m && m.alphaMap) && !('transmission' in m && Number(m.transmission) > 0);

/** CPU skinning follows Three's skinbase/skinning/skinnormal chunks. No borrowed object is mutated.
 * Call after animation, updateMatrixWorld and skeleton.update. Topology changes require a new instance.
 * Packed addresses are texels: nodes use 3, triangles use 12. Append data into receiverDynamic.
 */
export class SkinnedReceivers {
  readonly materials: THREE.Material[] = [];
  readonly diagnostics = { available: false, reason: '', triangles: 0, vertices: 0, nodes: 0, bytes: 0, rebuilds: 0, refits: 0, skipped:0, timeMs: 0, excludedSurfaces: 0, maxDepth: 0 };
  readonly packed = { data: new Float32Array(0), nodeOffset: 0, triangleOffset: 0, root: -1, texels: 0 };
  private surfaces: Surface[] = [];
  private triangles: Triangle[] = [];
  private nodes: Node[] = [];
  private disposed = false;
  private poseKey='';
  private maxDepth: number;
  private leafSize: number;
  constructor(root: THREE.Object3D, options: SkinnedReceiverOptions = {}) {
    this.maxDepth = options.maxDepth ?? 48; this.leafSize = options.leafSize ?? 8;
    try {
      if (this.maxDepth < 1 || this.maxDepth > 48 || this.leafSize < 1 || this.leafSize > 8) throw new Error('invalid BVH limits');
      root.traverse(object => {
        if (!(object instanceof THREE.SkinnedMesh)) return;
        const mesh = object, g = mesh.geometry, p = g.getAttribute('position');
        if (Object.values(g.morphAttributes).some(a => (a as THREE.BufferAttribute[]).length)) throw new Error('morph deformation unsupported');
        if (!p || !g.getAttribute('skinIndex') || !g.getAttribute('skinWeight') || !mesh.skeleton) throw new Error('missing skin attributes/skeleton');
        const surface = this.surfaces.length;
        this.surfaces.push({ mesh, vertices: new Float32Array(p.count * 3), normals: new Float32Array(p.count * 3), boneSkin: new Float64Array(mesh.skeleton.bones.length * 16), signature: this.signature(mesh), attributes: [g.index!, ...Object.values(g.attributes)] });
        this.diagnostics.vertices += p.count;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const ids = mats.map(m => { let i = this.materials.indexOf(m); if (i < 0) { i = this.materials.length; this.materials.push(m); } return i; });
        const count = g.index?.count ?? p.count;
        const groups = Array.isArray(mesh.material) ? g.groups : [{ start: 0, count, materialIndex: 0 }];
        for (const group of groups) {
          const start = Math.max(group.start, g.drawRange.start), end = Math.min(count, group.start + group.count, g.drawRange.start + g.drawRange.count);
          if (start % 3 || end % 3) throw new Error('unaligned triangle draw range');
          const mi = group.materialIndex ?? 0, material = mats[mi];
          if (!material) throw new Error('missing group material');
          for (let j = start; j < end; j += 3) {
            if (!supported(material)) { this.diagnostics.excludedSurfaces++; continue; }
            const indices = [0, 1, 2].map(k => g.index ? g.index.getX(j + k) : j + k);
            if (indices.some(i => i < 0 || i >= p.count || !Number.isInteger(i))) throw new Error('invalid triangle index');
            this.triangles.push({ surface, indices, material: ids[mi] });
          }
        }
      });
      if (this.triangles.length > (options.maxTriangles ?? 100_000)) throw new Error('triangle budget exceeded');
      this.pose();
      const ids = this.triangles.map((_, i) => i), ordered: Triangle[] = [];
      if (ids.length) this.build(ids, ordered, 1);
      this.triangles = ordered;
      this.packed.triangleOffset = this.nodes.length * 3;
      this.packed.texels = this.packed.triangleOffset + this.triangles.length * 12;
      this.packed.data = new Float32Array(this.packed.texels * 4);
      this.packed.root = ids.length ? 0 : -1;
      this.diagnostics.triangles = this.triangles.length; this.diagnostics.nodes = this.nodes.length;
      this.diagnostics.bytes = this.packed.data.byteLength + this.surfaces.reduce((sum, s) => sum + s.vertices.byteLength + s.normals.byteLength + s.boneSkin.byteLength, 0);
      this.diagnostics.rebuilds = 1;
      this.update();
    } catch (error) { this.fail(error); }
  }
  private signature(mesh: THREE.SkinnedMesh) {
    const g = mesh.geometry;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    return `${g.uuid}:${g.index?.version}:${g.index?.count}:${Object.entries(g.attributes).map(([k, a]) => `${k}:${a.count}:${'version' in a ? a.version : a.data.version}`).join('|')}:${JSON.stringify(g.groups)}:${g.drawRange.start}:${g.drawRange.count}:${mats.map(m=>m.uuid).join(',')}`;
  }
  private fail(error: unknown) { this.diagnostics.available = false; this.diagnostics.reason = error instanceof Error ? error.message : String(error); }
  private pose() {
    const skin = new THREE.Matrix4(), bone = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const s of this.surfaces) {
      const m = s.mesh, g = m.geometry, positions = g.getAttribute('position'), normals = g.getAttribute('normal'), indices = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
      if (this.signature(m) !== s.signature) throw new Error('topology/attribute changes require rebuild');
      const attrs=[g.index!,...Object.values(g.attributes)];if(attrs.length!==s.attributes.length||attrs.some((a,i)=>a!==s.attributes[i])||s.boneSkin.length!==m.skeleton.bones.length*16)throw new Error('attribute/skeleton replacement requires rebuild');
      for (const matrix of [m.matrixWorld, m.bindMatrix, m.bindMatrixInverse]) if (!finite(matrix.elements) || Math.abs(matrix.determinant()) < 1e-20) throw new Error('singular/nonfinite skin transform');
      const boneMatrices=m.skeleton.boneMatrices;
      if (!boneMatrices || !finite(boneMatrices)) throw new Error('nonfinite/missing bone matrices');
      for(let bi=0;bi<m.skeleton.bones.length;bi++) {
        bone.fromArray(boneMatrices,bi*16);if(Math.abs(bone.determinant())<1e-20)throw new Error('singular bone transform');
        bone.premultiply(m.bindMatrixInverse).multiply(m.bindMatrix).toArray(s.boneSkin,bi*16);
      }
      normalMatrix.getNormalMatrix(m.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        skin.elements.fill(0);
        for (let j = 0; j < 4; j++) {
          const w = weights.getComponent(i, j), bi = indices.getComponent(i, j);
          if (!Number.isFinite(w) || !Number.isInteger(bi) || bi < 0 || bi >= m.skeleton.bones.length) throw new Error('invalid skin weights/index');
          if (!w) continue;
          for (let k = 0; k < 16; k++) skin.elements[k] += s.boneSkin[bi*16+k] * w;
        }
        // Skinning GLSL uses xyz of the homogeneous result, without a projective divide.
        p.fromBufferAttribute(positions, i);
        const e = skin.elements, x = p.x, y = p.y, z = p.z;
        p.set(e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]).applyMatrix4(m.matrixWorld);
        n.set(0, 0, 0);
        if (normals) { n.fromBufferAttribute(normals, i); const nx=n.x, ny=n.y, nz=n.z; n.set(e[0]*nx+e[4]*ny+e[8]*nz, e[1]*nx+e[5]*ny+e[9]*nz, e[2]*nx+e[6]*ny+e[10]*nz).applyMatrix3(normalMatrix).normalize(); }
        if (!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||!Number.isFinite(n.z)) throw new Error('nonfinite posed vertex');
        p.toArray(s.vertices, i * 3); n.toArray(s.normals, i * 3);
      }
    }
  }
  private build(ids: number[], ordered: Triangle[], depth: number): number {
    if (depth > this.maxDepth) throw new Error('BVH depth overflow');
    this.diagnostics.maxDepth = Math.max(depth, this.diagnostics.maxDepth);
    const index = this.nodes.length, node: Node = { left: -1, right: -1, start: -1, count: 0 }; this.nodes.push(node);
    if (ids.length <= this.leafSize) { node.start = ordered.length; node.count = ids.length; for (const id of ids) ordered.push(this.triangles[id]); }
    else {
      const centers = (id: number, axis: number) => { const t=this.triangles[id], v=this.surfaces[t.surface].vertices; return t.indices.reduce((sum, i) => sum + v[i*3+axis], 0)/3; };
      const extents = [0, 1, 2].map(axis => { let lo=Infinity, hi=-Infinity; for (const id of ids) { const c=centers(id,axis); lo=Math.min(lo,c); hi=Math.max(hi,c); } return hi-lo; });
      const axis=extents.indexOf(Math.max(...extents)); ids.sort((a,b) => centers(a,axis)-centers(b,axis)); const mid=Math.floor(ids.length/2);
      node.left=this.build(ids.slice(0,mid),ordered,depth+1); node.right=this.build(ids.slice(mid),ordered,depth+1);
    }
    return index;
  }
  update(): void {
    if (this.disposed) { this.fail('disposed'); return; }
    const start=performance.now();
    try {
      for(const s of this.surfaces){const attrs=[s.mesh.geometry.index!,...Object.values(s.mesh.geometry.attributes)];if(attrs.length!==s.attributes.length||attrs.some((a,i)=>a!==s.attributes[i]))throw new Error('attribute replacement requires rebuild');}
      const key=this.surfaces.map(s=>[this.signature(s.mesh),visible(s.mesh),...s.mesh.matrixWorld.elements,...s.mesh.bindMatrix.elements,...s.mesh.bindMatrixInverse.elements,...(s.mesh.skeleton.boneMatrices??[]),this.materials.map(m=>supported(m)).join(',')].join(',')).join('|');
      if(this.diagnostics.available&&key===this.poseKey){this.diagnostics.skipped++;this.diagnostics.timeMs=performance.now()-start;return;}
      this.pose(); const data=this.packed.data;
      for (let ti=0; ti<this.triangles.length; ti++) {
        const t=this.triangles[ti], s=this.surfaces[t.surface], g=s.mesh.geometry, uv=g.getAttribute('uv'), color=g.getAttribute('color');
        const base=(this.packed.triangleOffset+ti*12)*4;
        for (let k=0;k<3;k++) {
          const vi=t.indices[k];
          for (let c=0;c<3;c++) { data[base+k*4+c]=s.vertices[vi*3+c]; data[base+(k+3)*4+c]=s.normals[vi*3+c]; data[base+(k+9)*4+c]=color ? color.getComponent(vi,c) : 1; }
          data[base+(k+6)*4]=uv?.getX(vi) ?? 0; data[base+(k+6)*4+1]=uv?.getY(vi) ?? 0;
        }
        data[base+3]=visible(s.mesh) && supported(this.materials[t.material]) ? t.material : -1;
      }
      // Children are allocated after parents. Reverse order refits every node once, without sort/rebuild.
      for (let ni=this.nodes.length-1;ni>=0;ni--) {
        const node=this.nodes[ni], base=ni*12;
        for(let axis=0;axis<3;axis++) {
          let lo=Infinity, hi=-Infinity;
          if (node.count) for(let j=node.start;j<node.start+node.count;j++) for(let k=0;k<3;k++) { const v=data[(this.packed.triangleOffset+j*12+k)*4+axis];lo=Math.min(lo,v);hi=Math.max(hi,v); }
          else { lo=Math.min(data[node.left*12+axis],data[node.right*12+axis]); hi=Math.max(data[node.left*12+4+axis],data[node.right*12+4+axis]); }
          data[base+axis]=lo;data[base+4+axis]=hi;
        }
        data[base+3]=node.left;data[base+7]=node.right;data[base+8]=node.start;data[base+9]=node.count;
      }
      if (!finite(data)) throw new Error('nonfinite packed data');
      this.diagnostics.available=true;this.diagnostics.reason='';this.diagnostics.refits++;this.poseKey=key;
    } catch(error) { this.fail(error); }
    this.diagnostics.timeMs=performance.now()-start;
  }
  /** Independent brute-force Three Ray oracle (does not traverse the packed BVH). */
  inspectionRays(limit=4){
    const rays:{origin:THREE.Vector3;direction:THREE.Vector3;maxDistance:number;material:number}[]=[];
    for(const t of this.triangles){if(rays.length>=Math.min(4,limit))break;const s=this.surfaces[t.surface];if(!visible(s.mesh)||!supported(this.materials[t.material])||rays.some(r=>r.material===t.material))continue;
      const point=new THREE.Vector3(),normal=new THREE.Vector3();for(const vi of t.indices){point.add(new THREE.Vector3().fromArray(s.vertices,vi*3));normal.add(new THREE.Vector3().fromArray(s.normals,vi*3));}point.multiplyScalar(1/3);normal.normalize();if(normal.lengthSq()<.9)continue;
      rays.push({origin:point.clone().addScaledVector(normal,.25),direction:normal.negate(),maxDistance:1,material:t.material});
    }return rays;
  }
  traceCPU(origin: THREE.Vector3, unitRay: THREE.Vector3, maxDistance: number): SkinnedReceiverHit | null {
    if(!this.diagnostics.available || maxDistance<=0 || !finite(origin.toArray()) || !finite(unitRay.toArray()) || Math.abs(unitRay.lengthSq()-1)>1e-5) return null;
    const ray=new THREE.Ray(origin,unitRay), a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),point=new THREE.Vector3(), bary=new THREE.Vector3();
    let best: SkinnedReceiverHit|null=null;
    for(const t of this.triangles) {
      const s=this.surfaces[t.surface]; if(!visible(s.mesh)||!supported(this.materials[t.material])) continue;
      a.fromArray(s.vertices,t.indices[0]*3); b.fromArray(s.vertices,t.indices[1]*3); c.fromArray(s.vertices,t.indices[2]*3);
      if(!ray.intersectTriangle(a,b,c,false,point)) continue;
      const distance=point.distanceTo(origin);if(distance<1e-5||distance>=(best?.distance??maxDistance))continue;
      THREE.Triangle.getBarycoord(point,a,b,c,bary);
      const normal=new THREE.Vector3(),uv=new THREE.Vector2(),col=new THREE.Color(0,0,0),g=s.mesh.geometry;
      for(let k=0;k<3;k++){const w=bary.getComponent(k),vi=t.indices[k];normal.addScaledVector(new THREE.Vector3().fromArray(s.normals,vi*3),w);const u=g.getAttribute('uv'),co=g.getAttribute('color');if(u)uv.addScaledVector(new THREE.Vector2(u.getX(vi),u.getY(vi)),w);col.r+=w*(co?.getX(vi)??1);col.g+=w*(co?.getY(vi)??1);col.b+=w*(co?.getZ(vi)??1);}
      if(normal.lengthSq()<1e-12)normal.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a));normal.normalize();if(normal.dot(unitRay)>0)normal.negate();
      const attr=g.getAttribute('uv'),uvs=t.indices.map(i=>new THREE.Vector2(attr?.getX(i)??0,attr?.getY(i)??0)), du=uvs[1].clone().sub(uvs[0]),dv=uvs[2].clone().sub(uvs[0]),e1=b.clone().sub(a),e2=c.clone().sub(a),det=du.x*dv.y-du.y*dv.x;
      const tangent=Math.abs(det)>1e-10?e1.clone().multiplyScalar(dv.y).addScaledVector(e2,-du.y).multiplyScalar(1/det):e1.clone();
      tangent.addScaledVector(normal,-tangent.dot(normal));if(tangent.lengthSq()<1e-12)tangent.set(Math.abs(normal.y)<.9?0:1,Math.abs(normal.y)<.9?1:0,0).cross(normal);tangent.normalize();
      const bitangent=new THREE.Vector3().crossVectors(normal,tangent);if(Math.abs(det)>1e-10){const derivative=e2.multiplyScalar(du.x).addScaledVector(e1,-dv.x).multiplyScalar(1/det);if(bitangent.dot(derivative)<0)bitangent.negate();}
      best={distance,point:point.clone(),normal,uv,materialId:t.material,vertexColor:col,tangent,bitangent};
    }
    return best;
  }
  trace(origin: THREE.Vector3, unitRay: THREE.Vector3, maxDistance: number) { return this.traceCPU(origin,unitRay,maxDistance); }
  dispose() { if(this.disposed)return;this.disposed=true;this.packed.data=new Float32Array(0);this.fail('disposed'); }
}
