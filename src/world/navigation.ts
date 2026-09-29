import type { GroundSampler } from './contracts.ts';

export interface NavigationPoint { x: number; z: number; }
export interface WaterRoute {
  points: NavigationPoint[];
  distance: number;
  expanded: number;
  error?: string;
}

export const WORLD_LIMIT = 35_000;
export const BOAT_MIN_DEPTH = 1.1;
const HULL_RADIUS = 2.1;
const SEGMENT_STEP = 1.5;
// A planned corridor is wider/deeper than a moving hull. This prevents different
// frame sample offsets from finding a tiny shoal between route samples.
const ROUTE_MIN_DEPTH = BOAT_MIN_DEPTH + 0.4;
const ROUTE_RADIUS = HULL_RADIUS + 1.2;

export function groundHeight(ground: GroundSampler, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return Infinity;
  const height = ground.heightAt(x, z);
  return Number.isFinite(height) ? height : Infinity;
}

export function pointDistance(a: NavigationPoint, b: NavigationPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Test the hull as well as its centre; the height sampler includes the seabed. */
export function isNavigableWater(ground: GroundSampler, point: NavigationPoint, minDepth = BOAT_MIN_DEPTH, radius = HULL_RADIUS): boolean {
  if (groundHeight(ground, point.x, point.z) > -minDepth) return false;
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    if (groundHeight(ground, point.x + Math.cos(angle) * radius, point.z + Math.sin(angle) * radius) > -minDepth) return false;
  }
  return true;
}

/** All navigation and frame movement use the same sampled shoreline test. */
export function waterSegmentClear(ground: GroundSampler, a: NavigationPoint, b: NavigationPoint, minDepth = BOAT_MIN_DEPTH, radius = HULL_RADIUS): boolean {
  const steps = Math.max(1, Math.ceil(pointDistance(a, b) / SEGMENT_STEP));
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    if (!isNavigableWater(ground, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, minDepth, radius)) return false;
  }
  return true;
}

export function findNearbyWater(ground: GroundSampler, origin: NavigationPoint, minDepth = BOAT_MIN_DEPTH, maxRadius = 360): NavigationPoint | null {
  if (isNavigableWater(ground, origin, minDepth)) return { ...origin };
  for (let radius = 4; radius <= maxRadius; radius += radius < 48 ? 4 : 12) {
    const samples = Math.min(96, Math.max(24, Math.ceil(radius / 2)));
    for (let index = 0; index < samples; index++) {
      // North is checked first, matching the entrance to Tomari's cove.
      const angle = index / samples * Math.PI * 2;
      const point = { x: origin.x + Math.sin(angle) * radius, z: origin.z - Math.cos(angle) * radius };
      if (isNavigableWater(ground, point, minDepth)) return point;
    }
  }
  return null;
}

export function findNearbyLand(ground: GroundSampler, origin: NavigationPoint, maxRadius = 85): NavigationPoint | null {
  const safe = (point: NavigationPoint): boolean => {
    const height = groundHeight(ground, point.x, point.z);
    if (height < -0.15 || height > 6) return false;
    return [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) =>
      Math.abs(groundHeight(ground, point.x + dx, point.z + dz) - height) <= 1.5);
  };
  if (safe(origin)) return { ...origin };
  for (let radius = 3; radius <= maxRadius; radius += 3) {
    const samples = Math.min(72, Math.max(16, Math.ceil(radius)));
    for (let index = 0; index < samples; index++) {
      const angle = index / samples * Math.PI * 2;
      const point = { x: origin.x + Math.sin(angle) * radius, z: origin.z - Math.cos(angle) * radius };
      if (safe(point)) return point;
    }
  }
  return null;
}

/** Sweep short steps so even a fast frame cannot walk through a cliff. */
export function footSegmentClear(ground: GroundSampler, a: NavigationPoint, b: NavigationPoint): boolean {
  const distance = pointDistance(a, b);
  const steps = Math.max(1, Math.ceil(distance / 0.4));
  let previous = groundHeight(ground, a.x, a.z);
  if (!Number.isFinite(previous)) return false;
  const horizontalStep = distance / steps;
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    const height = groundHeight(ground, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (!Number.isFinite(height) || Math.abs(height - previous) > Math.min(0.45, horizontalStep * 0.85 + 0.055)) return false;
    previous = height;
  }
  return true;
}

