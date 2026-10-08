import * as THREE from 'three';
import { createProjectedMeshSurface } from './projected-mesh-surface.ts';

export interface SurfaceClipOrigin { x: number; y: number; z: number }
export interface SurfaceClipOptions {
  cellSize?: number;
  maxInputTriangles?: number;
  maxFootprintTriangles?: number;
  maxGridReferences?: number;
  maxCellsPerTriangle?: number;
  maxCandidateTests?: number;
  maxQueryOperations?: number;
  maxOutputTriangles?: number;
  /** Explicit geometric approximation in 3D square metres; default 0. */
  minimumTriangleAreaM2?: number;
  /** Optional whole-union proof. Undefined disables; positive tolerance permits
   * at most this uncovered projected area per passthrough triangle. */
  unionCoverageAreaToleranceM2?: number;
}
export interface SurfaceClipDiagnostics {
  inputTriangles: number; footprintTriangles: number; outputTriangles: number;
  unionPassthroughTriangles: number;
  unionAcceptedResidualAreaM2: number;
  unionMaximumAcceptedResidualAreaM2: number;
  unionCoverageDiagnostics?: ReturnType<typeof createProjectedMeshSurface>['diagnostics'];
  rejectedTinyTriangles: number; rejectedTinyAreaM2: number;
  /** Emitted 3D area bins <=1e-16, <=1e-12, <=1e-8, <=1e-4, larger. */
  outputAreaHistogram: number[];
  outputAreaHistogramM2: number[];
  candidateTests: number; queryOperations: number; gridReferences: number; passthroughTriangles: number;
}
// Chunked typed storage avoids boxed-number output at million-triangle scale.
class FloatOutput {
  private chunks: Float32Array[] = [];
  length = 0;
  push(value: number) {
    const offset = this.length % 16384;
    if (offset === 0) this.chunks.push(new Float32Array(16384));
    this.chunks[this.chunks.length - 1]![offset] = value;
    this.length++;
  }
  finish() {
    const result = new Float32Array(this.length);
    for (let i = 0; i < this.chunks.length; i++) {
      const offset = i * 16384;
      result.set(this.chunks[i]!.subarray(0, Math.min(16384, this.length - offset)), offset);
    }
    this.chunks = [];
    return result;
  }
}
type Vertex = number[];
type Triangle = { p: number[][]; sign: number };

/** Clip in world XZ, interpolate every float attribute in cloud local space.
 * Footprint must be a disjoint triangle tessellation. Output is nonindexed.
 * Caps fail atomically; no partial geometry is returned. */
