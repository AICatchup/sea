import * as THREE from 'three';
import { PLAYER_DIMENSIONS, type BodyPoint, type BodyPose, type BodySweep, type GroundSampler } from './contracts.ts';

const SKIN = .001;
const CELL_SIZE = 12;
const MAX_HASH_CELLS = 256;
interface Node { box: THREE.Box3; triangles?: THREE.Triangle[]; left?: Node; right?: Node; }
interface Entry { id: number; box: THREE.Box3; node: Node; cells: string[]; }
interface Distance { distance: number; normal: THREE.Vector3; point: THREE.Vector3; }
interface Capsule { start: THREE.Vector3; end: THREE.Vector3; radius: number; }
export interface CollisionStats {
  colliders: number; triangles: number; hashCells: number; largeColliders: number;
  lastCandidates: number; lastTriangleTests: number; lastIterations: number;
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
function enclosed(entry:Entry,p:THREE.Vector3):boolean {
  if(!entry.box.containsPoint(p)) return false;
  const ray=new THREE.Ray(p,new THREE.Vector3(1,.173,.319).normalize()),triangles:THREE.Triangle[]=[],distances:number[]=[];
  rayTriangles(entry.node,ray,triangles);
  for(const t of triangles) {
    const hit=ray.intersectTriangle(t.a,t.b,t.c,false,new THREE.Vector3());
    if(hit) {const d=hit.distanceTo(p);if(d>1e-7 && !distances.some(other=>Math.abs(other-d)<1e-6)) distances.push(d);}
  }
  return distances.length%2===1;
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
 * Static solid registry. Mesh vertices are copied in world space into a BVH; source
 * geometry/material are borrowed and never mutated/disposed. Register solid rocks,
 * trunks and furniture explicitly; leaves, grass, water and the boat stay out.
 */
export class WorldCollision {
  private readonly entries = new Map<number, Entry>();
  private readonly cells = new Map<string, Set<number>>();
  private readonly large = new Set<number>();
  private nextId = 1;
  private triangleCount = 0;
  private lastCandidates = 0;
  private lastTriangleTests = 0;
  private lastIterations = 0;

  get stats(): CollisionStats {
    return { colliders: this.entries.size, triangles: this.triangleCount, hashCells: this.cells.size,
      largeColliders: this.large.size, lastCandidates: this.lastCandidates,
      lastTriangleTests: this.lastTriangleTests, lastIterations: this.lastIterations };
  }
  addMesh(mesh: THREE.Mesh, transform?: THREE.Matrix4): number {
    if (!transform) mesh.updateWorldMatrix(true, false);
    const matrix = transform ?? mesh.matrixWorld, geometry = mesh.geometry, position = geometry.getAttribute('position');
    if (!position) throw new Error('Collision mesh has no positions');
    const index = geometry.index, count = index?.count ?? position.count;
    const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
    const triangles: THREE.Triangle[] = [];
    for (let i = start; i + 2 < end; i += 3) {
      const vertex = (j: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(j) : j).applyMatrix4(matrix);
      const triangle = new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2));
      if (triangle.getArea() > 1e-10) triangles.push(triangle);
    }
    return this.addTriangles(triangles);
  }
  /** Bounds may be local with a matrix, or world-axis aligned without one. */
  addBox(bounds: THREE.Box3, transform?: THREE.Matrix4): number {
    const { min: a, max: b } = bounds;
    const vertices = [new THREE.Vector3(a.x,a.y,a.z),new THREE.Vector3(b.x,a.y,a.z),new THREE.Vector3(b.x,b.y,a.z),new THREE.Vector3(a.x,b.y,a.z),
      new THREE.Vector3(a.x,a.y,b.z),new THREE.Vector3(b.x,a.y,b.z),new THREE.Vector3(b.x,b.y,b.z),new THREE.Vector3(a.x,b.y,b.z)];
    if (transform) vertices.forEach(v => v.applyMatrix4(transform));
    const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
    return this.addTriangles(faces.map(([i,j,k]) => new THREE.Triangle(vertices[i].clone(),vertices[j].clone(),vertices[k].clone())));
  }
  /** Centre is the cylinder's bottom centre, for trunk and pole proxies. */
  addCylinder(centre: BodyPoint, radius: number, height: number): number {
    if (!valid(centre) || !(radius > 0 && height > 0)) throw new Error('Invalid collision cylinder');
    const triangles: THREE.Triangle[] = [], bottom = point(centre), top = bottom.clone().add(new THREE.Vector3(0, height, 0));
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2, b = (i + 1) / 20 * Math.PI * 2;
      const p = bottom.clone().add(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      const q = bottom.clone().add(new THREE.Vector3(Math.cos(b) * radius, 0, Math.sin(b) * radius));
      const pt = p.clone().add(new THREE.Vector3(0,height,0)), qt = q.clone().add(new THREE.Vector3(0,height,0));
      triangles.push(new THREE.Triangle(p,pt,q), new THREE.Triangle(q,pt,qt), new THREE.Triangle(bottom.clone(),p.clone(),q.clone()), new THREE.Triangle(top.clone(),qt.clone(),pt.clone()));
    }
    return this.addTriangles(triangles);
  }
  updateMesh(id: number, mesh: THREE.Mesh, transform?: THREE.Matrix4): number {
    this.remove(id);
    return this.addMesh(mesh, transform);
  }
  private addTriangles(triangles: THREE.Triangle[]): number {
    if (!triangles.length) throw new Error('Collision mesh has no nondegenerate triangles');
    const node = build(triangles), id = this.nextId++, entry: Entry = { id, box: node.box, node, cells: [] };
    if (![...node.box.min.toArray(), ...node.box.max.toArray()].every(Number.isFinite)) throw new Error('Invalid collision bounds');
    this.entries.set(id, entry); this.triangleCount += triangles.length;
    const { min, max } = node.box, x0 = Math.floor(min.x / CELL_SIZE), x1 = Math.floor(max.x / CELL_SIZE), z0 = Math.floor(min.z / CELL_SIZE), z1 = Math.floor(max.z / CELL_SIZE);
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
    const count = (node: Node): number => node.triangles?.length ?? count(node.left!) + count(node.right!);
    this.triangleCount -= count(entry.node);
    for (const key of entry.cells) { const ids = this.cells.get(key)!; ids.delete(id); if (!ids.size) this.cells.delete(key); }
    this.large.delete(id); this.entries.delete(id); return true;
  }
  clear(): void {
    this.entries.clear(); this.cells.clear(); this.large.clear(); this.triangleCount = 0;
    this.lastCandidates=0;this.lastTriangleTests=0;this.lastIterations=0;
  }
  dispose(): void { this.clear(); }
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
    this.lastTriangleTests = 0; this.lastIterations = 0;
    const body = capsule(from,radius,height,pose), end = capsule(to,radius,height,pose), delta = point(to).sub(point(from)), length = delta.length();
    const bounds = capsuleBounds(body).union(capsuleBounds(end));
    let fraction = 1, normal = new THREE.Vector3(), colliderId: number | undefined;
    for(const entry of this.candidates(bounds)) {
      const triangles: THREE.Triangle[] = []; query(entry.node,bounds,triangles);
      for(const triangle of triangles) {
        let t = 0;
        for(let iteration=0;iteration<32 && t<=fraction;iteration++) {
          this.lastIterations++; this.lastTriangleTests++;
          const moved: Capsule = {start:body.start.clone().addScaledVector(delta,t),end:body.end.clone().addScaledVector(delta,t),radius};
          const contact = triangleDistance(moved,triangle), gap = contact.distance-radius;
          if(gap<=SKIN) {
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
          if(length<1e-10) break;
          // Distance is 1-Lipschitz under translation: this cannot skip thin solids.
          t += Math.max(1e-6,(gap-SKIN)*.95/length);
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
    const top=feetY+maxRise+SKIN, bottom=feetY-2.5;
    const bounds=new THREE.Box3(new THREE.Vector3(x-radius,bottom,z-radius),new THREE.Vector3(x+radius,top,z+radius));
    let support:number|null=null;
    // Centre plus a small foot disk gives contact on a rock edge without its inflated AABB.
    const offsets=[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]];
    for(const entry of this.candidates(bounds)) {
      const triangles:THREE.Triangle[]=[]; query(entry.node,bounds,triangles);
      for(const triangle of triangles) {
        if(triangle.getNormal(new THREE.Vector3()).y<.64) continue;
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
    const result=point(feet), origin=result.clone();
    for(let pass=0;pass<4;pass++) {
      const body=capsule(plain(result),radius,height,pose), bounds=capsuleBounds(body);
      let push=new THREE.Vector3(), depth=0;
      for(const entry of this.candidates(bounds)) {
        const inside=[body.start,body.start.clone().add(body.end).multiplyScalar(.5),body.end].find(p=>enclosed(entry,p));
        if(inside) {
          const all:THREE.Triangle[]=[];query(entry.node,entry.box,all);
          let closest=Infinity,direction=new THREE.Vector3();
          for(const triangle of all) {
            const surface=triangle.closestPointToPoint(inside,new THREE.Vector3()),out=surface.sub(inside),distance=out.length();
            if(distance<1e-8 || (!pose && out.y < -distance*.5)) continue;
            if(distance<closest) {closest=distance;direction.copy(out).divideScalar(distance);}
          }
          if(closest<Infinity && closest+radius>depth) {depth=closest+radius;push=direction;}
          continue;
        }
        const triangles:THREE.Triangle[]=[]; query(entry.node,bounds,triangles);
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
