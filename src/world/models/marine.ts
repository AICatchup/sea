import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ModelResources, randomSeed, smoothNormalsByPosition } from './procedural.ts';

function coloredGeometry(vertices: number[], colors: number[], uv?: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  smoothNormalsByPosition(geometry); return geometry;
}

function profile(t: number, values: number[]): number {
  const p = t * (values.length - 1), i = Math.min(values.length - 2, Math.floor(p)), blend = p - i;
  return THREE.MathUtils.lerp(values[i], values[i + 1], blend * blend * (3 - 2 * blend));
}

/** Smooth UV body with a blunt snout, gill shoulder and narrow caudal peduncle. */
export function fishGeometry(resources: ModelResources, species: number): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const segments = 48, sides = 32;
  const heights = species === 1 ? [0.025, 0.065, 0.145, 0.196, 0.208, 0.186, 0.149, 0.104, 0.052, 0.018]
    : species === 0 ? [0.018, 0.036, 0.081, 0.117, 0.138, 0.137, 0.121, 0.104, 0.068, 0.019]
      : [0.016, 0.035, 0.073, 0.108, 0.127, 0.127, 0.106, 0.077, 0.045, 0.013];
  const widths = [0.013, 0.024, 0.038, 0.053, 0.066, 0.071, 0.065, 0.054, 0.036, 0.012];
  for (let i = 0; i <= segments; i++) for (let side = 0; side <= sides; side++) {
    const t = i / segments, angle = side / sides * Math.PI * 2;
    const h = profile(t, heights), w = profile(t, widths) * (species === 1 ? 1.08 : 1), y = Math.cos(angle) * h;
    positions.push((t - 0.5) * 0.9, y * (y < 0 ? 0.84 : 1) + Math.sin(t * Math.PI) * 0.012, Math.sin(angle) * w);
    uv.push(t, side / sides);
  }
  for (let i = 0; i < segments; i++) for (let side = 0; side < sides; side++) {
    const a = i * (sides + 1) + side, b = a + sides + 1;
    indices.push(a, b + 1, b, a, a + 1, b + 1);
  }
  for (const end of [0, segments]) {
    const tip = positions.length / 3;
    positions.push((end / segments - 0.5) * 0.9, 0, 0); uv.push(end / segments, 0.5);
    for (let side = 0; side < sides; side++) {
      const a = end * (sides + 1) + side;
      if (end === 0) indices.push(tip, a + 1, a); else indices.push(tip, a, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  smoothNormalsByPosition(geometry); geometry.computeBoundingSphere();
  geometry.userData.anatomy = 'smooth body / gill shoulder / peduncle / closed snout';
  return resources.geometry(geometry);
}

function dataTexture(resources: ModelResources, pixels: Uint8Array, width: number, height: number, color = false): THREE.DataTexture {
  const texture = resources.texture(new THREE.DataTexture(pixels, width, height));
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

/** Species-inspired markings and microscopic scale relief, not a fauna survey. */
export function fishMaterial(resources: ModelResources, species: number): THREE.MeshPhysicalMaterial {
  const width = 512, height = 256;
  const pixels = new Uint8Array(width * height * 4), normal = new Uint8Array(pixels.length), roughness = new Uint8Array(pixels.length);
  const dorsal = new THREE.Color(species === 0 ? '#545f39' : species === 1 ? '#344341' : '#4b6260');
  const flank = new THREE.Color(species === 0 ? '#89976e' : species === 1 ? '#96a496' : '#bfc6bd');
  const belly = new THREE.Color(species === 0 ? '#c4bc92' : '#c4c3a1');
  const stripe = new THREE.Color(species === 0 ? '#746644' : '#384746'), pale = new THREE.Color('#c7b778'), lateral = new THREE.Color('#638a85');
  const color = new THREE.Color();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, angle = y / height * Math.PI * 2, vertical = Math.cos(angle), side = Math.abs(Math.sin(angle));
    color.copy(flank).lerp(dorsal, Math.pow(Math.max(0, vertical), 1.7)).lerp(belly, Math.pow(Math.max(0, -vertical), 2) * 0.8);
    if (species === 0) {
      const lines = Math.pow(Math.max(0, Math.cos((u * 5.4 + vertical * 0.19) * Math.PI * 2)), 12) * side;
      color.lerp(stripe, lines * 0.55); color.lerp(pale, Math.exp(-Math.pow((vertical - 0.25) * 8, 2)) * side * 0.18);
    } else if (species === 1) {
      const bars = Math.pow(Math.max(0, Math.cos(u * Math.PI * 10 + 0.7)), 10);
      color.lerp(stripe, bars * side * 0.86 * (u > 0.1 && u < 0.91 ? 1 : 0.25));
    } else color.lerp(lateral, Math.exp(-Math.pow(vertical * 18, 2)) * 0.34);
    const gill = Math.exp(-Math.pow((u - 0.757 - vertical * 0.01) * 180, 2)) * side * 0.38;
    const lip = Math.exp(-Math.pow((u - 0.983) * 270, 2)) * 0.28;
    const row = y / height * 36, scallop = x / width * 41 + (Math.floor(row) % 2) * 0.5;
    const scale = Math.sin(scallop * Math.PI * 2) * Math.sin(row * Math.PI * 2);
    color.multiplyScalar(1 - gill - lip + scale * 0.027 * side).convertLinearToSRGB();
    const i = (y * width + x) * 4;
    pixels[i] = THREE.MathUtils.clamp(color.r * 255, 0, 255); pixels[i + 1] = THREE.MathUtils.clamp(color.g * 255, 0, 255);
    pixels[i + 2] = THREE.MathUtils.clamp(color.b * 255, 0, 255); pixels[i + 3] = 255;
    normal[i] = 128 + Math.cos(scallop * Math.PI * 2) * 9 * side; normal[i + 1] = 128 + Math.sin(row * Math.PI * 2) * 7 * side;
    normal[i + 2] = 254; normal[i + 3] = 255;
    const r = 143 + scale * 15 + Math.max(0, vertical) * 20; roughness.set([r, r, r, 255], i);
  }
  const material = resources.material(new THREE.MeshPhysicalMaterial({ map: dataTexture(resources, pixels, width, height, true),
    normalMap: dataTexture(resources, normal, width, height), roughnessMap: dataTexture(resources, roughness, width, height),
    normalScale: new THREE.Vector2(0.48, 0.48), roughness: 0.82, metalness: species === 2 ? 0.22 : 0.08,
    clearcoat: 0.26, clearcoatRoughness: 0.32, iridescence: species === 2 ? 0.22 : 0.1,
    iridescenceIOR: 1.34, iridescenceThicknessRange: [160, 320] }));
  material.name = ['muted wrasse scales', 'coastal damselfish vertical bars', 'silver shoal lateral line'][species];
  material.userData.photorealRole = 'authored fish / scales / gill'; return material;
}

function finFan(vertices: number[], colors: number[], uv: number[], root: THREE.Vector3[], tips: THREE.Vector3[], color: THREE.Color): void {
  for (let i = 0; i < tips.length - 1; i++) {
    const a = root[Math.min(i, root.length - 1)], b = root[Math.min(i + 1, root.length - 1)];
    const points: [THREE.Vector3, number, number][] = [[a, i / (tips.length - 1), 0], [tips[i], i / (tips.length - 1), 1],
      [tips[i + 1], (i + 1) / (tips.length - 1), 1], [a, i / (tips.length - 1), 0],
      [tips[i + 1], (i + 1) / (tips.length - 1), 1], [b, (i + 1) / (tips.length - 1), 0]];
    for (const [point, u, v] of points) { vertices.push(point.x, point.y, point.z); colors.push(color.r, color.g, color.b); uv.push(u, v); }
  }
}

export function finGeometry(resources: ModelResources, species: number): THREE.BufferGeometry {
  const vertices: number[] = [], colors: number[] = [], uv: number[] = [];
  const color = new THREE.Color(species === 0 ? '#baa66f' : species === 1 ? '#778479' : '#b1bdb1');
  const dorsal: THREE.Vector3[] = [], tips: THREE.Vector3[] = [], anal: THREE.Vector3[] = [], analTips: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = -0.3 + t * 0.51;
    const h = Math.sin((0.2 + t * 0.6) * Math.PI) * (species === 1 ? 0.196 : 0.132);
    const membrane = Math.sin(t * Math.PI) * (species === 1 ? 0.065 : 0.074) * (0.92 + Math.sin(t * 29) * 0.08);
    dorsal.push(new THREE.Vector3(x, h, 0)); tips.push(new THREE.Vector3(x - 0.03, h + membrane, Math.sin(t * 8) * 0.005));
    anal.push(new THREE.Vector3(x * 0.7 - 0.07, -h * 0.78, 0)); analTips.push(new THREE.Vector3(x * 0.7 - 0.105, -h * 0.78 - membrane * 0.61, 0));
  }
  finFan(vertices, colors, uv, dorsal, tips, color); finFan(vertices, colors, uv, anal, analTips, color);
  for (const side of [-1, 1]) {
    const root = new THREE.Vector3(0.15, 0.009, side * 0.058), fan: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const angle = -0.38 + i / 8 * 1.75;
      fan.push(new THREE.Vector3(root.x - Math.sin(angle) * 0.11, root.y - Math.cos(angle) * 0.067, side * (0.069 + Math.sin(i / 8 * Math.PI) * 0.057)));
    }
    finFan(vertices, colors, uv, [root], fan, color);
  }
  return resources.geometry(coloredGeometry(vertices, colors, uv));
}