export function clampWorld(point: NavigationPoint): NavigationPoint {
  return { x: Math.max(-WORLD_LIMIT + 4, Math.min(WORLD_LIMIT - 4, point.x)),
    z: Math.max(-WORLD_LIMIT + 4, Math.min(WORLD_LIMIT - 4, point.z)) };
}

interface SearchNode { x: number; z: number; g: number; f: number; parent: number; key: number; }
class MinHeap {
  private values: SearchNode[] = [];
  get length(): number { return this.values.length; }
  push(value: SearchNode): void {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.values[parent].f <= value.f) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = value;
  }
  pop(): SearchNode {
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= this.values.length) break;
        if (child + 1 < this.values.length && this.values[child + 1].f < this.values[child].f) child++;
        if (this.values[child].f >= last.f) break;
        this.values[index] = this.values[child]; index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

interface SearchOptions {
  resolution: number; minX: number; maxX: number; minZ: number; maxZ: number;
  maxExpanded: number;
  escape?: boolean;
}

function openWater(ground: GroundSampler, point: NavigationPoint): boolean {
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    if (!isNavigableWater(ground, { x: point.x + Math.sin(angle) * 90, z: point.z + Math.cos(angle) * 90 }, ROUTE_MIN_DEPTH, ROUTE_RADIUS)) return false;
  }
  return true;
}

function routeSegmentClear(ground: GroundSampler, a: NavigationPoint, b: NavigationPoint): boolean {
  return waterSegmentClear(ground, a, b, ROUTE_MIN_DEPTH, ROUTE_RADIUS);
}

function searchWater(ground: GroundSampler, start: NavigationPoint, goal: NavigationPoint, options: SearchOptions): WaterRoute {
  const { resolution, maxExpanded } = options;
  // Anchor the lattice to the exact start so a small cove never loses its first node.
  const minI = Math.ceil((options.minX - start.x) / resolution), maxI = Math.floor((options.maxX - start.x) / resolution);
  const minJ = Math.ceil((options.minZ - start.z) / resolution), maxJ = Math.floor((options.maxZ - start.z) / resolution);
  const width = maxI - minI + 1;
  const keyFor = (i: number, j: number): number => (j - minJ) * width + i - minI;
  const pointFor = (i: number, j: number): NavigationPoint => ({ x: start.x + i * resolution, z: start.z + j * resolution });
  const heap = new MinHeap();
  const nodes = new Map<number, SearchNode>();
  const best = new Map<number, number>();
  const closed = new Set<number>();
  const water = new Map<number, boolean>();
  const first: SearchNode = { x: 0, z: 0, g: 0, f: pointDistance(start, goal), parent: -1, key: keyFor(0, 0) };
  heap.push(first); best.set(first.key, 0);
  let expanded = 0;
  while (heap.length && expanded < maxExpanded) {
    const current = heap.pop();
    if (closed.has(current.key) || current.g > (best.get(current.key) ?? Infinity)) continue;
    closed.add(current.key); nodes.set(current.key, current); expanded++;
    const point = pointFor(current.x, current.z);
    const reached = options.escape
      ? pointDistance(start, point) >= 420 && openWater(ground, point)
      : pointDistance(point, goal) <= resolution * 1.5 && routeSegmentClear(ground, point, goal);
    if (reached) {
      const points: NavigationPoint[] = options.escape ? [] : [{ ...goal }];
      let node = current;
      while (node.parent !== -1) {
        points.push(pointFor(node.x, node.z));
        node = nodes.get(node.parent)!;
      }
      points.push({ ...start }); points.reverse();
      const simplified = simplifyWaterPath(ground, points);
      return { points: simplified, distance: routeDistance(simplified), expanded };
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const i = current.x + dx, j = current.z + dz;
      if (i < minI || i > maxI || j < minJ || j > maxJ) continue;
      const key = keyFor(i, j);
      if (closed.has(key)) continue;
      const next = pointFor(i, j);
      let clear = water.get(key);
      if (clear === undefined) { clear = isNavigableWater(ground, next, ROUTE_MIN_DEPTH, ROUTE_RADIUS); water.set(key, clear); }
      if (!clear) continue;
      const g = current.g + Math.hypot(dx, dz) * resolution;
      if (g >= (best.get(key) ?? Infinity) || !routeSegmentClear(ground, point, next)) continue;
      best.set(key, g);
      heap.push({ x: i, z: j, g, f: g + pointDistance(next, goal), parent: current.key, key });
    }
  }
  return { points: [], distance: 0, expanded,
    error: expanded >= maxExpanded ? '航路の探索範囲を超えました。少し沖へ移動してから再出航してください。' : '浅瀬や陸地に阻まれて航路が見つかりません。少し沖へ移動してください。' };
}

