import * as THREE from 'three';

export const PLASTER_TEXTURE_URLS={
  albedo:new URL('../assets/plaster/white_plaster_02_diff_2k.jpg',import.meta.url).href,
  normal:new URL('../assets/plaster/white_plaster_02_nor_gl_2k.jpg',import.meta.url).href,
  arm:new URL('../assets/plaster/white_plaster_02_arm_2k.jpg',import.meta.url).href,
} as const;

/** Generic CC0 photographic finish; not pixels or a measured scan of the gate. */
export function loadPlasterTextures(){
  const pending:Promise<void>[]=[],loader=typeof document==='undefined'?undefined:new THREE.TextureLoader();
  const load=(role:keyof typeof PLASTER_TEXTURE_URLS,space:THREE.ColorSpace)=>{
    let texture=new THREE.Texture();
    if(loader)pending.push(new Promise<void>((resolve,reject)=>{texture=loader.load(PLASTER_TEXTURE_URLS[role],()=>resolve(),undefined,reject);}));
    texture.name=`Poly Haven White Plaster 02 / ${role}`;texture.colorSpace=space;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    // Gate UVs are in half-metre units; API metadata gives a 1.5m scan span.
    texture.repeat.set(1/3,1/3);texture.anisotropy=8;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.userData={source:'https://polyhaven.com/a/white_plaster_02',license:'CC0-1.0',role};
    return texture;
  };
  const albedo=load('albedo',THREE.SRGBColorSpace),normal=load('normal',THREE.NoColorSpace),arm=load('arm',THREE.NoColorSpace);
  return {albedo,normal,arm,textures:[albedo,normal,arm],ready:Promise.all(pending).then(()=>{})};
}
