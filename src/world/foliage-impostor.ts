import * as THREE from 'three';
import type {FoliageVariant} from './foliage.ts';

/**
 * Hemi-octahedral impostors for distant crowns, adapted from
 * agargaro/octahedral-impostor (MIT, see THIRD_PARTY_NOTICES). Each variant's
 * native near source is rendered unlit from a grid of upper-hemisphere views into
 * an sRGB albedo+coverage atlas and a view-normal atlas. A single camera-facing
 * quad then blends the three nearest views and is lit by the scene like any
 * MeshStandardMaterial, so presets and fog still apply.
 */
export interface ImpostorAtlas {
  readonly albedo:THREE.Texture;readonly normal:THREE.Texture;
  /** Crown bounding sphere in the variant's local (instance) space. */
  readonly sphere:THREE.Sphere;readonly spritesPerSide:number;
  /** Owner of both atlases (readable for inspection). */
  readonly target:THREE.WebGLRenderTarget;
  dispose():void;
}
export interface ImpostorOptions {textureSize?:number;spritesPerSide?:number}

/** Upper-hemisphere octahedral grid coordinate (0..1) to a unit direction. */
export function hemiOctaGridToDir(u:number,v:number,target=new THREE.Vector3()):THREE.Vector3{
  target.set(u-v,0,-1+u+v);target.y=1-Math.abs(target.x)-Math.abs(target.z);
  return target.normalize();
}
/** Inverse of hemiOctaGridToDir for directions with y>=0. */
export function hemiOctaDirToGrid(direction:THREE.Vector3,target=new THREE.Vector2()):THREE.Vector2{
  const sum=Math.abs(direction.x)+Math.abs(direction.y)+Math.abs(direction.z),x=direction.x/sum,z=direction.z/sum;
  return target.set((1+x+z)*.5,(1+z-x)*.5);
}

