import * as THREE from 'three';
export interface NativeSurfaceStitchOptions {
  subdivisionM?: number;
  maxBoundaryEdges?: number;
  maxOutputTriangles?: number;
  maxInputTriangles?: number;
}
export interface NativeSurfaceStitchDiagnostics {
  inputTriangles: number; boundaryEdges: number; subdivisions: number;
  outputTriangles: number; zeroAreaTriangles: number; queries: number;
  missingQueries: number; maximumHeightDeltaM: number; signCrossings: number;
}
/** Inferred vertical contact curtains between native footprint boundary and a
 * queried surface. Not a surveyed closed solid. All returned positions are
 * footprint-local; inputs are borrowed. Any missing query fails atomically. */
export function stitchNativeSurfaceBoundary(
  footprint: THREE.BufferGeometry, origin: Readonly<{x:number;y:number;z:number}>,
  surfaceHeightAt: (worldX: number, worldZ: number) => number | null,
  options: NativeSurfaceStitchOptions = {},
): { geometry: THREE.BufferGeometry; diagnostics: NativeSurfaceStitchDiagnostics } {
  const limits = { subdivisionM: .2, maxBoundaryEdges: 100_000,
    maxOutputTriangles: 2_000_000, maxInputTriangles: 500_000, ...options };
  for (const [key,value] of Object.entries(limits))
    if (!Number.isFinite(value) || value <= 0 || (key !== 'subdivisionM' && !Number.isInteger(value))) throw new Error(`Invalid stitch limit ${key}`);
  if (![origin.x,origin.y,origin.z].every(Number.isFinite)) throw new Error('Invalid stitch origin');
  const p = footprint.getAttribute('position'), index = footprint.getIndex();
  if (!(p instanceof THREE.BufferAttribute) || !(p.array instanceof Float32Array) || p.itemSize !== 3 || !index || index.count % 3)
    throw new Error('Stitch requires indexed Float32 triangles');
  if (index.count / 3 > limits.maxInputTriangles || p.count > limits.maxInputTriangles * 3) throw new Error('Stitch input budget exhausted');
  for (const n of p.array) if (!Number.isFinite(n)) throw new Error('Nonfinite stitch position');
  const diagnostics: NativeSurfaceStitchDiagnostics = { inputTriangles: index.count/3,
    boundaryEdges:0, subdivisions:0, outputTriangles:0, zeroAreaTriangles:0,
    queries:0, missingQueries:0, maximumHeightDeltaM:0, signCrossings:0 };
  type Point = {x:number;y:number;z:number};
  type Edge = { a:Point; b:Point; count:number };
  const vertex = (id:number):Point => {
    if (!Number.isInteger(id) || id < 0 || id >= p.count) throw new Error('Invalid stitch index');
    return {x:p.getX(id),y:p.getY(id),z:p.getZ(id)};
  };
  const key = (v:Point) => `${v.x},${v.y},${v.z}`;
  const edges = new Map<string,Edge>();
  for (let i=0;i<index.count;i+=3) {
    const points=[vertex(index.getX(i)),vertex(index.getX(i+1)),vertex(index.getX(i+2))];
    for (let e=0;e<3;e++) {
      const a=points[e]!,b=points[(e+1)%3]!,ka=key(a),kb=key(b);
      if (ka===kb) throw new Error('Degenerate stitch source edge');
      const edgeKey=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`,previous=edges.get(edgeKey);
      if (previous) { if (++previous.count>2) throw new Error('Nonmanifold stitch footprint'); }
      else edges.set(edgeKey,{a,b,count:1});
    }
  }
  const boundary=[...edges.values()].filter(e=>e.count===1);
  diagnostics.boundaryEdges=boundary.length;
  if(boundary.length>limits.maxBoundaryEdges) throw new Error('Stitch boundary budget exhausted');
  // 64KiB typed chunks bound output overhead independently of triangle count.
  const chunks:Float32Array[]=[];let count=0;
  const push=(value:number)=>{
    if(count%16384===0) chunks.push(new Float32Array(16384));
    chunks[chunks.length-1]![count%16384]=value;count++;
  };
  const emit=(a:Point,b:Point,c:Point)=>{
    // Test the actual stored Float32 geometry, avoiding rounded degenerate faces.
    const q=[a,b,c].map(v=>({x:Math.fround(v.x),y:Math.fround(v.y),z:Math.fround(v.z)}));
    if(q.some(v=>![v.x,v.y,v.z].every(Number.isFinite)))throw new Error('Stitch Float32 output overflow');
    const u=new THREE.Vector3(q[1]!.x-q[0]!.x,q[1]!.y-q[0]!.y,q[1]!.z-q[0]!.z);
    const v=new THREE.Vector3(q[2]!.x-q[0]!.x,q[2]!.y-q[0]!.y,q[2]!.z-q[0]!.z);
    if(u.cross(v).lengthSq()===0){diagnostics.zeroAreaTriangles++;return;}
    if(++diagnostics.outputTriangles>limits.maxOutputTriangles) throw new Error('Stitch output budget exhausted');
    for(const point of q){push(point.x);push(point.y);push(point.z);}
  };
  const replacement=(v:Point):Point=>{
    diagnostics.queries++;
    const height=surfaceHeightAt(v.x+origin.x,v.z+origin.z);
    if(height===null || !Number.isFinite(height)){diagnostics.missingQueries++;throw new Error(`Missing/nonfinite stitch surface query at ${v.x+origin.x},${v.z+origin.z}`);}
    const result={x:v.x,y:height-origin.y,z:v.z};
    if(!Number.isFinite(result.y))throw new Error('Stitch replacement height overflow');
    diagnostics.maximumHeightDeltaM=Math.max(diagnostics.maximumHeightDeltaM,Math.abs(result.y-v.y));
    return result;
  };
  const lerp=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
  const quad=(a:Point,b:Point,ra:Point,rb:Point)=>{
    const da=ra.y-a.y,db=rb.y-b.y;
    if(da*db<0){
      diagnostics.signCrossings++;
      const t=da/(da-db),contact=lerp(a,b,t);
      // Split where linear native and replacement edges coincide. Two triangles
      // avoid the self-intersecting signed-height quad.
      emit(a,contact,ra);emit(contact,b,rb);
    }else{emit(a,b,rb);emit(a,rb,ra);}
  };
  for(const {a,b} of boundary){
    const length=Math.hypot(b.x-a.x,b.z-a.z);
    const steps=Math.max(1,Math.ceil(length/limits.subdivisionM));
    // Bound queries too, including zero-height segments producing no triangles.
    if(!Number.isSafeInteger(steps)||diagnostics.subdivisions+steps>limits.maxOutputTriangles)
      throw new Error('Stitch subdivision budget exhausted');
    diagnostics.subdivisions+=steps;
    let previous=a,previousReplacement=replacement(a);
    for(let j=1;j<=steps;j++){
      const next=j===steps?b:lerp(a,b,j/steps),nextReplacement=replacement(next);
      quad(previous,next,previousReplacement,nextReplacement);
      previous=next;previousReplacement=nextReplacement;
    }
  }
  const positions=new Float32Array(count);
  for(let i=0;i<chunks.length;i++)positions.set(chunks[i]!.subarray(0,Math.min(16384,count-i*16384)),i*16384);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return {geometry,diagnostics};
}
