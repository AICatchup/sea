import * as THREE from 'three';
import { PLAYER_DIMENSIONS, type BodyPoint, type BodyPose, type BodySweep, type GroundSampler } from './contracts.ts';

const SKIN = .001;
const CELL_SIZE = 12;
const MAX_HASH_CELLS = 256;
interface Node { box: THREE.Box3; triangles?: THREE.Triangle[]; left?: Node; right?: Node; }
interface SharedBVH { node: Node; triangles: number; references: number; closedShell: boolean; }
interface Entry { id: number; box: THREE.Box3; node: Node; cells: string[];
  matrix: THREE.Matrix4; inverse: THREE.Matrix4; reflected: boolean; cacheKey: string; triangles: number; closedShell: boolean; }
interface Distance { distance: number; normal: THREE.Vector3; point: THREE.Vector3; }
interface Capsule { start: THREE.Vector3; end: THREE.Vector3; radius: number; }
export interface CollisionStats {
  colliders: number; triangles: number; hashCells: number; largeColliders: number;
  lastCandidates: number; lastTriangleTests: number; lastIterations: number;
  /** Actual stored local triangles, versus logical triangles occupied by all instances. */
  uniqueBVHs: number; storedTriangles: number; lastTransformedTriangles: number;
}
const attributeIds = new WeakMap<object,number>();
let nextAttributeId=1;
function attributeKey(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|null|undefined):string {
  if(!attribute) return 'none';
  if(!attributeIds.has(attribute)) attributeIds.set(attribute,nextAttributeId++);
  const version='version' in attribute ? attribute.version : attribute.data.version;
  return `${attributeIds.get(attribute)}:${attribute.count}:${version}`;
}
function geometryKey(geometry:THREE.BufferGeometry):string {
  return `mesh:${geometry.uuid}:${attributeKey(geometry.getAttribute('position'))}:${attributeKey(geometry.index)}:${geometry.drawRange.start}:${geometry.drawRange.count}`;
}
const point = (p: BodyPoint): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const plain = (p: THREE.Vector3): BodyPoint => ({ x: p.x, y: p.y, z: p.z });
const valid = (p: BodyPoint): boolean => [p.x, p.y, p.z].every(Number.isFinite);
function capsule(feet: BodyPoint, radius: number, height: number, pose?: BodyPose): Capsule {
  const start = point(feet).add(new THREE.Vector3(0, radius, 0));
  const direction = pose ? point(pose.direction).normalize() : new THREE.Vector3(0, 1, 0);
  return { start, end: start.clone().addScaledVector(direction, Math.max(0, height - 2 * radius)), radius };
}
function capsuleBounds(body: Capsule): THREE.Box3 {
  return new THREE.Box3().setFromPoints([body.start, body.end]).expandByScalar(body.radius + SKIN);
}
function build(triangles: THREE.Triangle[]): Node {
  const box = new THREE.Box3();
  for (const t of triangles) box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  if (triangles.length <= 10) return { box, triangles };
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  triangles.sort((a, b) => (a.a[axis] + a.b[axis] + a.c[axis]) - (b.a[axis] + b.b[axis] + b.c[axis]));
  const half = Math.floor(triangles.length / 2);
  return { box, left: build(triangles.slice(0, half)), right: build(triangles.slice(half)) };
}
function query(node: Node, box: THREE.Box3, result: THREE.Triangle[]): void {
  if (!node.box.intersectsBox(box)) return;
  if (node.triangles) result.push(...node.triangles);
  else { query(node.left!, box, result); query(node.right!, box, result); }
}
function rayTriangles(node:Node,ray:THREE.Ray,result:THREE.Triangle[]):void {
  if(!ray.intersectsBox(node.box)) return;
  if(node.triangles) result.push(...node.triangles);
  else {rayTriangles(node.left!,ray,result);rayTriangles(node.right!,ray,result);}
}
/** Conservative welded-edge certificate, computed once per shared geometry revision.
 * Open photogrammetry is still a collision surface, but cannot define an interior.
 * Multiple overlapping closed bodies may share edges; their oriented sums cancel.
 */
