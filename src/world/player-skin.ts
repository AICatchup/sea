import * as THREE from 'three';

/** Procedural skin at metre scale. Maps tile every 111 mm on the body's existing UVs.
 * Pores are 0.25–0.65 mm, crossed furrows 1–3 mm. No photographic skin or likeness. */
export function createPlayerSkin() {
  const size = 258, normal = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n);
  };
  const field = (x: number, y: number) => {
    // A periodic cellular pore field avoids the regular sine-wave appearance of woven cloth.
    let pore = 0;
    const gx = Math.floor(x / 6), gy = Math.floor(y / 6);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cy = gy + j;
      const hx = ((cx % 43) + 43) % 43, hy = ((cy % 43) + 43) % 43;
      const px = cx * 6 + hash(hx, hy) * 6, py = cy * 6 + hash(hy, hx + 19) * 6;
      pore -= Math.exp(-((x - px) ** 2 + (y - py) ** 2) / .48) * .38;
    }
    const furrow = Math.pow(Math.abs(Math.sin((x * 37 + y * 11) * Math.PI * 2 / size)), 18)
      + Math.pow(Math.abs(Math.sin((y * 23 - x * 5) * Math.PI * 2 / size)), 20);
    return pore - furrow * .10;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (field(x + .5, y) - field(x - .5, y)) * .16;
    const dy = (field(x, y + .5) - field(x, y - .5)) * .16;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    normal.set([Math.round((n.x * .5 + .5) * 255), Math.round((n.y * .5 + .5) * 255), Math.round((n.z * .5 + .5) * 255), 255], i);
    const r = Math.round(224 + field(x, y) * 24); rough.set([r, r, r, 255], i);
  }
  const map = (data: Uint8Array, name: string) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.name = name; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
  };
  const normalMap = map(normal, 'skin pores and crossed furrows 111mm tile');
  const roughnessMap = map(rough, 'skin pore roughness');
  const material = new THREE.MeshPhysicalMaterial({ color: 0xb48870, roughness: .78,
    normalMap, roughnessMap, normalScale: new THREE.Vector2(.38, .38),
    metalness: 0, sheen: .08, sheenColor: new THREE.Color(0xb86e50), sheenRoughness: .85,
    clearcoat: 0, clearcoatRoughness: .24, side: THREE.FrontSide });
  material.userData.microdetail = { tileMetres: 1 / 9, poreDiameterMetres: [.00025, .00065], photographic: false };
  return { material, textures: [normalMap, roughnessMap], setWetness(value: number) {
    const wet = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    material.roughness = .78 - wet * .22; material.clearcoat = wet * .32;
    material.sheen = .08 * (1 - wet); material.normalScale.setScalar(.38 - wet * .08);
  } };
}
