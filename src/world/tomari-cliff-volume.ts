import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {makeCliffMaterial} from './coast-material.ts';

const url=new URL('../assets/coast/tomari-west-volume-v32.glb',import.meta.url).href;
/** Closed inferred western cliff relief. The original DEM remains authoritative. */
export class TomariCliffVolume {
  readonly group=new THREE.Group();
  readonly ready:Promise<void>;
  private readonly material:THREE.MeshStandardMaterial;
  private readonly geometries:THREE.BufferGeometry[]=[];
  private disposed=false;
  constructor(terrain:THREE.MeshStandardMaterial){
    this.group.name='Tomari western joined scan crags';
    this.group.userData.cliffVolume={status:'loading',source:'CC0 scan geometry / inferred placement',triangles:0};
    this.material=makeCliffMaterial(terrain);this.material.vertexColors=false;
    this.material.name='Tomari scan volume / shared world rock PBR';
    if(typeof document==='undefined'){this.group.userData.cliffVolume.status='cpu-only';this.ready=Promise.resolve();}
    else this.ready=this.load().catch(error=>{this.group.userData.cliffVolume.status='fallback';console.warn('Cliff relief unavailable; original terrain retained',error);});
  }
  private async load():Promise<void>{
    const response=await fetch(url);if(!response.ok)throw new Error(`Cliff volume ${response.status}`);
    const gltf=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
    gltf.scene.updateMatrixWorld(true);
    const importedMaterials=new Set<THREE.Material>();
    gltf.scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      (Array.isArray(object.material)?object.material:[object.material]).forEach(m=>importedMaterials.add(m));
      if(this.disposed){object.geometry.dispose();return;}
      const geometry=object.geometry;geometry.applyMatrix4(object.matrixWorld);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      this.geometries.push(geometry);const mesh=new THREE.Mesh(geometry,this.material);
      mesh.name='Tomari closed western crag';mesh.castShadow=mesh.receiveShadow=true;
      mesh.userData.recon_part='west-crag-volume';this.group.add(mesh);
      this.group.userData.cliffVolume.triangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;
    });
    importedMaterials.forEach(m=>m.dispose());
    if(!this.disposed)this.group.userData.cliffVolume.status='ready';
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.geometries.forEach(g=>g.dispose());this.geometries.length=0;this.material.dispose();this.group.clear();}
}