export function tailGeometry(resources: ModelResources, species: number): THREE.BufferGeometry {
  const vertices: number[] = [], colors: number[] = [], uv: number[] = [], roots: THREE.Vector3[] = [], tips: THREE.Vector3[] = [];
  const color = new THREE.Color(species === 0 ? '#b4a475' : species === 1 ? '#839381' : '#c1c4b4');
  for (let i = 0; i <= 18; i++) {
    const t = i / 18, y = (t - 0.5) * (species === 1 ? 0.34 : 0.29);
    roots.push(new THREE.Vector3(0, (t - 0.5) * 0.047, 0));
    const notch = Math.pow(Math.sin(t * Math.PI), 2) * (species === 2 ? 0.095 : 0.038);
    tips.push(new THREE.Vector3(-0.19 + notch, y, Math.sin(t * Math.PI) * 0.005));
  }
  finFan(vertices, colors, uv, roots, tips, color); return resources.geometry(coloredGeometry(vertices, colors, uv));
}

export function finMaterial(resources: ModelResources, time: THREE.IUniform<number>): THREE.MeshPhysicalMaterial {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = y / size, ray = Math.pow(Math.max(0, Math.cos(x / size * Math.PI * 26)), 12);
    const edge = Math.min(1, (1 - v) * 14 + 0.05), shade = 231 + ray * 24;
    pixels.set([shade, shade, shade, (0.29 + ray * 0.44 + (1 - v) * 0.21) * edge * 255], (y * size + x) * 4);
  }
  const material = resources.material(new THREE.MeshPhysicalMaterial({ map: dataTexture(resources, pixels, size, size, true),
    vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.78, depthWrite: false,
    roughness: 0.57, metalness: 0.04, clearcoat: 0.12 }));
  material.name = 'thin fish fin membrane / visible radial rays'; material.userData.photorealRole = 'translucent fin';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFinTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFinTime;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uFinTime * 5.4 + position.x * 28.0) * 0.003 * uv.y;');
  };
  material.customProgramCacheKey = () => 'marine-fin-rays-v3'; return material;
}

