import * as THREE from 'three';
import type {Ocean} from '../ocean/renderer.ts';

/** Same lit asset-camera layout for cloth comparison. No travel/player mutation. */
export function inspectBoatCloth(ocean:Ocean){
 const renderer=ocean.renderer;
 const saved={target:renderer.getRenderTarget(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,space:renderer.outputColorSpace,viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),autoClear:renderer.autoClear};
 const vessel=ocean.assets.boat.clone(true),materials=new Map<THREE.Material,THREE.Material>();
 vessel.position.set(0,0,0);vessel.quaternion.identity();vessel.scale.set(1,1,1);
 vessel.traverse(o=>{if(o instanceof THREE.Mesh){const copy=(m:THREE.Material)=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m)!;};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);o.frustumCulled=false;}});
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x687d8a);scene.environment=ocean.scene.environment;scene.environmentIntensity=.7;scene.add(vessel,new THREE.HemisphereLight(0xe3f0ff,0x645342,1.1));
 const key=new THREE.DirectionalLight(0xfff3e0,3.2);key.position.set(-3,5,-4);scene.add(key,key.target);
 const fill=new THREE.DirectionalLight(0xbcd9ff,1.3);fill.position.set(4,2,3);scene.add(fill,fill.target);
 const size=1024,target=new THREE.WebGLRenderTarget(size,size);target.texture.colorSpace=THREE.SRGBColorSpace;
 const camera=new THREE.PerspectiveCamera(36,1,.005,30),canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d')!,pixels=new Uint8Array(size*size*4);
 const poses=[{name:'bow-seat',eye:[0,.95,-2.80],target:[0,.36,-1.77]},{name:'aft-bench',eye:[0,1.22,1.25],target:[0,.73,2.18]},{name:'helm-backrest',eye:[1.13,1.16,.40],target:[.48,.86,1.11]}];
 const images:{name:string;camera:number[];target:number[];png:string}[]=[];
 try{
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.autoClear=true;renderer.setRenderTarget(target);renderer.setScissorTest(false);
  for(const pose of poses){camera.position.fromArray(pose.eye);camera.lookAt(new THREE.Vector3().fromArray(pose.target));camera.updateMatrixWorld(true);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);const data=ctx.createImageData(size,size);for(let y=0;y<size;y++)data.data.set(pixels.subarray((size-1-y)*size*4,(size-y)*size*4),y*size*4);ctx.putImageData(data,0,0);images.push({name:pose.name,camera:pose.eye,target:pose.target,png:canvas.toDataURL('image/png')});}
  const cloth=[...materials.keys()].find(m=>m.userData.physicalBoatCloth===true) as THREE.MeshStandardMaterial|undefined;
  return {evidence:'Isolated asset inspection under a fixed common HDR/key/fill; visual-only, no gameplay or site-match proof',size:[size,size],cloth:ocean.assets.boat.userData.boatCloth,physical:!!cloth,maps:cloth?[cloth.map,cloth.normalMap,cloth.roughnessMap].map(t=>{const image=t?.image as {width?:number;height?:number}|undefined;return {name:t?.name,width:image?.width,height:image?.height,repeat:t?.repeat.toArray(),colorSpace:t?.colorSpace};}):null,images};
 }finally{renderer.setRenderTarget(saved.target);renderer.setClearColor(saved.color,saved.alpha);renderer.toneMapping=saved.tone;renderer.toneMappingExposure=saved.exposure;renderer.outputColorSpace=saved.space;renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);renderer.autoClear=saved.autoClear;target.dispose();materials.forEach(m=>m.dispose());}
}
