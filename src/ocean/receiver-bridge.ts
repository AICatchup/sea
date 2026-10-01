import * as THREE from 'three';
import {GeometryReceivers} from './geometry-receivers.ts';
import {receiverTraceGLSL} from './geometry-receivers-glsl.ts';

const WIDTH=1024,TILE=512,PARAM_TEXELS=6;
const floatTexture=(data:Float32Array)=>{const texture=new THREE.DataTexture(data,WIDTH,data.length/(WIDTH*4),THREE.RGBAFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;};
export function concatenateReceiverData(parts:readonly Float32Array[]):{data:Float32Array;offsets:number[]}{
  let length=0;const offsets=parts.map(p=>{const offset=length/4;length+=p.length;return offset;});
  const data=new Float32Array(Math.max(WIDTH*4,Math.ceil(length/(WIDTH*4))*WIDTH*4));let at=0;for(const part of parts){data.set(part,at);at+=part.length;}return {data,offsets};
}

/** Two packed samplers avoid requiring six additional texture units. Owns bridge textures only. */
export class ReceiverBridge {
  readonly geometry:GeometryReceivers;
  readonly uniforms:Record<string,THREE.IUniform>;
  readonly diagnostics={available:false,reason:'not initialized',materials:0,bytes:0,rebuilds:0,refits:0};
  private rebuild=-1;private disposed=false;
  private readonly maxTextureSize:number;private readonly maxLayers:number;
  constructor(scene:THREE.Object3D,include:(mesh:THREE.Mesh)=>boolean,maxTextureSize:number,maxLayers:number,sand:THREE.Texture){
    this.maxTextureSize=maxTextureSize;this.maxLayers=maxLayers;
    this.geometry=new GeometryReceivers(scene,{include,coverage:'Opaque non-DEM, non-foliage, non-skinned authored meshes; real instance transforms. Height-field seabed traced separately.',maxTriangles:1_000_000});
    const empty=floatTexture(new Float32Array(WIDTH*4)),dynamic=floatTexture(new Float32Array(WIDTH*4));
    const atlas=new THREE.DataArrayTexture(new Uint8Array([255,255,255,255]),1,1,1);atlas.needsUpdate=true;
    this.uniforms={receiverStatic:{value:empty},receiverDynamic:{value:dynamic},receiverAlbedo:{value:atlas},receiverTextureWidth:{value:WIDTH},receiverRoot:{value:-1},receiverAvailable:{value:0},receiverTriangleOffset:{value:0},receiverInstanceOffset:{value:0},receiverMaterialOffset:{value:0},receiverBedMaterial:{value:0}};
    this.sand=sand;this.sync();
  }
  private readonly sand:THREE.Texture;
  sync():boolean{
    if(this.disposed)return false;
    try{
      if(!this.geometry.refit()||!this.geometry.diagnostics.available)throw new Error(this.geometry.diagnostics.reason||'Receiver refit failed');
      if(this.rebuild!==this.geometry.diagnostics.rebuilds){this.buildStatic();this.rebuild=this.geometry.diagnostics.rebuilds;this.diagnostics.rebuilds++;}
      const packed=this.geometry.packed,dynamic=concatenateReceiverData([packed.tlas,packed.instances]);this.checkSize(dynamic.data);
      this.updateFloat('receiverDynamic',dynamic.data);this.uniforms.receiverInstanceOffset.value=dynamic.offsets[1];this.uniforms.receiverRoot.value=this.geometry.uniforms.receiverRoot.value;
      this.uniforms.receiverAvailable.value=1;this.diagnostics.available=true;this.diagnostics.reason='';this.diagnostics.refits++;return true;
    }catch(error){this.uniforms.receiverAvailable.value=0;this.diagnostics.available=false;this.diagnostics.reason=error instanceof Error?error.message:String(error);return false;}
  }
  private checkSize(data:Float32Array){if(WIDTH>this.maxTextureSize||data.length/(WIDTH*4)>this.maxTextureSize)throw new Error('Packed receiver texture exceeds GPU maximum size');}
  private updateFloat(name:string,data:Float32Array){
    const old=this.uniforms[name].value as THREE.DataTexture;
    const previous=old.image.data;if(previous?.length===data.length){previous.set(data);old.needsUpdate=true;}
    else{const next=floatTexture(data);this.uniforms[name].value=next;old.dispose();}
  }
  private buildStatic(){
    const materials=this.geometry.materials,bed=new THREE.MeshStandardMaterial({map:this.sand,color:'#ffffff',roughness:.85});
    const list=[...materials,bed];if(list.length>this.maxLayers){bed.dispose();throw new Error('Receiver material atlas exceeds GPU layer limit');}
    const pixels=new Uint8Array(TILE*TILE*4*list.length),parameters=new Float32Array(list.length*PARAM_TEXELS*4);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx){bed.dispose();throw new Error('Receiver atlas canvas unavailable');}
    try{
      for(let id=0;id<list.length;id++){
        const material=list[id] as THREE.MeshStandardMaterial,photo=material.map;
        ctx.clearRect(0,0,TILE,TILE);ctx.fillStyle='white';ctx.fillRect(0,0,TILE,TILE);
        let flip=0;
        if(photo){
          const image=photo.image as {width:number;height:number;data?:ArrayLike<number>};
          if(image.data){
            if(!(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*4)throw new Error('Unsupported receiver diffuse data encoding');
            const source=document.createElement('canvas');source.width=image.width;source.height=image.height;const c=source.getContext('2d')!;const data=c.createImageData(image.width,image.height);data.data.set(image.data);c.putImageData(data,0,0);ctx.drawImage(source,0,0,TILE,TILE);
          }else ctx.drawImage(photo.image as CanvasImageSource,0,0,TILE,TILE);
          if(!(typeof ImageBitmap!=='undefined'&&photo.image instanceof ImageBitmap))flip=photo.flipY?1:0;
          photo.updateMatrix();
        }
        const colour=ctx.getImageData(0,0,TILE,TILE).data;
        if(photo&&photo.colorSpace!==THREE.SRGBColorSpace)for(let p=0;p<colour.length;p+=4)for(let c=0;c<3;c++){const linear=colour[p+c]/255;colour[p+c]=Math.round(255*(linear<=.0031308?linear*12.92:1.055*linear**(1/2.4)-.055));}
        pixels.set(colour,id*TILE*TILE*4);
        const at=id*PARAM_TEXELS*4,color=material.color??new THREE.Color(1,1,1),matrix=photo?.matrix??new THREE.Matrix3();
        parameters.set([...color.toArray(),Math.max(.04,material.roughness??.8)],at);
        parameters.set([material.metalness??0,material.vertexColors?1:0,0,flip],at+4);
        parameters.set([matrix.elements[0],matrix.elements[3],matrix.elements[6],photo?.wrapS===THREE.ClampToEdgeWrapping?1:0],at+8);
        parameters.set([matrix.elements[1],matrix.elements[4],matrix.elements[7],photo?.wrapT===THREE.ClampToEdgeWrapping?1:0],at+12);
        parameters.set([...(material.emissive??new THREE.Color(0,0,0)).toArray(),material.emissiveIntensity??0],at+16);
        parameters.set([photo?.wrapS===THREE.MirroredRepeatWrapping?1:0,photo?.wrapT===THREE.MirroredRepeatWrapping?1:0,0,0],at+20);
      }
      const p=this.geometry.packed,packed=concatenateReceiverData([p.nodes,p.triangles,parameters]);this.checkSize(packed.data);
      this.updateFloat('receiverStatic',packed.data);this.uniforms.receiverTriangleOffset.value=packed.offsets[1];this.uniforms.receiverMaterialOffset.value=packed.offsets[2];this.uniforms.receiverBedMaterial.value=materials.length;
      const atlas=new THREE.DataArrayTexture(pixels,TILE,TILE,list.length);atlas.colorSpace=THREE.SRGBColorSpace;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.magFilter=THREE.LinearFilter;atlas.generateMipmaps=true;atlas.needsUpdate=true;
      const old=this.uniforms.receiverAlbedo.value as THREE.Texture;this.uniforms.receiverAlbedo.value=atlas;old.dispose();this.diagnostics.materials=list.length;this.diagnostics.bytes=packed.data.byteLength+pixels.byteLength;
    }finally{bed.dispose();}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.geometry.dispose();for(const name of ['receiverStatic','receiverDynamic','receiverAlbedo'])(this.uniforms[name].value as THREE.Texture).dispose();this.uniforms.receiverAvailable.value=0;}
}

export const packedReceiverGLSL=receiverTraceGLSL
 .replace('uniform sampler2D receiverNodes;\nuniform sampler2D receiverTLAS;\nuniform sampler2D receiverTriangles;\nuniform sampler2D receiverInstances;', 'uniform sampler2D receiverStatic;\nuniform sampler2D receiverDynamic;\nuniform int receiverTriangleOffset, receiverInstanceOffset;')
 .replaceAll('receiverRead(receiverNodes,','receiverRead(receiverStatic,')
 .replaceAll('receiverRead(receiverTLAS,','receiverRead(receiverDynamic,')
 .replaceAll('receiverRead(receiverTriangles,','receiverRead(receiverStatic,receiverTriangleOffset+')
 .replaceAll('receiverRead(receiverInstances,','receiverRead(receiverDynamic,receiverInstanceOffset+');

export const receiverMaterialGLSL=`
uniform highp sampler2DArray receiverAlbedo;
uniform int receiverMaterialOffset,receiverBedMaterial;
vec4 receiverMaterial(int id,int slot){return receiverRead(receiverStatic,receiverMaterialOffset+id*6+slot);}
float receiverWrap(float v,float clampEdge,float mirror){if(clampEdge>.5)return clamp(v,0.,1.);if(mirror>.5)return 1.-abs(mod(v,2.)-1.);return fract(v);}
vec3 receiverLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 receiverSurfaceColour(int materialId,vec2 uv,vec3 vertexColor,vec3 p,vec3 n,vec3 eye){
  vec4 base=receiverMaterial(materialId,0),flags=receiverMaterial(materialId,1),u=receiverMaterial(materialId,2),v=receiverMaterial(materialId,3),emission=receiverMaterial(materialId,4),mirrored=receiverMaterial(materialId,5);
  vec2 q=vec2(dot(u.xyz,vec3(uv,1)),dot(v.xyz,vec3(uv,1)));q=vec2(receiverWrap(q.x,u.w,mirrored.x),receiverWrap(q.y,v.w,mirrored.y));if(flags.w>.5)q.y=1.-q.y;
  vec3 albedo=textureLod(receiverAlbedo,vec3(q,float(materialId)),0.).rgb;if(flags.z>.5)albedo=receiverLinear(albedo);
  albedo*=base.rgb*mix(vec3(1),vertexColor,flags.y);if(materialId==receiverBedMaterial)albedo*=.62;
  vec3 light=-refract(-uSunDirection,vec3(0,1,0),1./1.333);
  float shadow=surfaceSunVisibility(p+n*.03),nL=max(0.,dot(n,light)),nV=max(.001,dot(n,eye));
  vec3 diffuse=albedo*(1.-flags.x)/3.14159265;
  vec3 h=normalize(eye+light);float nh=max(0.,dot(n,h)),vh=max(0.,dot(eye,h)),alpha=max(.025,base.w*base.w),a2=alpha*alpha,den=nh*nh*(a2-1.)+1.;
  float D=a2/(3.14159265*den*den),k=(base.w+1.)*(base.w+1.)*.125,G=nL/(nL*(1.-k)+k)*nV/(nV*(1.-k)+k);
  vec3 F0=mix(vec3(.04),albedo,flags.x),F=F0+(1.-F0)*pow(1.-vh,5.);
  vec3 specular=D*G*F/max(.001,4.*nL*nV);
  vec3 ambient=mix(vec3(.045,.04,.035),vec3(.12,.14,.17),clamp(n.y*.5+.5,0.,1.));
  float depth=max(0.,-p.y),lightPath=depth/max(.4,light.y);vec3 spectral=exp(-vec3(.105,.021,.012)*lightPath);
  float focus=clamp(refractedIrradiance(p),.08,5.);
  return (diffuse+specular)*uSunColor*nL*shadow*1.05*spectral*focus+albedo*ambient*exp(-vec3(.07,.018,.009)*depth)+emission.rgb*emission.w;
}
`;
