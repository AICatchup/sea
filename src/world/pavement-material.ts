import * as THREE from 'three';

export const PAVEMENT_SPAN=2.1;
export const PAVEMENT_TEXTURE_URLS={
 albedo:new URL('../assets/pavement/clean_asphalt_diff_2k.jpg',import.meta.url).href,
 normal:new URL('../assets/pavement/clean_asphalt_nor_gl_2k.jpg',import.meta.url).href,
 arm:new URL('../assets/pavement/clean_asphalt_arm_2k.jpg',import.meta.url).href,
} as const;

/** Ordinary CC0 road aggregate; site colour and wear remain authored. */
export function loadPavementTextures(){
 const pending:Promise<void>[]=[],loader=typeof document==='undefined'?undefined:new THREE.TextureLoader();
 const load=(role:keyof typeof PAVEMENT_TEXTURE_URLS,space:THREE.ColorSpace)=>{
  let texture=new THREE.Texture();
  if(loader)pending.push(new Promise<void>((resolve,reject)=>{texture=loader.load(PAVEMENT_TEXTURE_URLS[role],()=>resolve(),undefined,reject);}));
  texture.name=`Poly Haven Clean Asphalt / ${role}`;texture.colorSpace=space;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  // Existing pavement coordinates are in 0.6m units; all channels share a 2.1m span.
  texture.repeat.set(.6/PAVEMENT_SPAN,.6/PAVEMENT_SPAN);texture.offset.set(.17,.29);texture.anisotropy=8;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.userData={source:'https://polyhaven.com/a/clean_asphalt',license:'CC0-1.0',role,spanMeters:PAVEMENT_SPAN};return texture;
 };
 const albedo=load('albedo',THREE.SRGBColorSpace),normal=load('normal',THREE.NoColorSpace),arm=load('arm',THREE.NoColorSpace);
 return {albedo,normal,arm,textures:[albedo,normal,arm],ready:Promise.all(pending).then(()=>{})};
}
