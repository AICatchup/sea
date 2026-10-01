import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Ocean } from '../ocean/renderer';

/** DEV asset observer. Borrowed geometry/textures are never disposed or mutated. */
export function inspectBodyHands(ocean: Ocean) {
  const renderer = ocean.renderer;
  const saved = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), tone: renderer.toneMapping, exposure: renderer.toneMappingExposure, space: renderer.outputColorSpace, viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(), autoClear: renderer.autoClear };
  const observer = clone(ocean.body.group);
  const ownedMaterials: THREE.Material[] = [];
  const skeletons: THREE.Skeleton[] = [];
  observer.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      skeletons.push(object.skeleton);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.material = materials.map(source => { const material = source.clone(); ownedMaterials.push(material); return material; });
      object.frustumCulled = false;
    }
  });
  observer.visible = true;
  observer.updateMatrixWorld(true);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x303943); scene.add(observer);
  scene.environment = ocean.scene.environment;
  scene.environmentIntensity = .7;
  scene.add(new THREE.HemisphereLight(0xe3f0ff, 0x645342, 1.1));
  const key = new THREE.DirectionalLight(0xfff3e0, 3.2); scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xbcd9ff, 1.3); scene.add(fill, fill.target);
  const camera = new THREE.PerspectiveCamera(35, 1, .005, 20);
  const target = new THREE.WebGLRenderTarget(1024, 1024); target.texture.colorSpace = THREE.SRGBColorSpace;
  const images: { side: string; surface: string; wetness: number; png: string; camera: number[]; target: number[]; skin: unknown }[] = [];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  const pixels = new Uint8Array(1024 * 1024 * 4);
  try {
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.autoClear = true;
    renderer.setRenderTarget(target); renderer.setViewport(0,0,1024,1024); renderer.setScissorTest(false);
    for (const side of ['left', 'right']) {
      const wrist = observer.getObjectByName(`${side} wrist`);
      if (!wrist) throw new Error(`Missing ${side} wrist`);
      const local = (x: number, y: number, z: number) => wrist.localToWorld(new THREE.Vector3(x,y,z));
      const focus = local(0,-.092,0);
      for (const surface of ['dorsal','palm']) {
        const sign = surface === 'dorsal' ? 1 : -1;
        camera.position.copy(local(.018,-.10,sign*.39)); camera.up.copy(local(0,1,0).sub(local(0,0,0)).normalize()); camera.lookAt(focus); camera.updateMatrixWorld(true);
        key.position.copy(local(-.16,.10,sign*.24)); key.target.position.copy(focus);
        fill.position.copy(local(.16,-.14,sign*.18)); fill.target.position.copy(focus);
        for (const wetness of [0,1]) {
          const skin = ownedMaterials.find(m => m.name === 'sun-exposed skin') as THREE.MeshPhysicalMaterial;
          // Identical to createPlayerSkin.setWetness; cloned maps and vertex colors retained.
          skin.roughness = .78-wetness*.22; skin.clearcoat = wetness*.32; skin.sheen = .08*(1-wetness); skin.normalScale.setScalar(.38-wetness*.08);
          renderer.render(scene,camera); renderer.readRenderTargetPixels(target,0,0,1024,1024,pixels);
          const image = context.createImageData(1024,1024);
          for(let y=0;y<1024;y++) image.data.set(pixels.subarray((1023-y)*4096,(1024-y)*4096),y*4096);
          context.putImageData(image,0,0);
          images.push({side,surface,wetness,png:canvas.toDataURL('image/png'),camera:camera.position.toArray(),target:focus.toArray(),skin:{roughness:skin.roughness,clearcoat:skin.clearcoat,sheen:skin.sheen,normalScale:skin.normalScale.toArray()}});
        }
      }
    }
    return { provenance: 'asset-inspection: isolated lit clone of current geometry and current skeleton pose; no gameplay proof', size: [1024,1024], sharedGeometry: true, pose: 'current frozen bone transforms', images, restoration: 'synchronous finally; player state and live materials untouched' };
  } finally {
    renderer.setRenderTarget(saved.target); renderer.setClearColor(saved.color,saved.alpha); renderer.toneMapping=saved.tone; renderer.toneMappingExposure=saved.exposure; renderer.outputColorSpace=saved.space; renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest); renderer.autoClear=saved.autoClear;
    target.dispose(); ownedMaterials.forEach(material=>material.dispose()); skeletons.forEach(skeleton=>skeleton.dispose());
  }
}

