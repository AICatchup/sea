import * as THREE from 'three';
const albedoURL=new URL('../assets/niijima/rock-face-03/rock_face_03_diff_2k.jpg',import.meta.url).href;
const normalURL=new URL('../assets/niijima/rock-face-03/rock_face_03_nor_gl_2k.jpg',import.meta.url).href;
const armURL=new URL('../assets/niijima/rock-face-03/rock_face_03_arm_2k.jpg',import.meta.url).href;
const pumiceAlbedoURL=import.meta.env?.DEV===true?new URL('../assets/niijima/pumice-pbr-v54/albedo.png',import.meta.url).href:albedoURL;
const pumiceNormalURL=import.meta.env?.DEV===true?new URL('../assets/niijima/pumice-pbr-v54/normal.png',import.meta.url).href:normalURL;
const pumiceARMURL=import.meta.env?.DEV===true?new URL('../assets/niijima/pumice-pbr-v54/arm.png',import.meta.url).href:armURL;
export interface CliffTextureSet {albedo:THREE.Texture;normal:THREE.Texture;arm:THREE.Texture;ready:Promise<void>;available:THREE.IUniform<number>;textures:THREE.Texture[];tileMetres:THREE.IUniform<number>;meanLuminance:THREE.IUniform<number>;}
/** CC0 rock-scan baseline or optional generated pumice-grain study.
 * Both are analogue materials rather than a Niijima field scan. */
export function loadCliffTextures(pumiceGrain=false):CliffTextureSet{
 pumiceGrain=pumiceGrain&&import.meta.env?.DEV===true;
 const textures:THREE.Texture[]=[],pending:Promise<void>[]=[],available={value:0};let failed=false;
 const load=(url:string,color=false)=>{let done=()=>{};pending.push(new Promise<void>(resolve=>{done=resolve;}));const tex=typeof document==='undefined'?new THREE.Texture():new THREE.TextureLoader().load(url,()=>done(),undefined,()=>{failed=true;done();});if(typeof document==='undefined')done();tex.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;textures.push(tex);return tex;};
 const albedo=load(pumiceGrain?pumiceAlbedoURL:albedoURL,true),normal=load(pumiceGrain?pumiceNormalURL:normalURL),arm=load(pumiceGrain?pumiceARMURL:armURL);
 const ready=Promise.all(pending).then(()=>{available.value=failed?0:1;});return{albedo,normal,arm,ready,available,textures,tileMetres:{value:pumiceGrain?1.5:2.7},meanLuminance:{value:pumiceGrain?.6652112494164935:.16029633}};
}
/** Shared world-metre projection. No camera-facing image or baked illumination. */
export const cliffMaterialCommon=/*glsl*/`
 uniform sampler2D uCliffAlbedo,uCliffNormal,uCliffARM;
 uniform float uCliffReady,uCliffDetail,uCliffTileMetres,uCliffMeanLuminance;
 vec3 cliffScan(sampler2D source,vec2 uv,vec2 dx,vec2 dy,float blend){
   return mix(textureGrad(source,uv,dx,dy).rgb,textureGrad(source,uv+vec2(.371,.619),dx,dy).rgb,blend);
 }
 vec3 cliffTriScan(sampler2D source,vec3 p,vec3 dx,vec3 dy,vec3 weights,vec3 signs,float blend){
   vec3 c=vec3(0.);
   if(weights.x>.001)c+=cliffScan(source,vec2(-p.z*signs.x,p.y),vec2(-dx.z*signs.x,dx.y),vec2(-dy.z*signs.x,dy.y),blend)*weights.x;
   if(weights.y>.001)c+=cliffScan(source,vec2(p.x,-p.z*signs.y),vec2(dx.x,-dx.z*signs.y),vec2(dy.x,-dy.z*signs.y),blend)*weights.y;
   if(weights.z>.001)c+=cliffScan(source,vec2(p.x*signs.z,p.y),vec2(dx.x*signs.z,dx.y),vec2(dy.x*signs.z,dy.y),blend)*weights.z;
   return c;
 }
`;
export const cliffMaterialColour=/*glsl*/`
 float cliffAmount=uCliffReady*uCliffDetail*niiRockPhotoMask;
 vec3 cliffP=vNiijimaPoint/uCliffTileMetres,cliffDX=dFdx(cliffP),cliffDY=dFdy(cliffP);
 vec3 cliffSigns=sign(cross(dFdx(vNiijimaPoint),dFdy(vNiijimaPoint)));
 float cliffBlend=smoothstep(.25,.75,niiNoise(vNiijimaPoint*vec3(.011,.045,.071)));
 vec3 cliffARM=vec3(1,.9,0);
 if(cliffAmount>.001){
   vec3 sampled=cliffTriScan(uCliffAlbedo,cliffP,cliffDX,cliffDY,niiWeights,cliffSigns,cliffBlend);
   float grain=pow(clamp(dot(sampled,vec3(.2126,.7152,.0722))/uCliffMeanLuminance,.22,2.3),.46);
   cliffARM=cliffTriScan(uCliffARM,cliffP,cliffDX,cliffDY,niiWeights,cliffSigns,cliffBlend);
   // Neutral pumice pigment; retain the registered scan's grain and fissures.
   diffuseColor.rgb*=mix(vec3(1),vec3(grain)*mix(.82,1.,cliffARM.r),cliffAmount*.68);
   diffuseColor.rgb*=mix(1.,niiBedding.y,niiExposedFace*uCliffDetail);
   diffuseColor.rgb=mix(diffuseColor.rgb,min(diffuseColor.rgb,vec3(.86)),cliffAmount);
 }
`;
export const cliffMaterialNormal=/*glsl*/`
 if(cliffAmount>.001){
   vec3 baseN=inverseTransformDirection(normal,viewMatrix);
   vec3 gradient=vec3(0.),n;
   if(niiWeights.x>.001){n=normalize(cliffScan(uCliffNormal,vec2(-cliffP.z*cliffSigns.x,cliffP.y),vec2(-cliffDX.z*cliffSigns.x,cliffDX.y),vec2(-cliffDY.z*cliffSigns.x,cliffDY.y),cliffBlend)*2.-1.);gradient+=vec3(0.,-n.y,n.x*cliffSigns.x)/max(.35,n.z)*niiWeights.x;}
   if(niiWeights.y>.001){n=normalize(cliffScan(uCliffNormal,vec2(cliffP.x,-cliffP.z*cliffSigns.y),vec2(cliffDX.x,-cliffDX.z*cliffSigns.y),vec2(cliffDY.x,-cliffDY.z*cliffSigns.y),cliffBlend)*2.-1.);gradient+=vec3(-n.x,0.,n.y*cliffSigns.y)/max(.35,n.z)*niiWeights.y;}
   if(niiWeights.z>.001){n=normalize(cliffScan(uCliffNormal,vec2(cliffP.x*cliffSigns.z,cliffP.y),vec2(cliffDX.x*cliffSigns.z,cliffDX.y),vec2(cliffDY.x*cliffSigns.z,cliffDY.y),cliffBlend)*2.-1.);gradient+=vec3(-n.x*cliffSigns.z,-n.y,0.)/max(.35,n.z)*niiWeights.z;}
   // Project the registered scan gradient into the actual face tangent plane.
   gradient-=baseN*dot(gradient,baseN);
   vec3 mapped=normalize(baseN-gradient*mix(.24,.53,niiExposedFace));
   normal=normalize(mix(normal,mat3(viewMatrix)*mapped,cliffAmount));
 }
`;