export function fishEyes(resources: ModelResources): THREE.BufferGeometry {
  const eyes = [-1, 1].map((side) => {
    const eye = new THREE.SphereGeometry(0.021, 20, 12), position = eye.getAttribute('position');
    const colors = new Float32Array(position.count * 3), color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const radial = Math.hypot(position.getX(i), position.getY(i)) / 0.021, iris = radial > 0.42 && radial < 0.88;
      color.set(iris ? '#b3a16b' : radial < 0.42 ? '#080d0c' : '#384a3b');
      if (iris) color.multiplyScalar(0.8 + Math.sin(Math.atan2(position.getY(i), position.getX(i)) * 31) * 0.12);
      colors.set(color.toArray(), i * 3);
    }
    eye.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    eye.scale(1, 1, 0.57); eye.translate(0.3, 0.025, side * 0.05); return eye;
  });
  const geometry = mergeGeometries(eyes, false)!; eyes.forEach((eye) => eye.dispose()); return resources.geometry(geometry);
}

export function seagrassMaterial(resources: ModelResources, time: THREE.IUniform<number>): THREE.MeshStandardMaterial {
  const material = resources.material(new THREE.MeshStandardMaterial({ color: '#b8b7a1', vertexColors: true,
    side: THREE.DoubleSide, roughness: 0.84, transparent: true, opacity: 0.87, depthWrite: false }));
  material.name = 'thin muted coastal seaweed / current flex'; material.userData.photorealRole = 'seaweed membrane';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMarineTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uMarineTime;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float flex = pow(clamp(position.y / 1.3, 0.0, 1.0), 1.6);
      #ifdef USE_INSTANCING
        float plantPhase = instanceMatrix[3].x * .27 + instanceMatrix[3].z * .19;
      #else
        float plantPhase = 0.0;
      #endif
      transformed.x += sin(uMarineTime*.72 + position.y*3.1 + plantPhase)*flex*.09;
      transformed.z += cos(uMarineTime*.51 + position.y*2.2 + plantPhase)*flex*.055;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
      gl_FragColor.rgb += diffuseColor.rgb * (1.0 - abs(dot(normal, normalize(vViewPosition)))) * 0.04;
      #include <dithering_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'marine-seaweed-current-v3'; return material;
}

