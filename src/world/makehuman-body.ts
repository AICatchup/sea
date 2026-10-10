import * as THREE from 'three';

/**
 * CC0 MakeHuman body (scripts/build-makehuman-body.py): posed and joint-corrected onto the
 * existing FirstPersonBody rest skeleton, with MPFB game_engine weights merged onto its 47
 * bones. Joint keys are `bone name@L|R|C` (side from the rest point's X sign).
 */
export const MAKEHUMAN_URLS={
  json:new URL('../assets/player/makehuman-v65/makehuman-body.json',import.meta.url).href,
  bin:new URL('../assets/player/makehuman-v65/makehuman-body.bin',import.meta.url).href,
  skin:new URL('../assets/player/makehuman-v65/makehuman-skin.png',import.meta.url).href,
  eyes:new URL('../assets/player/makehuman-v65/makehuman-eyes.png',import.meta.url).href,
  eyebrows:new URL('../assets/player/makehuman-v65/makehuman-eyebrows.png',import.meta.url).href,
  eyelashes:new URL('../assets/player/makehuman-v65/makehuman-eyelashes.png',import.meta.url).href,
} as const;

interface PartMeta {name:string;vertices:number;indices:number;position:number;normal:number;uv:number;joints:number;weights:number;index:number}
export interface MakeHumanMeta {parts:PartMeta[];boneKeys:string[];sha256:string;provenance:Record<string,unknown>}
export interface MakeHumanSource {meta:MakeHumanMeta;bin:ArrayBuffer;textures?:Partial<Record<'skin'|'eyes'|'eyebrows'|'eyelashes',THREE.Texture>>}

/** Releases a loaded source whose texture ownership has not passed to the body. */
export function disposeMakeHumanSource(source:MakeHumanSource):void{
  new Set(Object.values(source.textures??{})).forEach(texture=>texture?.dispose());
}

export function boneKey(bone:THREE.Bone):string{
  const x=(bone.userData.restPoint as THREE.Vector3).x;
  return `${bone.name}@${x< -1e-6?'L':x>1e-6?'R':'C'}`;
}

/** Geometry per part with skin indices resolved onto the given bone order. */
export function makeHumanGeometries(source:MakeHumanSource,bones:readonly THREE.Bone[]):Map<string,THREE.BufferGeometry>{
  const {meta,bin}=source,byKey=new Map(bones.map((bone,i)=>[boneKey(bone),i]));
  const remap=meta.boneKeys.map(key=>{const i=byKey.get(key);if(i===undefined)throw new Error(`MakeHuman joint ${key} has no game bone`);return i;});
  const out=new Map<string,THREE.BufferGeometry>();
  for(const part of meta.parts){
    const n=part.vertices,geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(bin,part.position,n*3).slice(),3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(bin,part.normal,n*3).slice(),3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(bin,part.uv,n*2).slice(),2));
    const joints=new Uint8Array(bin,part.joints,n*4),skin=new Uint16Array(n*4);
    for(let i=0;i<joints.length;i++)skin[i]=remap[joints[i]];
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skin,4));
    geometry.setAttribute('skinWeight',new THREE.BufferAttribute(new Float32Array(bin,part.weights,n*4).slice(),4));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bin,part.index,part.indices).slice(),1));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    geometry.userData.makehuman={part:part.name,source:meta.provenance?.generator,license:meta.provenance?.license};
    out.set(part.name,geometry);
  }
  return out;
}

export async function loadMakeHumanSource():Promise<MakeHumanSource>{
  const [meta,bin]=await Promise.all([fetch(MAKEHUMAN_URLS.json).then(r=>{if(!r.ok)throw new Error(`MakeHuman meta ${r.status}`);return r.json();}),
    fetch(MAKEHUMAN_URLS.bin).then(r=>{if(!r.ok)throw new Error(`MakeHuman mesh ${r.status}`);return r.arrayBuffer();})]);
  const loader=new THREE.TextureLoader(),load=(url:string,srgb=true)=>loader.loadAsync(url).then(t=>{if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;});
  const results=await Promise.allSettled([load(MAKEHUMAN_URLS.skin),load(MAKEHUMAN_URLS.eyes),load(MAKEHUMAN_URLS.eyebrows),load(MAKEHUMAN_URLS.eyelashes)]);
  const failure=results.find(result=>result.status==='rejected');
  if(failure){results.forEach(result=>{if(result.status==='fulfilled')result.value.dispose();});throw failure.reason;}
  const [skin,eyes,eyebrows,eyelashes]=results.map(result=>(result as PromiseFulfilledResult<THREE.Texture>).value);
  return {meta,bin,textures:{skin,eyes,eyebrows,eyelashes}};
}

/** Continuous wear fields per vertex (rest pose, three.js metres). Interpolated across
 * triangles and thresholded per fragment, so the hood opening, cuffs and boot tops are
 * smooth curves instead of triangle staircases.
 *  face > 0 inside the hood opening (forehead to chin, cheek to cheek, front-facing)
 *  hand > .5 where hand and finger bones dominate (bare hands)
 *  boot > 0 below the boot top */
export function wearFields(p:THREE.Vector3,normal:THREE.Vector3,handWeight:number):{face:number;hand:number;boot:number}{
  const oval=1-Math.hypot(p.x/.074,(p.y-1.616)/.1);
  const front=Math.min((-p.z-.05)/.02,(-normal.z-.15)/.2);
  return {face:Math.min(oval,front),hand:handWeight,boot:(.13-p.y)/.012};
}
const HAND=/wrist|proximal|middle@|distal|thumb|metacarpal/;
export function isHandKey(key:string):boolean{return HAND.test(key)&&!/shoulder|elbow/.test(key);}

const vertexInject=`
attribute float wearFace;attribute float wearHand;attribute float wearBoot;
varying float vWearFace;varying float vWearHand;varying float vWearBoot;`;
const fragmentInject=`
varying float vWearFace;varying float vWearHand;varying float vWearBoot;
uniform vec3 suitColor;uniform vec3 bootColor;uniform float suitRoughness;
float wearSkin(){return max(smoothstep(0.0,.07,vWearFace),smoothstep(.42,.58,vWearHand));}`;
/** One body material: CC0 skin texture where bare, neoprene and boot rubber elsewhere. */
export function diverBodyMaterial(skinMap:THREE.Texture|null):THREE.MeshStandardMaterial{
  const material=new THREE.MeshStandardMaterial({name:'MakeHuman diver: skin, neoprene hood/suit, boots (CC0 skin)',map:skinMap,roughness:.52,metalness:0,color:0xf0e2d8});
  const uniforms={suitColor:{value:new THREE.Color(0x172a31)},bootColor:{value:new THREE.Color(0x12191a)},suitRoughness:{value:.89}};
  material.userData.wear=uniforms;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>'+vertexInject)
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvWearFace=wearFace;vWearHand=wearHand;vWearBoot=wearBoot;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>'+fragmentInject)
      .replace('#include <map_fragment>',`#include <map_fragment>
        float bareSkin=wearSkin(),boot=smoothstep(0.0,1.0,vWearBoot)*(1.0-bareSkin);
        diffuseColor.rgb=mix(mix(suitColor,bootColor,boot),diffuseColor.rgb,bareSkin);`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=mix(mix(suitRoughness,.92,boot),roughnessFactor,bareSkin);`);
  };
  material.customProgramCacheKey=()=>'sea-makehuman-wear-v1';
  return material;
}
