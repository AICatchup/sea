import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ModelResources, randomSeed } from './procedural';

function coloredGeometry(vertices: number[], colors: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); return geometry;
}

export function fishGeometry(resources: ModelResources, species: number): THREE.BufferGeometry {
  const vertices: number[] = [], colors: number[] = [];
  const segments = 18, sides = 12;
  const base = new THREE.Color(species === 0 ? '#75876c' : species === 1 ? '#707574' : '#9bb0ae');
  const gold = new THREE.Color(species === 0 ? '#b5a767' : species === 1 ? '#667584' : '#c8ceba');
  const point = (i: number, side: number) => {
    const t = i / segments, angle = side / sides * Math.PI * 2;
    const radius = Math.pow(Math.max(0.001, Math.sin(t * Math.PI)), 0.65);
    return new THREE.Vector3((t - 0.5) * 0.89,
      Math.cos(angle) * radius * (species === 1 ? 0.18 : 0.13), Math.sin(angle) * radius * (species === 1 ? 0.075 : 0.065));
  };
  const shade = (point: THREE.Vector3) => {
    const top = THREE.MathUtils.clamp(point.y * 3 + 0.5, 0, 1);
    const stripe = species === 0 ? Math.sin(point.x * 83 + point.y * 13) * 0.13
      : species === 1 ? -Math.pow(Math.max(0, Math.cos(point.x * 43)), 12) * 0.33
        : Math.exp(-Math.abs(point.y) * 45) * 0.18;
    const gill = Math.abs(point.x - 0.16) < 0.028 ? 0.72 : 1;
    return base.clone().lerp(gold, Math.max(0, -point.y * 2.5)).multiplyScalar((1.12 - top * 0.35 + stripe) * gill);
  };
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    for (const point of [a, b, c]) colors.push(...shade(point).toArray());
  };
  for (let i = 0; i < segments; i++) for (let side = 0; side < sides; side++) {
    const a = point(i, side), b = point(i + 1, side), c = point(i + 1, side + 1), d = point(i, side + 1);
    triangle(a, c, b); triangle(a, d, c);
  }
  // Dorsal, anal and pectoral fins are thin real geometry rather than painted fins.
  const fins = [
    [new THREE.Vector3(-0.26, 0.09, 0), new THREE.Vector3(0.13, 0.12, 0), new THREE.Vector3(-0.15, species === 1 ? 0.26 : 0.2, 0)],
    [new THREE.Vector3(-0.23, -0.08, 0), new THREE.Vector3(0.08, -0.11, 0), new THREE.Vector3(-0.16, -0.18, 0)],
    [new THREE.Vector3(0.09, 0, 0.063), new THREE.Vector3(-0.07, -0.085, 0.13), new THREE.Vector3(-0.15, 0.018, 0.073)],
    [new THREE.Vector3(0.09, 0, -0.063), new THREE.Vector3(-0.15, 0.018, -0.073), new THREE.Vector3(-0.07, -0.085, -0.13)],
  ];
  for (const fin of fins) triangle(fin[0], fin[1], fin[2]);
  return resources.geometry(coloredGeometry(vertices, colors));
}

export function tailGeometry(resources: ModelResources, species: number): THREE.BufferGeometry {
  const color = new THREE.Color(species === 0 ? '#ac9e63' : species === 1 ? '#696e6b' : '#bac3b8');
  const tip = species === 1 ? 0.2 : 0.16;
  const vertices = [
    0, 0.036, 0, -0.2, tip, 0.006, -0.13, 0.005, 0,
    0, -0.036, 0, -0.13, -0.005, 0, -0.2, -tip, 0.006,
    0, 0.036, 0, -0.13, 0.005, 0, 0, -0.036, 0,
  ];
  const colors: number[] = [];
  for (let i = 0; i < vertices.length / 3; i++) colors.push(...color.toArray());
  return resources.geometry(coloredGeometry(vertices, colors));
}

export function fishEyes(resources: ModelResources): THREE.BufferGeometry {
  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.SphereGeometry(0.021, 8, 6);
    eye.scale(1, 1, 0.58); eye.translate(0.29, 0.031, side * 0.061); return eye;
  });
  const geometry = mergeGeometries(eyes, false)!; eyes.forEach((eye) => eye.dispose()); return resources.geometry(geometry);
}

export function seagrassGeometry(resources: ModelResources, seed: number, kelp = false): THREE.BufferGeometry {
  const random = randomSeed(seed), vertices: number[] = [], colors: number[] = [];
  const color = new THREE.Color(kelp ? '#716143' : '#5b7050');
  for (let blade = 0; blade < (kelp ? 7 : 12); blade++) {
    const angle = random() * Math.PI * 2, length = (kelp ? 0.85 : 0.28) + random() * (kelp ? 0.8 : 0.6);
    const width = kelp ? 0.038 + random() * 0.055 : 0.009 + random() * 0.012;
    const x = (random() - 0.5) * 0.2, z = (random() - 0.5) * 0.2;
    const point = (t: number, side: number) => {
      const lean = t * t * length * 0.38;
      const flutter = Math.sin(t * 11 + blade) * t * width * 1.4;
      const w = side * width * Math.sin(Math.PI * Math.min(t, 0.98)) * (kelp ? 1.5 : 0.8);
      return new THREE.Vector3(x + Math.cos(angle) * lean + Math.sin(angle) * (w + flutter), length * t,
        z + Math.sin(angle) * lean + Math.cos(angle) * (w + flutter));
    };
    for (let segment = 0; segment < 7; segment++) {
      const t0 = segment / 7, t1 = (segment + 1) / 7;
      const a = point(t0, -1), b = point(t0, 1), c = point(t1, 1), d = point(t1, -1);
      for (const point of [a, b, c, a, c, d]) {
        vertices.push(...point.toArray()); colors.push(...color.clone().multiplyScalar(0.74 + point.y / length * 0.45).toArray());
      }
    }
  }
  return resources.geometry(coloredGeometry(vertices, colors));
}

export function encrustingGeometry(resources: ModelResources, seed: number): THREE.BufferGeometry {
  const random = randomSeed(seed), parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const part = new THREE.IcosahedronGeometry(1, 1);
    const radius = 0.045 + random() * 0.065;
    part.scale(radius, radius * 0.4, radius);
    part.translate((random() - 0.5) * 0.35, 0.035 + random() * 0.035, (random() - 0.5) * 0.35); parts.push(part);
  }
  const geometry = mergeGeometries(parts, false)!; parts.forEach((part) => part.dispose()); return resources.geometry(geometry);
}