function closedShell(triangles:readonly THREE.Triangle[]):boolean {
  const vertices=new Map<string,number>(),edges=new Map<string,number>();
  const vertex=(p:THREE.Vector3):number=>{
    const key=`${Math.round(p.x*1e7)},${Math.round(p.y*1e7)},${Math.round(p.z*1e7)}`;
    let id=vertices.get(key);if(id===undefined){id=vertices.size;vertices.set(key,id);}return id;
  };
  for(const triangle of triangles) {
    const ids=[vertex(triangle.a),vertex(triangle.b),vertex(triangle.c)];
    if(new Set(ids).size<3)return false;
    for(let i=0;i<3;i++) {
      const a=ids[i],b=ids[(i+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;
      edges.set(key,(edges.get(key)??0)+(a<b?1:-1));
    }
  }
  return edges.size>0 && [...edges.values()].every(sum=>sum===0);
}
function enclosed(entry:Entry,p:THREE.Vector3):boolean {
  if(!entry.closedShell || !entry.box.containsPoint(p)) return false;
  // Containment is affine-invariant; ray parity can use the shared local BVH.
  const local=p.clone().applyMatrix4(entry.inverse);
  // A finish batch can contain overlapping closed stair/rail volumes. Deduplicated
  // unoriented parity loses coincident entry/exit faces and invents an interior in
  // the open portal. Oriented crossings retain cancellation between those shells.
  // Require agreement from a second direction before applying an interior push.
  const normal=new THREE.Vector3(),hit=new THREE.Vector3();
  for(const direction of [new THREE.Vector3(1,.173,.319),new THREE.Vector3(.137,1,.271)]) {
    direction.normalize();const ray=new THREE.Ray(local,direction),triangles:THREE.Triangle[]=[];
    rayTriangles(entry.node,ray,triangles);let winding=0;
    for(const t of triangles) {
      if(ray.intersectTriangle(t.a,t.b,t.c,false,hit) && hit.distanceToSquared(local)>1e-14)
        winding+=Math.sign(t.getNormal(normal).dot(direction));
    }
    if(winding===0) return false;
  }
  return true;
}
/** Closest points of two finite line segments, including degenerate segments. */
function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  let s = 0, t = 0;
  if (aa < 1e-12) t = cc > 1e-12 ? THREE.MathUtils.clamp(ee / cc, 0, 1) : 0;
  else {
    if (cc < 1e-12) s = THREE.MathUtils.clamp(-dd / aa, 0, 1);
    else {
      const denominator = aa * cc - bb * bb;
      s = denominator > 1e-12 ? THREE.MathUtils.clamp((bb * ee - cc * dd) / denominator, 0, 1) : 0;
      t = (bb * s + ee) / cc;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-dd / aa, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((bb - dd) / aa, 0, 1); }
    }
  }
  return [a.clone().addScaledVector(u, s), c.clone().addScaledVector(v, t)];
}
function triangleDistance(body: Capsule, triangle: THREE.Triangle): Distance {
  const axis = body.end.clone().sub(body.start), length = axis.length();
  const hit = length > 1e-10 ? new THREE.Ray(body.start, axis.clone().divideScalar(length)).intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3()) : null;
  const planeNormal = triangle.getNormal(new THREE.Vector3());
  if (hit && hit.distanceTo(body.start) <= length + 1e-8) {
    const middle = body.start.clone().add(body.end).multiplyScalar(.5);
    if (planeNormal.dot(middle.sub(hit)) < 0) planeNormal.negate();
    return { distance: 0, normal: planeNormal, point: hit };
  }
  let a = body.start, b = triangle.closestPointToPoint(a, new THREE.Vector3());
  let best = a.distanceToSquared(b);
  const endPoint = triangle.closestPointToPoint(body.end, new THREE.Vector3()), endDistance = body.end.distanceToSquared(endPoint);
  if (endDistance < best) { a = body.end; b = endPoint; best = endDistance; }
  for (const [c, d] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
    const [onBody, onEdge] = segmentDistance(body.start, body.end, c, d), distance = onBody.distanceToSquared(onEdge);
    if (distance < best) { a = onBody; b = onEdge; best = distance; }
  }
  const normal = a.clone().sub(b);
  if (best > 1e-14) normal.divideScalar(Math.sqrt(best)); else normal.copy(planeNormal);
  return { distance: Math.sqrt(best), normal, point: b.clone() };
}

/**
 * Static solid registry. One local-space BVH is shared per geometry revision;
 * entries retain transforms and a world broadphase. Only nearby triangles are
 * transformed for exact world-space body distances (including nonuniform scale).
 * Source geometry/material are borrowed and never mutated/disposed. Register rocks,
 * trunks and furniture explicitly; leaves, grass, water and the boat stay out.
 */