const bakeVertex=/* glsl */`
in vec3 position;in vec3 normal;in vec2 uv;
#ifdef USE_COLOR
in vec3 color;out vec3 vColor;
#endif
uniform mat4 modelViewMatrix,projectionMatrix;uniform mat3 normalMatrix;uniform vec4 crown;uniform float radial;
out vec3 vNormal;out vec2 vUv;flat out float vRadial;out float vCrownDepth;
void main(){
  vUv=uv;
  // Leaves: crown-volume normal (up-biased radial) blended with the card normal.
  // Thin double-sided cards otherwise all face the bake camera and light as one flat sheet.
  vec3 outward=normalize((position-crown.xyz)/crown.w+vec3(0,.35,0));
  vNormal=normalize(normalMatrix*normalize(mix(normal,outward,radial)));vRadial=radial;
  vCrownDepth=length(position-crown.xyz)/crown.w;
  #ifdef USE_COLOR
  vColor=color;
  #endif
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const bakeFragment=/* glsl */`
precision highp float;
uniform vec3 diffuse;uniform float alphaTest;
#ifdef USE_MAP
uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
uniform sampler2D alphaMap;
#endif
in vec3 vNormal;in vec2 vUv;flat in float vRadial;in float vCrownDepth;
#ifdef USE_COLOR
in vec3 vColor;
#endif
layout(location=0) out vec4 gAlbedo;
layout(location=1) out vec4 gNormal;
void main(){
  vec4 albedo=vec4(diffuse,1.0);
  // Base level: a minified leaf mask averages below the cutoff and empties the crown.
  #ifdef USE_MAP
  albedo*=textureLod(map,vUv,0.0);
  #endif
  #ifdef USE_ALPHAMAP
  albedo.a*=textureLod(alphaMap,vUv,0.0).g;
  #endif
  #ifdef USE_COLOR
  albedo.rgb*=vColor;
  #endif
  if(albedo.a<max(alphaTest,.2))discard;
  vec3 n=normalize(vNormal)*(vRadial>.5||gl_FrontFacing?1.0:-1.0);
  // Opaque coverage; the atlas is sRGB so the hardware encodes these linear values.
  // Cards cannot self-shadow like the native crown in the sun shadow map; bake an
  // interior occlusion so inner foliage and the trunk stay darker than the rim.
  float occlusion=vRadial>.0?mix(.38,1.0,smoothstep(.2,.9,vCrownDepth)):.62;
  gAlbedo=vec4(albedo.rgb*occlusion,1.0);
  gNormal=vec4(n*.5+.5,1.0);
}`;

function bakeMaterial(source:THREE.MeshStandardMaterial,crown:THREE.Sphere):THREE.RawShaderMaterial{
  const leaves=source.userData.foliageRole==='leaves'||source.alphaTest>0;
  const defines:Record<string,string>={};
  if(source.map)defines.USE_MAP='';if(source.alphaMap)defines.USE_ALPHAMAP='';if(source.vertexColors)defines.USE_COLOR='';
  return new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:bakeVertex,fragmentShader:bakeFragment,defines,side:THREE.DoubleSide,
    uniforms:{diffuse:{value:source.color},alphaTest:{value:source.alphaTest},map:{value:source.map},alphaMap:{value:source.alphaMap},
      crown:{value:new THREE.Vector4(crown.center.x,crown.center.y,crown.center.z,crown.radius)},radial:{value:leaves?.5:0}}});
}

/** Renders the variant from spritesPerSide² upper-hemisphere directions. Renderer state is restored. */
export function bakeImpostor(renderer:THREE.WebGLRenderer,variant:FoliageVariant,options:ImpostorOptions={}):ImpostorAtlas{
  const size=options.textureSize??2048,sprites=options.spritesPerSide??12,cell=size/sprites;
  const scene=new THREE.Scene(),materials:THREE.RawShaderMaterial[]=[],sphere=new THREE.Sphere(),part=new THREE.Sphere();
  for(const p of variant.parts){
    if(!p.geometry.boundingSphere)p.geometry.computeBoundingSphere();
    sphere.isEmpty()?sphere.copy(p.geometry.boundingSphere!):sphere.union(part.copy(p.geometry.boundingSphere!));
  }
  for(const p of variant.parts){const material=bakeMaterial(p.material,sphere);materials.push(material);scene.add(new THREE.Mesh(p.geometry,material));}
  const target=new THREE.WebGLRenderTarget(size,size,{count:2,generateMipmaps:true,depthBuffer:true});
  const [albedo,normal]=target.textures;
  albedo.colorSpace=THREE.SRGBColorSpace;
  for(const t of target.textures){t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.type=THREE.UnsignedByteType;}
  normal.colorSpace=THREE.NoColorSpace;
  const camera=new THREE.OrthographicCamera(-sphere.radius,sphere.radius,sphere.radius,-sphere.radius,.001,sphere.radius*2.001);
  const previous={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),
    scissorTest:renderer.getScissorTest(),clear:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear};
  const direction=new THREE.Vector3();
  try{
    renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.autoClear=false;renderer.setScissorTest(false);renderer.clear(true,true,true);
    renderer.setScissorTest(true);
    for(let row=0;row<sprites;row++)for(let col=0;col<sprites;col++){
      hemiOctaGridToDir(col/(sprites-1),row/(sprites-1),direction);
      camera.position.copy(sphere.center).addScaledVector(direction,sphere.radius);
      // Same up vector as the runtime plane basis, including the pole.
      camera.up.set(0,1,0);if(direction.y>.999)camera.up.set(-1,0,0);
      camera.lookAt(sphere.center);camera.updateMatrixWorld();
      renderer.setViewport(col*cell,row*cell,cell,cell);renderer.setScissor(col*cell,row*cell,cell,cell);
      renderer.render(scene,camera);
    }
  }finally{
    renderer.setRenderTarget(previous.target);renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);renderer.setClearColor(previous.clear,previous.alpha);renderer.autoClear=previous.autoClear;
    materials.forEach(m=>m.dispose());
  }
  return {albedo,normal,sphere,spritesPerSide:sprites,target,dispose:()=>target.dispose()};
}

const vertexParameters=/* glsl */`
uniform vec4 impostorSphere;uniform float spritesPerSide;
flat varying vec4 vSpritesWeight;flat varying vec2 vSprite1;flat varying vec2 vSprite2;flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;varying vec2 vSpriteUV2;varying vec2 vSpriteUV3;varying mat3 vCardFrame;
vec2 encodeDirection(vec3 d){vec3 o=d/dot(d,sign(d));return vec2(1.0+o.x+o.z,1.0+o.z-o.x)*.5;}
vec3 decodeDirection(vec2 cell,float last){vec2 g=cell/last;vec3 p=vec3(g.x-g.y,0.0,-1.0+g.x+g.y);p.y=1.0-abs(p.x)-abs(p.z);return normalize(p);}
void planeBasis(vec3 n,out vec3 t,out vec3 b){vec3 up=n.y>.999?vec3(-1,0,0):vec3(0,1,0);t=normalize(cross(up,n));b=cross(n,t);}
vec2 planeUV(vec3 n,vec3 eye,vec3 ray){vec3 t,b;planeBasis(n,t,b);vec3 hit=eye+ray*(-dot(eye,n)/dot(ray,n));return vec2(dot(t,hit),dot(b,hit))+.5;}
`;
// Local quad space: the unit sphere around the crown, scale 2r, so the quad spans [-.5,.5].
const vertexMain=/* glsl */`
mat4 crown=instanceMatrix;crown[3].xyz+=mat3(instanceMatrix)*impostorSphere.xyz;
mat4 local=modelMatrix*crown*mat4(vec4(2.0*impostorSphere.w,0,0,0),vec4(0,2.0*impostorSphere.w,0,0),vec4(0,0,2.0*impostorSphere.w,0),vec4(0,0,0,1));
vec3 eye=(inverse(local)*vec4(cameraPosition,1.0)).xyz;
// Never sample below the horizon of the hemisphere atlas.
vec3 view=normalize(vec3(eye.x,max(eye.y,.0),eye.z)+vec3(0,1e-4,0));
vec3 t,b;planeBasis(view,t,b);
vec3 corner=t*position.x+b*position.y;
vec3 ray=normalize(corner-eye);
float last=spritesPerSide-1.0;vec2 grid=encodeDirection(view)*last,cell=min(floor(grid),vec2(last)),f=fract(grid);
vSpritesWeight=vec4(min(1.0-f.x,1.0-f.y),abs(f.x-f.y),min(f.x,f.y),ceil(f.x-f.y));
vSprite1=cell;vSprite2=min(cell+mix(vec2(0,1),vec2(1,0),vSpritesWeight.w),vec2(last));vSprite3=min(cell+1.0,vec2(last));
vSpriteUV1=planeUV(decodeDirection(vSprite1,last),eye,ray);vSpriteUV2=planeUV(decodeDirection(vSprite2,last),eye,ray);vSpriteUV3=planeUV(decodeDirection(vSprite3,last),eye,ray);
// Baked normals live in the card's (t,b,view) frame; carry it to view space.
mat3 toView=mat3(viewMatrix)*mat3(local);vCardFrame=mat3(normalize(toView*t),normalize(toView*b),normalize(toView*view));
vec4 seaWorld=local*vec4(corner,1.0);
// Same curvature drop as every other world material (prepareWorldMaterials).
vec2 seaDelta=seaWorld.xz-cameraPosition.xz;seaWorld.y-=dot(seaDelta,seaDelta)/(2.0*6371000.0);
vec4 mvPosition=viewMatrix*seaWorld;
// Pull the flat card to the crown front so hillside ground behind it does not clip it.
mvPosition.xyz-=normalize(mvPosition.xyz)*impostorSphere.w*length(mat3(crown)[0])*.45;
gl_Position=projectionMatrix*mvPosition;
`;
const fragmentParameters=/* glsl */`
uniform float spritesPerSide;uniform float alphaClamp;
flat varying vec4 vSpritesWeight;flat varying vec2 vSprite1;flat varying vec2 vSprite2;flat varying vec2 vSprite3;
varying vec2 vSpriteUV1;varying vec2 vSpriteUV2;varying vec2 vSpriteUV3;varying mat3 vCardFrame;
vec2 spriteUV(vec2 uv,vec2 cell){return (cell+clamp(uv,vec2(.002),vec2(.998)))/spritesPerSide;}
`;
const fragmentMap=/* glsl */`
vec2 uv1=spriteUV(vSpriteUV1,vSprite1),uv2=spriteUV(vSpriteUV2,vSprite2),uv3=spriteUV(vSpriteUV3,vSprite3);
vec4 crownColor=texture2D(map,uv1)*vSpritesWeight.x+texture2D(map,uv2)*vSpritesWeight.y+texture2D(map,uv3)*vSpritesWeight.z;
if(crownColor.a<=alphaClamp)discard;
// Mips average covered texels with empty black ones; divide back out.
diffuseColor.rgb*=crownColor.rgb/crownColor.a;
`;
const fragmentNormal=/* glsl */`
float faceDirection=gl_FrontFacing?1.0:-1.0;
// Mips also average empty (0,0,0,0) texels into the normals; undo by coverage first.
vec4 packedNormal=texture2D(normalMap,uv1)*vSpritesWeight.x+texture2D(normalMap,uv2)*vSpritesWeight.y+texture2D(normalMap,uv3)*vSpritesWeight.z;
vec3 normal=normalize(vCardFrame*normalize(packedNormal.xyz/max(packedNormal.a,1e-3)*2.0-1.0));
vec3 nonPerturbedNormal=normal;
`;

/** Shares atlas textures; dispose the atlas separately. */
export function impostorMaterial(atlas:ImpostorAtlas,roughness=.92):THREE.MeshStandardMaterial{
  const material=new THREE.MeshStandardMaterial({map:atlas.albedo,normalMap:atlas.normal,roughness,metalness:0,side:THREE.FrontSide});
  material.name='Octahedral crown impostor';
  // Own vertex projection: prepareWorldMaterials must not replace it again.
  material.userData={seaPrepared:true,foliageRole:'impostor',source:'Baked from the native CC0 near crown'};
  const uniforms={impostorSphere:{value:new THREE.Vector4(atlas.sphere.center.x,atlas.sphere.center.y,atlas.sphere.center.z,atlas.sphere.radius)},
    spritesPerSide:{value:atlas.spritesPerSide},alphaClamp:{value:.45}};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+vertexParameters).replace('#include <project_vertex>',vertexMain);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+fragmentParameters)
      .replace('#include <map_fragment>',fragmentMap).replace('#include <normal_fragment_begin>',fragmentNormal).replace('#include <normal_fragment_maps>','')
      // Same thin-leaf back-scatter as the native leaf material (foliage.ts).
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        reflectedLight.directDiffuse+=diffuseColor.rgb*directionalLights[0].color*pow(max(0.0,-dot(geometryNormal,directionalLights[0].direction)),2.0)*.10;
      #endif`);
  };
  material.customProgramCacheKey=()=>'sea-octahedral-impostor-v3';
  return material;
}

/** Unit quad whose bounds already include the instance's crown sphere for culling. */
export function impostorGeometry(atlas:ImpostorAtlas):THREE.PlaneGeometry{
  const geometry=new THREE.PlaneGeometry(1,1),s=atlas.sphere;
  geometry.boundingSphere=s.clone();
  geometry.boundingBox=new THREE.Box3(s.center.clone().subScalar(s.radius),s.center.clone().addScalar(s.radius));
  return geometry;
}