export function routeDistance(points: NavigationPoint[]): number {
  let result = 0;
  for (let index = 1; index < points.length; index++) result += pointDistance(points[index - 1], points[index]);
  return result;
}

function simplifyWaterPath(ground: GroundSampler, points: NavigationPoint[]): NavigationPoint[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  let index = 0;
  while (index < points.length - 1) {
    let next = points.length - 1;
    while (next > index + 1 && !routeSegmentClear(ground, points[index], points[next])) next--;
    result.push(points[next]); index = next;
  }
  return result;
}

/** Fine harbour exits are joined to a bounded wider route, then sampled again. */
export function planWaterRoute(ground: GroundSampler, start: NavigationPoint, goal: NavigationPoint): WaterRoute {
  if (!isNavigableWater(ground, start, ROUTE_MIN_DEPTH, ROUTE_RADIUS) || !isNavigableWater(ground, goal, ROUTE_MIN_DEPTH, ROUTE_RADIUS)) {
    return { points: [], distance: 0, expanded: 0, error: '出発地点または到着地点の水深が足りません。' };
  }
  if (routeSegmentClear(ground, start, goal)) return { points: [{ ...start }, { ...goal }], distance: pointDistance(start, goal), expanded: 0 };
  const distance = pointDistance(start, goal);
  if (distance < 1_800) {
    const margin = Math.max(650, distance * 0.85);
    const local = searchWater(ground, start, goal, { resolution: 12,
      minX: Math.min(start.x, goal.x) - margin, maxX: Math.max(start.x, goal.x) + margin,
      minZ: Math.min(start.z, goal.z) - margin, maxZ: Math.max(start.z, goal.z) + margin, maxExpanded: 90_000 });
    if (!local.error) return local;
  }
  const escape = (point: NavigationPoint, toward: NavigationPoint): WaterRoute => {
    if (openWater(ground, point)) return { points: [{ ...point }], distance: 0, expanded: 0 };
    const bearingDistance = Math.max(1, pointDistance(point, toward));
    const target = { x: point.x + (toward.x - point.x) / bearingDistance * 660,
      z: point.z + (toward.z - point.z) / bearingDistance * 660 };
    return searchWater(ground, point, target, { resolution: 12, minX: point.x - 900, maxX: point.x + 900,
      minZ: point.z - 900, maxZ: point.z + 900, maxExpanded: 22_800, escape: true });
  };
  const departure = escape(start, goal), arrival = escape(goal, start);
  if (departure.error || arrival.error) return { points: [], distance: 0, expanded: departure.expanded + arrival.expanded,
    error: '入り江から安全に出入りできる航路が見つかりません。手動操船で沖へ移動してください。' };
  const from = departure.points[departure.points.length - 1], to = arrival.points[arrival.points.length - 1];
  let middle: WaterRoute;
  if (routeSegmentClear(ground, from, to)) middle = { points: [from, to], distance: pointDistance(from, to), expanded: 0 };
  else {
    const margin = Math.min(6_000, Math.max(1_400, distance * 0.26));
    middle = searchWater(ground, from, to, { resolution: distance < 6_000 ? 24 : distance < 20_000 ? 48 : 80,
      minX: Math.max(-WORLD_LIMIT + 4, Math.min(from.x, to.x) - margin),
      maxX: Math.min(WORLD_LIMIT - 4, Math.max(from.x, to.x) + margin),
      minZ: Math.max(-WORLD_LIMIT + 4, Math.min(from.z, to.z) - margin),
      maxZ: Math.min(WORLD_LIMIT - 4, Math.max(from.z, to.z) + margin), maxExpanded: 160_000 });
  }
  if (middle.error) return { ...middle, expanded: middle.expanded + departure.expanded + arrival.expanded };
  const points = simplifyWaterPath(ground, [...departure.points, ...middle.points.slice(1), ...arrival.points.slice(0, -1).reverse()]);
  return { points, distance: routeDistance(points), expanded: middle.expanded + departure.expanded + arrival.expanded };
}