export class WorldCollision {
  private readonly entries = new Map<number, Entry>();
  private readonly cells = new Map<string, Set<number>>();
  private readonly large = new Set<number>();
  private readonly bvhs = new Map<string,SharedBVH>();
  private nextId = 1;
  private triangleCount = 0;
  private lastCandidates = 0;
  private lastTriangleTests = 0;
  private lastIterations = 0;
  private storedTriangleCount = 0;
  private lastTransformedTriangles = 0;

  get stats(): CollisionStats {
    return { colliders: this.entries.size, triangles: this.triangleCount, hashCells: this.cells.size,
      largeColliders: this.large.size, lastCandidates: this.lastCandidates,
      lastTriangleTests: this.lastTriangleTests, lastIterations: this.lastIterations,
      uniqueBVHs:this.bvhs.size,storedTriangles:this.storedTriangleCount,lastTransformedTriangles:this.lastTransformedTriangles };
  }
  addMesh(mesh: THREE.Mesh, transform?: THREE.Matrix4): number {
    if (!transform) mesh.updateWorldMatrix(true, false);
    const matrix = transform ?? mesh.matrixWorld, geometry = mesh.geometry, position = geometry.getAttribute('position');
    if (!position) throw new Error('Collision mesh has no positions');
    const key=geometryKey(geometry);
    return this.addShared(key,matrix,()=> {
    const index = geometry.index, count = index?.count ?? position.count;
    const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
    const triangles: THREE.Triangle[] = [];
    for (let i = start; i + 2 < end; i += 3) {
      const vertex = (j: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(j) : j);
      const triangle = new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2));
      if (triangle.getArea() > 1e-10) triangles.push(triangle);
    }
    return triangles;
    });
  }
  /** Bounds may be local with a matrix, or world-axis aligned without one. */
  addBox(bounds: THREE.Box3, transform?: THREE.Matrix4): number {
    const size=bounds.getSize(new THREE.Vector3());
    if(bounds.isEmpty() || Math.min(size.x,size.y,size.z)<=0) throw new Error('Invalid collision box');
    const matrix=new THREE.Matrix4().makeTranslation(bounds.min.x,bounds.min.y,bounds.min.z).scale(size);
    if(transform) matrix.premultiply(transform);
    return this.addShared('primitive:box',matrix,()=> {
      const vertices = [new THREE.Vector3(0,0,0),new THREE.Vector3(1,0,0),new THREE.Vector3(1,1,0),new THREE.Vector3(0,1,0),
        new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,1),new THREE.Vector3(1,1,1),new THREE.Vector3(0,1,1)];
      const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
      return faces.map(([i,j,k]) => new THREE.Triangle(vertices[i].clone(),vertices[j].clone(),vertices[k].clone()));
    });
  }
  /** Centre is the cylinder's bottom centre, for trunk and pole proxies. */
  addCylinder(centre: BodyPoint, radius: number, height: number): number {
    if (!valid(centre) || !(radius > 0 && height > 0)) throw new Error('Invalid collision cylinder');
    const matrix=new THREE.Matrix4().makeTranslation(centre.x,centre.y,centre.z).scale(new THREE.Vector3(radius,height,radius));
    return this.addShared('primitive:cylinder20',matrix,()=> {
    const triangles: THREE.Triangle[] = [], bottom = new THREE.Vector3(), top = new THREE.Vector3(0,1,0);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2, b = (i + 1) / 20 * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const q = new THREE.Vector3(Math.cos(b), 0, Math.sin(b));
      const pt = p.clone().add(new THREE.Vector3(0,1,0)), qt = q.clone().add(new THREE.Vector3(0,1,0));
      triangles.push(new THREE.Triangle(p,pt,q), new THREE.Triangle(q,pt,qt), new THREE.Triangle(bottom.clone(),p.clone(),q.clone()), new THREE.Triangle(top.clone(),qt.clone(),pt.clone()));
    }
    return triangles;
    });
  }
  updateMesh(id: number, mesh: THREE.Mesh, transform?: THREE.Matrix4): number {
    const replacement=this.addMesh(mesh,transform);
    this.remove(id);return replacement;
  }
  private addShared(key:string,sourceMatrix:THREE.Matrix4,create:()=>THREE.Triangle[]):number {
    const matrix=sourceMatrix.clone(),determinant=matrix.determinant();
    if(!matrix.elements.every(Number.isFinite) || !Number.isFinite(determinant) || Math.abs(determinant)<1e-15) throw new Error('Invalid collision transform');
    let shared=this.bvhs.get(key);
    if(!shared) {
      const triangles=create();
      if(!triangles.length) throw new Error('Collision mesh has no nondegenerate triangles');
      const node=build(triangles);
      if(![...node.box.min.toArray(),...node.box.max.toArray()].every(Number.isFinite)) throw new Error('Invalid collision bounds');
      shared={node,triangles:triangles.length,references:0,closedShell:closedShell(triangles)};this.bvhs.set(key,shared);this.storedTriangleCount+=triangles.length;
    }
    const id=this.nextId++,box=shared.node.box.clone().applyMatrix4(matrix);
    if(![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)) {
      if(!shared.references) {this.bvhs.delete(key);this.storedTriangleCount-=shared.triangles;}
      throw new Error('Invalid collision world bounds');
    }
    const entry:Entry={id,box,node:shared.node,cells:[],matrix,inverse:matrix.clone().invert(),reflected:determinant<0,cacheKey:key,triangles:shared.triangles,closedShell:shared.closedShell};
    shared.references++;this.entries.set(id, entry);this.triangleCount+=shared.triangles;
    const { min, max } = box, x0 = Math.floor(min.x / CELL_SIZE), x1 = Math.floor(max.x / CELL_SIZE), z0 = Math.floor(min.z / CELL_SIZE), z1 = Math.floor(max.z / CELL_SIZE);
    if ((x1-x0+1)*(z1-z0+1) > MAX_HASH_CELLS) this.large.add(id);
    else for (let x=x0;x<=x1;x++) for(let z=z0;z<=z1;z++) {
      const key = `${x},${z}`; entry.cells.push(key);
      if (!this.cells.has(key)) this.cells.set(key, new Set());
      this.cells.get(key)!.add(id);
    }
    return id;
  }
  remove(id: number): boolean {
    const entry = this.entries.get(id); if (!entry) return false;
    this.triangleCount -= entry.triangles;
    const shared=this.bvhs.get(entry.cacheKey)!;
    if(--shared.references===0) {this.bvhs.delete(entry.cacheKey);this.storedTriangleCount-=shared.triangles;}
    for (const key of entry.cells) { const ids = this.cells.get(key)!; ids.delete(id); if (!ids.size) this.cells.delete(key); }
    this.large.delete(id); this.entries.delete(id); return true;
  }
  clear(): void {
    this.entries.clear(); this.cells.clear(); this.large.clear(); this.bvhs.clear();this.triangleCount = 0;this.storedTriangleCount=0;
    this.lastCandidates=0;this.lastTriangleTests=0;this.lastIterations=0;this.lastTransformedTriangles=0;
  }
  dispose(): void { this.clear(); }
  private worldTriangles(entry:Entry,bounds?:THREE.Box3):THREE.Triangle[] {
    const local:THREE.Triangle[]=[];
    // Box3.applyMatrix4 transforms all 8 corners, so this is conservative even
    // for nonuniform scale, rotated instances and reflected coordinate frames.
    query(entry.node,bounds ? bounds.clone().applyMatrix4(entry.inverse) : entry.node.box,local);
    this.lastTransformedTriangles+=local.length;
    return local.map(t=> {
      const a=t.a.clone().applyMatrix4(entry.matrix),b=t.b.clone().applyMatrix4(entry.matrix),c=t.c.clone().applyMatrix4(entry.matrix);
      return entry.reflected ? new THREE.Triangle(a,c,b) : new THREE.Triangle(a,b,c);
    });
  }
  private candidates(bounds: THREE.Box3): Entry[] {
    const ids = new Set(this.large), x0 = Math.floor(bounds.min.x/CELL_SIZE), x1 = Math.floor(bounds.max.x/CELL_SIZE), z0 = Math.floor(bounds.min.z/CELL_SIZE), z1 = Math.floor(bounds.max.z/CELL_SIZE);
    // Huge diagnostic sweeps use the bounded collider list rather than millions of cells.
    if ((x1-x0+1)*(z1-z0+1)>MAX_HASH_CELLS) for(const id of this.entries.keys()) ids.add(id);
    else for(let x=x0;x<=x1;x++) for(let z=z0;z<=z1;z++) for(const id of this.cells.get(`${x},${z}`) ?? []) ids.add(id);
    const result = [...ids].map(id => this.entries.get(id)!).filter(e => e.box.intersectsBox(bounds));
    this.lastCandidates = result.length; return result;
  }
  sweepBody(from: BodyPoint, to: BodyPoint, radius: number = PLAYER_DIMENSIONS.radius, height: number = PLAYER_DIMENSIONS.height, pose?: BodyPose): BodySweep {
    if (!valid(from) || !valid(to) || !(radius > 0 && height >= radius * 2)) return { position: { ...from }, fraction: 0, blocked: true, normal: { x:0,y:0,z:0 } };
    this.lastTriangleTests = 0; this.lastIterations = 0;this.lastTransformedTriangles=0;
    const body = capsule(from,radius,height,pose), end = capsule(to,radius,height,pose), delta = point(to).sub(point(from)), length = delta.length();
    const bounds = capsuleBounds(body).union(capsuleBounds(end));
    let fraction = 1, normal = new THREE.Vector3(), colliderId: number | undefined;
    for(const entry of this.candidates(bounds)) {
      const triangles=this.worldTriangles(entry,bounds);
      for(const triangle of triangles) {
        let t = 0,lastVerifiedT=0,settled=false;
        const verifiedNormal=new THREE.Vector3();
        for(let iteration=0;iteration<32 && t<=fraction;iteration++) {
          this.lastIterations++; this.lastTriangleTests++;
          const moved: Capsule = {start:body.start.clone().addScaledVector(delta,t),end:body.end.clone().addScaledVector(delta,t),radius};
          const contact = triangleDistance(moved,triangle), gap = contact.distance-radius;
          if(gap<=SKIN+1e-7) {
            settled=true;
            // Supporting/tangent contacts allow motion away or along the face.
            if(delta.dot(contact.normal)>=-1e-9) break;
            if(gap>=-1e-7 && Math.abs(delta.dot(contact.normal))<length*.15) {
              // At a stair's upper edge the capsule merely grazes a side triangle.
              // Convex segment/triangle distance distinguishes that from entering
              // the solid; the skin margin must not turn a tangent into a wall.
              const distanceAt=(time:number):number=> {
                this.lastTriangleTests++;
                return triangleDistance({start:body.start.clone().addScaledVector(delta,time),end:body.end.clone().addScaledVector(delta,time),radius},triangle).distance;
              };
              let lo=t,hi=fraction;
              for(let j=0;j<14;j++) {
                const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;
                if(distanceAt(a)<distanceAt(b)) hi=b;else lo=a;
              }
              if(distanceAt((lo+hi)*.5)>=radius-1e-7) break;
            }
            fraction = Math.max(0,t-SKIN/Math.max(length,SKIN)); normal=contact.normal; colliderId=entry.id; break;
          }
          if(length<1e-10) {settled=true;break;}
          lastVerifiedT=t;verifiedNormal.copy(contact.normal);
          const closingSpeed=-delta.dot(contact.normal);
          // Distance between a translated capsule axis and a triangle is convex.
          // Its current closest-point normal gives a supporting lower bound:
          // d(t+s) >= d(t) - closingSpeed*s. Tangential speed must not dilute
          // progress toward a wall, and a non-closing bound proves the rest clear.
          if(closingSpeed<=1e-10) {settled=true;break;}
          t += (gap-SKIN)*.95/closingSpeed;
        }
        if(!settled && t<=fraction) {
          // Iteration exhaustion is not evidence that the endpoint is clear.
          // Preserve the last checked safe point even for degenerate slow contact.
          fraction=lastVerifiedT;normal.copy(verifiedNormal);colliderId=entry.id;
        }
      }
    }
    return {position:plain(point(from).addScaledVector(delta,fraction)),fraction,blocked:fraction<1,normal:plain(normal),colliderId};
  }
  bodySegmentBlocked(from: BodyPoint,to: BodyPoint,radius: number = PLAYER_DIMENSIONS.radius,height: number = PLAYER_DIMENSIONS.height): boolean {
    return this.sweepBody(from,to,radius,height).blocked;
  }
  supportHeightAt(x:number,z:number,feetY:number,maxRise=.32,radius: number = PLAYER_DIMENSIONS.radius): number | null {
    if(![x,z,feetY,maxRise,radius].every(Number.isFinite)) return null;
    this.lastTransformedTriangles=0;
    const top=feetY+maxRise+SKIN, bottom=feetY-2.5;
    const bounds=new THREE.Box3(new THREE.Vector3(x-radius,bottom,z-radius),new THREE.Vector3(x+radius,top,z+radius));
    let support:number|null=null;
    const projected=new THREE.Triangle(),centre=new THREE.Vector3(x,0,z),nearest=new THREE.Vector3(),barycentric=new THREE.Vector3();
    // Centre plus a small foot disk gives contact on a rock edge without its inflated AABB.
    const offsets=[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]];
    for(const entry of this.candidates(bounds)) {
      const triangles=this.worldTriangles(entry,bounds);
      for(const triangle of triangles) {
        if(triangle.getNormal(new THREE.Vector3()).y<.64) continue;
        // Cardinal samples miss a narrow diagonal curb even while the capsule
        // touches it. Include the closest point of the actual projected triangle
        // inside the foot disk; this adds no inflated AABB or fabricated surface.
        projected.a.set(triangle.a.x,0,triangle.a.z);projected.b.set(triangle.b.x,0,triangle.b.z);projected.c.set(triangle.c.x,0,triangle.c.z);
        projected.closestPointToPoint(centre,nearest);
        if(nearest.distanceToSquared(centre)<=radius*radius+1e-10 && projected.getBarycoord(nearest,barycentric)) {
          const y=triangle.a.y*barycentric.x+triangle.b.y*barycentric.y+triangle.c.y*barycentric.z;
          if(y<=top && y>=bottom && (support===null || y>support)) support=y;
        }
        for(const [dx,dz] of offsets) {
          const hit=new THREE.Ray(new THREE.Vector3(x+dx,top,z+dz),new THREE.Vector3(0,-1,0)).intersectTriangle(triangle.a,triangle.b,triangle.c,false,new THREE.Vector3());
          if(hit && hit.y>=bottom && (support===null || hit.y>support)) support=hit.y;
        }
      }
    }
    return support;
  }
  resolveBody(feet:BodyPoint,radius: number = PLAYER_DIMENSIONS.radius,height: number = PLAYER_DIMENSIONS.height,maxPush=.32,pose?:BodyPose): BodyPoint {
    if(!valid(feet)) return {...feet};
    this.lastTransformedTriangles=0;
    const result=point(feet), origin=result.clone();
    for(let pass=0;pass<4;pass++) {
      const body=capsule(plain(result),radius,height,pose), bounds=capsuleBounds(body);
      let push=new THREE.Vector3(), depth=0;
      for(const entry of this.candidates(bounds)) {
        const inside=[body.start,body.start.clone().add(body.end).multiplyScalar(.5),body.end].find(p=>enclosed(entry,p));
        if(inside) {
          const all=this.worldTriangles(entry);
          let closest=Infinity,direction=new THREE.Vector3();
          for(const triangle of all) {
            const surface=triangle.closestPointToPoint(inside,new THREE.Vector3()),out=surface.sub(inside),distance=out.length();
            if(distance<1e-8 || (!pose && out.y < -distance*.5)) continue;
            if(distance<closest) {closest=distance;direction.copy(out).divideScalar(distance);}
          }
          if(closest<Infinity && closest+radius>depth) {depth=closest+radius;push=direction;}
          continue;
        }
        const triangles=this.worldTriangles(entry,bounds);
        for(const triangle of triangles) {
          const contact=triangleDistance(body,triangle), overlap=radius-contact.distance;
          if(overlap>depth+SKIN) {depth=overlap;push=contact.normal;}
        }
      }
      if(depth<=SKIN) break;
      const remaining=Math.max(0,maxPush-result.distanceTo(origin)); if(remaining<SKIN) break;
      result.addScaledVector(push,Math.min(depth+SKIN,remaining));
    }
    return plain(result);
  }
}

/** Keep terrain/boat navigation on the same sampler, adding solid-world queries. */
export function withWorldCollision(ground: GroundSampler, solids: WorldCollision): GroundSampler {
  return {
    heightAt: (x,z) => ground.heightAt(x,z),
    bodySegmentBlocked: (from,to,radius,height) => Boolean(ground.bodySegmentBlocked?.(from,to,radius,height)) || solids.bodySegmentBlocked(from,to,radius,height),
    sweepBody: (from,to,radius,height,pose) => {
      const solid=solids.sweepBody(from,to,radius,height,pose),terrain=ground.sweepBody?.(from,to,radius,height,pose);
      return terrain && terrain.fraction<solid.fraction ? terrain : solid;
    },
    supportHeightAt: (x,z,y,rise,radius) => {
      const solid=solids.supportHeightAt(x,z,y,rise,radius),terrain=ground.supportHeightAt?.(x,z,y,rise,radius);
      return terrain===null || terrain===undefined ? solid : solid===null ? terrain : Math.max(terrain,solid);
    },
    resolveBody: (feet,radius,height,maxPush,pose) => solids.resolveBody(feet,radius,height,maxPush,pose),
  };
}