export function clipProjectedSurface(
  cloud: THREE.BufferGeometry, cloudOrigin: SurfaceClipOrigin,
  footprint: THREE.BufferGeometry, footprintOrigin: SurfaceClipOrigin,
  options: SurfaceClipOptions = {},
): { geometry: THREE.BufferGeometry; diagnostics: SurfaceClipDiagnostics } {
  const limits = { cellSize: 1, maxInputTriangles: 1_000_000, maxFootprintTriangles: 500_000, maxGridReferences: 5_000_000,
    maxCellsPerTriangle: 100_000, maxCandidateTests: 50_000_000, maxQueryOperations: 100_000_000,
    maxOutputTriangles: 2_000_000, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (key === 'minimumTriangleAreaM2' || key === 'unionCoverageAreaToleranceM2') continue;
    if (!Number.isFinite(value) || value <= 0 || (key !== 'cellSize' && !Number.isInteger(value)))
      throw new Error(`Invalid surface clip limit: ${key}`);
  }
  const minimumTriangleAreaM2 = options.minimumTriangleAreaM2 ?? 0;
  if (!Number.isFinite(minimumTriangleAreaM2) || minimumTriangleAreaM2 < 0) throw new Error('Invalid minimumTriangleAreaM2');
  if (options.unionCoverageAreaToleranceM2 !== undefined && (!Number.isFinite(options.unionCoverageAreaToleranceM2) || options.unionCoverageAreaToleranceM2 < 0)) throw new Error('Invalid unionCoverageAreaToleranceM2');
  for (const origin of [cloudOrigin, footprintOrigin])
    if (![origin.x, origin.y, origin.z].every(Number.isFinite)) throw new Error('Invalid surface origin');
  const validate = (geometry: THREE.BufferGeometry, triangleLimit: number) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!(position instanceof THREE.BufferAttribute) || !(position.array instanceof Float32Array)
      || position.itemSize !== 3 || !index || index.count % 3 !== 0)
      throw new Error('Surface clip requires indexed Float32 position triangles');
    if (index.count / 3 > triangleLimit || position.count > triangleLimit * 3)
      throw new Error('Surface clip input budget exhausted');
    for (const value of position.array) if (!Number.isFinite(value)) throw new Error('Nonfinite position');
    for (let i = 0; i < index.count; i++) {
      const value = index.getX(i);
      if (!Number.isInteger(value) || value < 0 || value >= position.count) throw new Error('Invalid triangle index');
    }
    return { position, index };
  };
  const source = validate(cloud, limits.maxInputTriangles), mask = validate(footprint, limits.maxFootprintTriangles);
  if (Object.keys(cloud.morphAttributes).length) throw new Error('Morph attributes are unsupported');
  const attributes = Object.entries(cloud.attributes).map(([name, attribute]) => {
    if (!(attribute instanceof THREE.BufferAttribute) || !(attribute.array instanceof Float32Array)
      || attribute.normalized || attribute.count !== source.position.count)
      throw new Error(`Unsupported surface attribute: ${name}`);
    for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error(`Nonfinite attribute: ${name}`);
    return { name, attribute, offset: 0, output: new FloatOutput() };
  });
  // Position first ensures clipping accesses x/y/z without attribute-order assumptions.
  attributes.sort((a, b) => Number(b.name === 'position') - Number(a.name === 'position'));
  let stride = 0;
  for (const attribute of attributes) { attribute.offset = stride; stride += attribute.attribute.itemSize; }
  const diagnostics: SurfaceClipDiagnostics = { inputTriangles: source.index.count / 3,
    footprintTriangles: mask.index.count / 3, outputTriangles: 0, unionPassthroughTriangles: 0, unionAcceptedResidualAreaM2: 0, unionMaximumAcceptedResidualAreaM2: 0, rejectedTinyTriangles: 0, rejectedTinyAreaM2: 0, outputAreaHistogram: [0,0,0,0,0], outputAreaHistogramM2: [0,0,0,0,0], candidateTests: 0, queryOperations: 0,
    gridReferences: 0, passthroughTriangles: 0 };
  const triangles: Triangle[] = [], grid = new Map<string, number[]>();
  const cells = (points: number[][]) => {
    const x0 = Math.floor(Math.min(...points.map(p => p[0]!)) / limits.cellSize);
    const x1 = Math.floor(Math.max(...points.map(p => p[0]!)) / limits.cellSize);
    const z0 = Math.floor(Math.min(...points.map(p => p[1]!)) / limits.cellSize);
    const z1 = Math.floor(Math.max(...points.map(p => p[1]!)) / limits.cellSize);
    if (![x0, x1, z0, z1].every(Number.isSafeInteger)) throw new Error('Unsafe surface clip grid coordinate');
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > limits.maxCellsPerTriangle)
      throw new Error('Surface clip cell budget exhausted');
    return { x0, x1, z0, z1 };
  };
  for (let i = 0; i < mask.index.count; i += 3) {
    const p = [0, 1, 2].map(k => { const j = mask.index.getX(i + k);
      return [mask.position.getX(j) + footprintOrigin.x - cloudOrigin.x,
        mask.position.getZ(j) + footprintOrigin.z - cloudOrigin.z]; });
    const area = (p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!)
      - (p[1]![1]! - p[0]![1]!) * (p[2]![0]! - p[0]![0]!);
    if (area === 0) throw new Error('Degenerate footprint triangle');
    const id = triangles.length; triangles.push({ p, sign: Math.sign(area) });
    const box = cells(p);
    for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) {
      if (++diagnostics.gridReferences > limits.maxGridReferences) throw new Error('Surface clip grid budget exhausted');
      const key = `${x},${z}`, list = grid.get(key);
      if (list) list.push(id); else grid.set(key, [id]);
    }
  }
  const queryOperation = () => {
    if (++diagnostics.queryOperations > limits.maxQueryOperations) throw new Error('Surface clip query budget exhausted');
  };
  const distance = (v: Vertex, t: Triangle, edge: number) => {
    queryOperation();
    const a = t.p[edge]!, b = t.p[(edge + 1) % 3]!;
    return t.sign * ((b[0]! - a[0]!) * (v[2]! - a[1]!) - (b[1]! - a[1]!) * (v[0]! - a[0]!));
  };
  const inside = (v: Vertex, t: Triangle) => [0, 1, 2].every(e => distance(v, t, e) >= 0);
  const emit = (a: Vertex, b: Vertex, c: Vertex) => {
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const area = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
    if (area === 0) return;
    if (area < minimumTriangleAreaM2) {
      diagnostics.rejectedTinyTriangles++; diagnostics.rejectedTinyAreaM2 += area; return;
    }
    const bin = [1e-16,1e-12,1e-8,1e-4].findIndex(limit => area <= limit);
    diagnostics.outputAreaHistogram[bin < 0 ? 4 : bin]!++;
    diagnostics.outputAreaHistogramM2[bin < 0 ? 4 : bin]! += area;
    if (++diagnostics.outputTriangles > limits.maxOutputTriangles) throw new Error('Surface clip output budget exhausted');
    for (const attribute of attributes) for (const vertex of [a, b, c])
      for (let k = 0; k < attribute.attribute.itemSize; k++) attribute.output.push(vertex[attribute.offset + k]!);
  };
  const union = options.unionCoverageAreaToleranceM2 === undefined ? undefined : createProjectedMeshSurface(
    footprint, new THREE.Vector3(footprintOrigin.x, footprintOrigin.y, footprintOrigin.z), {
      numericalAreaTolerance: options.unionCoverageAreaToleranceM2,
      cellSize: limits.cellSize, maxTriangles: limits.maxFootprintTriangles,
      maxGridEntries: limits.maxGridReferences, maxQueryCells: limits.maxCellsPerTriangle,
      maxCoverageOperations: 200_000,
    });
  if (union?.diagnostics.buildLimitExceeded || union?.diagnostics.invalidTriangles) {
    union.dispose(); throw new Error('Surface clip union query build budget or data failure');
  }
  try {
  for (let i = 0; i < source.index.count; i += 3) {
    const original = [0, 1, 2].map(k => {
      const j = source.index.getX(i + k), vertex: Vertex = [];
      for (const { attribute } of attributes) for (let c = 0; c < attribute.itemSize; c++) vertex.push(attribute.array[j * attribute.itemSize + c]!);
      return vertex;
    });
    // Full union coverage retains the original 3D triangle across native diagonals.
    // Degenerate XZ projections stay in the vertical-wall clipping path.
    const projectedArea = (original[1]![0]! - original[0]![0]!) * (original[2]![2]! - original[0]![2]!)
      - (original[1]![2]! - original[0]![2]!) * (original[2]![0]! - original[0]![0]!);
    if (union && projectedArea !== 0 && union.coversOriginalTriangle(original.map(v => ({
      x: v[0]! + cloudOrigin.x, y: v[1]! + cloudOrigin.y, z: v[2]! + cloudOrigin.z,
    })) as [{x:number;y:number;z:number},{x:number;y:number;z:number},{x:number;y:number;z:number}])) {
      emit(original[0]!, original[1]!, original[2]!);
      diagnostics.unionPassthroughTriangles++;
      diagnostics.unionAcceptedResidualAreaM2 += union.diagnostics.lastCoverageResidualArea;
      diagnostics.unionMaximumAcceptedResidualAreaM2 = Math.max(diagnostics.unionMaximumAcceptedResidualAreaM2, union.diagnostics.lastCoverageResidualArea);
      continue;
    }
    const box = cells(original.map(v => [v[0]!, v[2]!])), ids = new Set<number>();
    for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++)
      { queryOperation();
        for (const id of grid.get(`${x},${z}`) ?? []) { queryOperation(); ids.add(id); }
      }
    const candidates = [...ids].sort((a, b) => a - b);
    let passed = false;
    for (const id of candidates) {
      if (++diagnostics.candidateTests > limits.maxCandidateTests) throw new Error('Surface clip candidate budget exhausted');
      if (original.every(v => inside(v, triangles[id]!))) {
        emit(original[0]!, original[1]!, original[2]!); diagnostics.passthroughTriangles++; passed = true; break;
      }
    }
    if (passed) continue;
    for (const id of candidates) {
      if (++diagnostics.candidateTests > limits.maxCandidateTests) throw new Error('Surface clip candidate budget exhausted');
      const triangle = triangles[id]!; let polygon = original;
      for (let edge = 0; edge < 3 && polygon.length; edge++) {
        const result: Vertex[] = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j]!, b = polygon[(j + 1) % polygon.length]!;
          const da = distance(a, triangle, edge), db = distance(b, triangle, edge);
          if (da >= 0) result.push(a);
          if ((da < 0) !== (db < 0)) {
            const fraction = da / (da - db);
            result.push(a.map((value, k) => value + fraction * (b[k]! - value)));
          }
        }
        polygon = result;
      }
      // A vertical face on a shared tessellation edge belongs to the first triangle.
      // This includes point projections and avoids two identical vertical faces.
      if (polygon.length >= 3 && [0, 1, 2].some(e => polygon.every(v => distance(v, triangle, e) === 0))) {
        if (candidates.some(other => other < id && polygon.every(v => inside(v, triangles[other]!)))) continue;
      }
      for (let j = 1; j + 1 < polygon.length; j++) emit(polygon[0]!, polygon[j]!, polygon[j + 1]!);
    }
  }
  } finally {
    if (union) { diagnostics.unionCoverageDiagnostics = { ...union.diagnostics }; union.dispose(); }
  }
  const geometry = new THREE.BufferGeometry();
  for (const { name, attribute, output } of attributes)
    geometry.setAttribute(name, new THREE.BufferAttribute(output.finish(), attribute.itemSize));
  geometry.clearGroups();
  return { geometry, diagnostics };
}
