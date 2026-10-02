import * as THREE from 'three';
import {GeometryReceivers} from './geometry-receivers.ts';
import {receiverTraceGLSL} from './geometry-receivers-glsl.ts';
const WIDTH=1024,TILE=512;
export const RECEIVER_PARAM_TEXELS=23;
const MAP_KEYS=['map','normalMap','aoMap','roughnessMap','metalnessMap','emissiveMap'] as const;
type Surface=THREE.MeshStandardMaterial;
export interface ReceiverMaterialOptions {extraMaterials?:()=>readonly THREE.Material[];extraDynamicData?:()=>Float32Array;bedNormal?:THREE.Texture;bedARM?:THREE.Texture;}
const floatTexture=(data:Float32Array)=>{const t=new THREE.DataTexture(data,WIDTH,data.length/(WIDTH*4),THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;};
export function concatenateReceiverData(parts:readonly Float32Array[]):{data:Float32Array;offsets:number[]}{let length=0;const offsets=parts.map(p=>{const o=length/4;length+=p.length;return o;});const data=new Float32Array(Math.max(WIDTH*4,Math.ceil(length/(WIDTH*4))*WIDTH*4));let at=0;for(const p of parts){data.set(p,at);at+=p.length;}return {data,offsets};}
/** Each map has independent transform/wrap/flip and a raw linear atlas layer. UV0 is the packed geometry contract. */
export function packReceiverMaterialParameters(materials:readonly THREE.Material[],layers:ReadonlyMap<THREE.Texture,number>):Float32Array{
 const data=new Float32Array(materials.length*RECEIVER_PARAM_TEXELS*4);
 materials.forEach((entry,id)=>{const m=entry as Surface,at=id*RECEIVER_PARAM_TEXELS*4;
 if(m.normalMap&&m.normalMapType===THREE.ObjectSpaceNormalMap)throw new Error("Receiver object-space normal maps unsupported; tangent-space required");
 data.set([...(m.color??new THREE.Color(1,1,1)).toArray(),Math.max(.04,m.roughness??.8)],at);
 data.set([m.metalness??0,m.vertexColors?1:0,m.aoMapIntensity??1,m.normalMapType===THREE.ObjectSpaceNormalMap?1:0],at+4);
 data.set([...(m.emissive??new THREE.Color(0,0,0)).toArray(),m.emissiveIntensity??0],at+8);
 data.set([m.normalScale?.x??1,m.normalScale?.y??1,0,0],at+12);
 MAP_KEYS.forEach((key,k)=>{const map=m[key];const offset=at+(4+k*3)*4;
 if(map&&!layers.has(map))throw new Error(`Receiver ${key} missing atlas layer`);
 if(map&&map.channel!==0)throw new Error(`Receiver ${key} uses unsupported UV channel ${map.channel}; only UV0 is packed`);
 if(map?.matrixAutoUpdate)map.updateMatrix();const e=map?.matrix.elements??new THREE.Matrix3().elements;
 const flip=map&&!(typeof ImageBitmap!=='undefined'&&map.image instanceof ImageBitmap)&&map.flipY?1:0;
 data.set([map?layers.get(map)??-1:-1,map?.colorSpace===THREE.SRGBColorSpace?1:0,flip,0],offset);
 data.set([e[0],e[3],e[6],map?.wrapS===THREE.ClampToEdgeWrapping?1:map?.wrapS===THREE.MirroredRepeatWrapping?2:0],offset+4);
 data.set([e[1],e[4],e[7],map?.wrapT===THREE.ClampToEdgeWrapping?1:map?.wrapT===THREE.MirroredRepeatWrapping?2:0],offset+8);
 });
 });return data;
}
/** Owns only its packed textures and its synthetic bed material. Source maps/materials remain borrowed. */
export class ReceiverBridge {
 readonly geometry:GeometryReceivers;readonly uniforms:Record<string,THREE.IUniform>;
 readonly diagnostics={available:false,reason:'not initialized',materials:0,bytes:0,rebuilds:0,refits:0,atlasRebuilds:0,parameterUpdates:0};
 private rebuild=-1;private disposed=false;private atlasSignature='';private parameterSignature='';private layers=new Map<THREE.Texture,number>();private readonly bed:Surface;
 private readonly maxTextureSize:number;private readonly maxLayers:number;private readonly options:ReceiverMaterialOptions;
 constructor(scene:THREE.Object3D,include:(mesh:THREE.Mesh)=>boolean,maxTextureSize:number,maxLayers:number,sand:THREE.Texture,options:ReceiverMaterialOptions={}){
 this.maxTextureSize=maxTextureSize;this.maxLayers=maxLayers;this.options=options;
 this.geometry=new GeometryReceivers(scene,{include,coverage:'Opaque UV0 authored meshes; height-field bed separately.',maxTriangles:1_000_000});
 const atlas=new THREE.DataArrayTexture(new Uint8Array([255,255,255,255]),1,1,1);atlas.needsUpdate=true;
 this.uniforms={receiverStatic:{value:floatTexture(new Float32Array(WIDTH*4))},receiverDynamic:{value:floatTexture(new Float32Array(WIDTH*4))},receiverAlbedo:{value:atlas},receiverTextureWidth:{value:WIDTH},receiverRoot:{value:-1},receiverAvailable:{value:0},receiverTriangleOffset:{value:0},receiverInstanceOffset:{value:0},receiverMaterialOffset:{value:0},receiverBedMaterial:{value:0},receiverExtraMaterialBase:{value:0},receiverExtraDataOffset:{value:0}};
 this.bed=new THREE.MeshStandardMaterial({map:sand,normalMap:options.bedNormal??null,aoMap:options.bedARM??null,roughnessMap:options.bedARM??null,metalnessMap:options.bedARM??null,color:'#ffffff',roughness:.85});this.sync();
 }
 private checkSize(data:Float32Array){if(WIDTH>this.maxTextureSize||data.length/(WIDTH*4)>this.maxTextureSize)throw new Error('Packed receiver texture exceeds GPU maximum size');}
 private updateFloat(name:string,data:Float32Array){const old=this.uniforms[name].value as THREE.DataTexture;const previous=old.image.data;if(previous?.length===data.length){previous.set(data);old.needsUpdate=true;}else{this.uniforms[name].value=floatTexture(data);old.dispose();}}
 private refreshAtlas(materials:readonly THREE.Material[]){
 const maps=[...new Set(materials.flatMap(m=>MAP_KEYS.map(k=>(m as Surface)[k]).filter((t):t is THREE.Texture=>!!t)))];
 const signature=maps.map(t=>`${t.uuid}:${t.version}:${t.source.uuid}:${t.source.version}`).join('|');if(signature===this.atlasSignature)return;
 if(TILE>this.maxTextureSize||Math.max(1,maps.length)>this.maxLayers)throw new Error('Receiver map atlas exceeds GPU size/layer limit');
 // Validate channels before allocating or replacing the current atlas.
 for(const m of materials)for(const k of MAP_KEYS){const t=(m as Surface)[k];if(t&&t.channel!==0)throw new Error(`Receiver ${k} uses unsupported UV channel ${t.channel}; only UV0 is packed`);}
 const pixels=new Uint8Array(TILE*TILE*4*Math.max(1,maps.length));pixels.fill(255);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Receiver atlas canvas unavailable');
 maps.forEach((t,id)=>{const image=t.image as {width:number;height:number;data?:ArrayLike<number>};if(!image||!image.width||!image.height)throw new Error('Receiver map image unavailable');ctx.clearRect(0,0,TILE,TILE);
 if(image.data){if(!(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*4)throw new Error('Unsupported receiver map data encoding (requires RGBA8)');const source=document.createElement('canvas');source.width=image.width;source.height=image.height;const c=source.getContext('2d');if(!c)throw new Error('Receiver source canvas unavailable');const d=c.createImageData(image.width,image.height);d.data.set(image.data);c.putImageData(d,0,0);ctx.drawImage(source,0,0,TILE,TILE);}else ctx.drawImage(t.image as CanvasImageSource,0,0,TILE,TILE);
 pixels.set(ctx.getImageData(0,0,TILE,TILE).data,id*TILE*TILE*4);});
 const atlas=new THREE.DataArrayTexture(pixels,TILE,TILE,Math.max(1,maps.length));atlas.colorSpace=THREE.NoColorSpace;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.magFilter=THREE.LinearFilter;atlas.generateMipmaps=true;atlas.needsUpdate=true;
 const old=this.uniforms.receiverAlbedo.value as THREE.Texture;this.uniforms.receiverAlbedo.value=atlas;old.dispose();this.layers=new Map(maps.map((t,i)=>[t,i]));this.atlasSignature=signature;this.diagnostics.atlasRebuilds++;
 }
 sync():boolean{if(this.disposed)return false;try{
 if(!this.geometry.refit()||!this.geometry.diagnostics.available)throw new Error(this.geometry.diagnostics.reason||'Receiver refit failed');
 const extras=this.options.extraMaterials?.()??[],materials=[...this.geometry.materials,...extras,this.bed];this.refreshAtlas(materials);
 const params=packReceiverMaterialParameters(materials,this.layers),sig=Array.from(params).join(',');if(sig!==this.parameterSignature){this.parameterSignature=sig;this.diagnostics.parameterUpdates++;}
 const p=this.geometry.packed;if(this.rebuild!==this.geometry.diagnostics.rebuilds){const packed=concatenateReceiverData([p.nodes,p.triangles]);this.checkSize(packed.data);this.updateFloat('receiverStatic',packed.data);this.uniforms.receiverTriangleOffset.value=packed.offsets[1];this.rebuild=this.geometry.diagnostics.rebuilds;this.diagnostics.rebuilds++;}
 const dynamic=concatenateReceiverData([p.tlas,p.instances,params,this.options.extraDynamicData?.()??new Float32Array(0)]);this.checkSize(dynamic.data);this.updateFloat('receiverDynamic',dynamic.data);this.uniforms.receiverInstanceOffset.value=dynamic.offsets[1];this.uniforms.receiverMaterialOffset.value=dynamic.offsets[2];this.uniforms.receiverExtraDataOffset.value=dynamic.offsets[3];this.uniforms.receiverRoot.value=this.geometry.uniforms.receiverRoot.value;
 this.uniforms.receiverExtraMaterialBase.value=this.geometry.materials.length;this.uniforms.receiverBedMaterial.value=materials.length-1;this.uniforms.receiverAvailable.value=1;this.diagnostics.available=true;this.diagnostics.reason='';this.diagnostics.refits++;this.diagnostics.materials=materials.length;this.diagnostics.bytes=(this.uniforms.receiverStatic.value as THREE.DataTexture).image.data!.byteLength+dynamic.data.byteLength+(this.uniforms.receiverAlbedo.value as THREE.DataArrayTexture).image.data!.byteLength;return true;
 }catch(error){this.uniforms.receiverAvailable.value=0;this.diagnostics.available=false;this.diagnostics.reason=error instanceof Error?error.message:String(error);return false;}}
 dispose(){if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.bed.dispose();for(const n of ['receiverStatic','receiverDynamic','receiverAlbedo'])(this.uniforms[n].value as THREE.Texture).dispose();this.uniforms.receiverAvailable.value=0;}
}
export const packedReceiverGLSL=receiverTraceGLSL
 .replace('uniform sampler2D receiverNodes;\nuniform sampler2D receiverTLAS;\nuniform sampler2D receiverTriangles;\nuniform sampler2D receiverInstances;','uniform sampler2D receiverStatic;\nuniform sampler2D receiverDynamic;\nuniform int receiverTriangleOffset, receiverInstanceOffset;')
 .replaceAll('receiverRead(receiverNodes,','receiverRead(receiverStatic,').replaceAll('receiverRead(receiverTLAS,','receiverRead(receiverDynamic,').replaceAll('receiverRead(receiverTriangles,','receiverRead(receiverStatic,receiverTriangleOffset+').replaceAll('receiverRead(receiverInstances,','receiverRead(receiverDynamic,receiverInstanceOffset+');
export const receiverMaterialGLSL=`
uniform highp sampler2DArray receiverAlbedo;
uniform int receiverMaterialOffset,receiverBedMaterial,receiverExtraMaterialBase;
// Optional linear scene irradiance / environment radiance. Zero/default uses bounded hemispherical approximation.
uniform vec3 receiverIBLGround,receiverIBLSky;uniform float receiverIBLStrength;
vec4 receiverMaterial(int id,int slot){return receiverRead(receiverDynamic,receiverMaterialOffset+id*23+slot);}
float receiverWrap(float v,float mode){if(mode>.5&&mode<1.5)return clamp(v,0.,1.);if(mode>1.5)return 1.-abs(mod(v,2.)-1.);return fract(v);}
vec3 receiverLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec4 receiverMap(int id,int map,vec2 uv,vec4 fallback,bool colour){int s=4+map*3;vec4 f=receiverMaterial(id,s),u=receiverMaterial(id,s+1),v=receiverMaterial(id,s+2);if(f.x<0.)return fallback;vec2 q=vec2(dot(u.xyz,vec3(uv,1)),dot(v.xyz,vec3(uv,1)));q=vec2(receiverWrap(q.x,u.w),receiverWrap(q.y,v.w));if(f.z>.5)q.y=1.-q.y;vec4 value=textureLod(receiverAlbedo,vec3(q,f.x),0.);if(colour&&f.y>.5)value.rgb=receiverLinear(value.rgb);return value;}
vec3 receiverSurfaceColourDetailed(int id,vec2 uv,vec3 vertexColor,vec3 p,vec3 n,vec3 eye,vec3 tangent,vec3 bitangent){
 vec4 base=receiverMaterial(id,0),flags=receiverMaterial(id,1),emission=receiverMaterial(id,2),scale=receiverMaterial(id,3);
 vec3 albedo=receiverMap(id,0,uv,vec4(1),true).rgb*base.rgb*mix(vec3(1),vertexColor,flags.y);
 float roughness=clamp(base.w*receiverMap(id,3,uv,vec4(1),false).g,.04,1.),metal=clamp(flags.x*receiverMap(id,4,uv,vec4(1),false).b,0.,1.),ao=clamp(1.+flags.z*(receiverMap(id,2,uv,vec4(1),false).r-1.),0.,1.);
 vec4 normalFlags=receiverMaterial(id,7);if(normalFlags.x>=0.&&flags.w<.5&&length(tangent)>.5&&length(bitangent)>.5){
  vec3 mapN=receiverMap(id,1,uv,vec4(.5,.5,1,1),false).xyz*2.-1.;mapN.xy*=scale.xy;
  // Transform UV0 triangle basis to normal-map UV axes (including mirrored wrapping and upload flip).
  vec4 nu=receiverMaterial(id,8),nv=receiverMaterial(id,9);float determinant=nu.x*nv.y-nu.y*nv.x;
  if(abs(determinant)>1e-8){vec3 t=normalize(tangent*nv.y-bitangent*nv.x)*sign(determinant),b=normalize(bitangent*nu.x-tangent*nu.y)*sign(determinant);
   vec2 raw=vec2(dot(nu.xyz,vec3(uv,1)),dot(nv.xyz,vec3(uv,1)));if(nu.w>1.5)t*=mod(floor(raw.x),2.)<1.?1.:-1.;if(nv.w>1.5)b*=mod(floor(raw.y),2.)<1.?1.:-1.;if(normalFlags.z>.5)b=-b;n=normalize(t*mapN.x+b*mapN.y+n*mapN.z);}}
 vec3 light=-refract(-uSunDirection,vec3(0,1,0),1./1.333);float shadow=surfaceSunVisibility(p+n*.03),nL=max(0.,dot(n,light)),nV=max(.001,dot(n,eye));
 vec3 h=normalize(eye+light);float nh=max(0.,dot(n,h)),vh=max(0.,dot(eye,h)),alpha=max(.025,roughness*roughness),a2=alpha*alpha,den=nh*nh*(a2-1.)+1.;
 float D=a2/(3.14159265*den*den),k=(roughness+1.)*(roughness+1.)*.125,G=nL/(nL*(1.-k)+k)*nV/(nV*(1.-k)+k);
 vec3 F0=mix(vec3(.04),albedo,metal),F=F0+(1.-F0)*pow(1.-vh,5.);vec3 diffuse=albedo*(1.-metal)*(1.-F)/3.14159265,specular=D*G*F/max(.001,4.*nL*nV);
 vec3 ground=receiverIBLStrength>0.?receiverIBLGround*receiverIBLStrength:vec3(.045,.04,.035),sky=receiverIBLStrength>0.?receiverIBLSky*receiverIBLStrength:vec3(.12,.14,.17);
 vec3 ambient=mix(ground,sky,clamp(n.y*.5+.5,0.,1.)),reflection=reflect(-eye,n);vec3 env=mix(ground,sky,clamp(reflection.y*.5+.5,0.,1.));
 vec3 Fenv=F0+(max(vec3(1.-roughness),F0)-F0)*pow(1.-nV,5.);vec3 ibl=(albedo*(1.-metal)*(1.-Fenv)*ambient+env*Fenv*(1.-.7*roughness))*ao;
 float depth=max(0.,-p.y),lightPath=depth/max(.4,light.y);vec3 spectral=exp(-vec3(.105,.021,.012)*lightPath);float focus=clamp(refractedIrradiance(p),.08,5.);
 return (diffuse+specular)*uSunColor*nL*shadow*spectral*focus+ibl*exp(-vec3(.07,.018,.009)*depth)+emission.rgb*emission.w*receiverMap(id,5,uv,vec4(1),true).rgb;
}
vec3 receiverSurfaceColour(int id,vec2 uv,vec3 vertexColor,vec3 p,vec3 n,vec3 eye){return receiverSurfaceColourDetailed(id,uv,vertexColor,p,n,eye,vec3(0),vec3(0));}
`;
