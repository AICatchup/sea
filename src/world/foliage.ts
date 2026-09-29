import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cylinderBetween, ModelResources, randomSeed, surfaceTexture } from './models/procedural.ts';

const atlasURL = new URL('../assets/foliage/tomari-black-pine-v1.png', import.meta.url).href;
export interface FoliageGeometry { bark: THREE.BufferGeometry; needles: THREE.BufferGeometry; }

/** Photographic alpha sprays retain needles and open branch structure from every viewing direction. */
export class CoastalFoliage {
  readonly resources: ModelResources;
  readonly bark: THREE.MeshStandardMaterial;
  readonly leaves: THREE.MeshStandardMaterial;
  readonly pines: FoliageGeometry[];
  readonly shrubs: FoliageGeometry[];

  constructor(resources: ModelResources) {
    this.resources = resources;
    const atlas = resources.texture(typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(atlasURL));
    atlas.name = 'Authored photographic black-pine / evergreen alpha atlas';
    atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;
    atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
    this.leaves = resources.material(new THREE.MeshStandardMaterial({
      map: atlas, color: '#e0e4d6', roughness: .84, metalness: 0,
      side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, alphaTest: .35, alphaToCoverage: true,
      depthWrite: true, transparent: false, dithering: true,
    }));
    this.leaves.name = 'Pine needles and evergreen leaves / alpha cutout';
    this.bark = resources.material(new THREE.MeshStandardMaterial({ color: '#b8b4a9', roughness: .98,
      map: surfaceTexture(resources, '#787b70', 'bark', 1707) }));
    this.pines = [13, 41, 79].map(seed => this.pine(seed));
    this.shrubs = [19, 53, 83].map(seed => this.shrub(seed));
  }

  private card(width: number, height: number, tile: number, point: THREE.Vector3, rotation: THREE.Euler): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv'), tx = tile % 2, ty = tile < 2 ? 1 : 0;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (tx + .015 + uv.getX(i) * .97) * .5, (ty + .015 + uv.getY(i) * .97) * .5);
    geometry.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation)); geometry.translate(point.x, point.y, point.z);
    return geometry;
  }

  private finish(bark: THREE.BufferGeometry[], leaves: THREE.BufferGeometry[]): FoliageGeometry {
    const joinedBark = mergeGeometries(bark, false)!, joinedLeaves = mergeGeometries(leaves, false)!;
    for (const geometry of [...bark, ...leaves]) geometry.dispose();
    joinedBark.computeBoundingSphere(); joinedLeaves.computeBoundingSphere();
    return { bark: this.resources.geometry(joinedBark), needles: this.resources.geometry(joinedLeaves) };
  }

  private pine(seed: number): FoliageGeometry {
    const random = randomSeed(seed), bark: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    const height = 5.0 + random() * 1.15;
    const trunk = [new THREE.Vector3(), new THREE.Vector3(.12, height * .31, -.13),
      new THREE.Vector3(.29, height * .62, -.05), new THREE.Vector3(.46, height, .18)];
    for (let i = 1; i < trunk.length; i++) bark.push(cylinderBetween(trunk[i - 1], trunk[i], .17 - i * .032, .145 - i * .036, 7));
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.39996 + random() * .8, level = height * (.44 + random() * .48);
      const spread = 1.4 + random() * 1.4 - (level / height - .44) * .7;
      const origin = new THREE.Vector3(level * .06, level, 0);
      const elbow = new THREE.Vector3(Math.cos(angle) * spread * .67 + .2, level - .10, Math.sin(angle) * spread * .53);
      const tip = new THREE.Vector3(Math.cos(angle) * spread + .26, level + .35, Math.sin(angle) * spread * .83);
      bark.push(cylinderBetween(origin, elbow, .074, .028, 4), cylinderBetween(elbow, tip, .03, .008, 4));
      const width = 1.65 + random() * 1.2;
      leaves.push(this.card(width, width * .69, i % 2, tip, new THREE.Euler(-1.03 + random() * .3, angle, -.2 + random() * .4)));
      leaves.push(this.card(width * .9, width * .62, (i + 1) % 2, tip.clone().add(new THREE.Vector3(.08, .08, -.06)), new THREE.Euler(-.25, angle + Math.PI / 2, .1)));
      leaves.push(this.card(width * .78, width * .56, i % 2, tip.clone().lerp(elbow, .18), new THREE.Euler(.24, angle - .48, -.12)));
    }
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI * .5 + random();
      bark.push(cylinderBetween(new THREE.Vector3(Math.cos(angle) * .6, .04, Math.sin(angle) * .6), new THREE.Vector3(.03, .58, .02), .043, .075, 4));
    }
    return this.finish(bark, leaves);
  }

  private shrub(seed: number): FoliageGeometry {
    const random = randomSeed(seed), bark: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.39996, spread = .45 + random() * .46, height = .62 + random() * .68;
      const tip = new THREE.Vector3(Math.cos(angle) * spread, height, Math.sin(angle) * spread);
      bark.push(cylinderBetween(new THREE.Vector3(0, .02, 0), tip, .021, .005, 3));
      for (let c = 0; c < 2; c++) leaves.push(this.card(1.25 + random() * .55, .9 + random() * .32, 2 + i % 2,
        tip.clone().multiplyScalar(.81), new THREE.Euler(-.45 + c * .85, angle + c * Math.PI / 2, -.1 + random() * .2)));
    }
    return this.finish(bark, leaves);
  }
}