export function seagrassGeometry(resources: ModelResources, seed: number, kelp = false): THREE.BufferGeometry {
  const random = randomSeed(seed), vertices: number[] = [], colors: number[] = [], uv: number[] = [];
  const color = new THREE.Color(kelp ? '#756543' : '#69754e');
  for (let blade = 0; blade < (kelp ? 7 : 13); blade++) {
    const angle = random() * Math.PI * 2, length = (kelp ? 0.72 : 0.21) + random() * (kelp ? 0.65 : 0.48);
    const width = kelp ? 0.024 + random() * 0.038 : 0.005 + random() * 0.012;
    const x = (random() - 0.5) * 0.21, z = (random() - 0.5) * 0.21;
    const point = (t: number, side: number) => {
      const lean = t * t * length * 0.35, flutter = Math.sin(t * 12 + blade) * t * width * 0.75;
      const w = side * width * Math.pow(Math.sin(Math.PI * Math.min(t + 0.025, 0.999)), kelp ? 0.75 : 0.42);
      return new THREE.Vector3(x + Math.cos(angle) * lean + Math.sin(angle) * (w + flutter), length * t,
        z + Math.sin(angle) * lean + Math.cos(angle) * (w + flutter));
    };
    for (let segment = 0; segment < 14; segment++) {
      const t0 = segment / 14, t1 = (segment + 1) / 14;
      const points = [point(t0, -1), point(t0, 1), point(t1, 1), point(t0, -1), point(t1, 1), point(t1, -1)];
      const coordinates = [[0, t0], [1, t0], [1, t1], [0, t0], [1, t1], [0, t1]];
      points.forEach((point, i) => {
        vertices.push(point.x, point.y, point.z); uv.push(...coordinates[i]);
        const shade = 0.67 + point.y / length * 0.31 + (i % 3 === 1 ? 0.1 : 0); colors.push(color.r * shade, color.g * shade, color.b * shade);
      });
    }
  }
  return resources.geometry(coloredGeometry(vertices, colors, uv));
}

export function encrustingGeometry(resources: ModelResources, seed: number): THREE.BufferGeometry {
  const random = randomSeed(seed), parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const part = new THREE.SphereGeometry(1, 9, 6), radius = 0.045 + random() * 0.065;
    part.scale(radius, radius * 0.19, radius);
    part.translate((random() - 0.5) * 0.35, 0.018 + random() * 0.019, (random() - 0.5) * 0.35); parts.push(part);
  }
  const geometry = mergeGeometries(parts, false)!; parts.forEach((part) => part.dispose()); return resources.geometry(geometry);
}
