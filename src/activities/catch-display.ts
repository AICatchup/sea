import * as THREE from 'three';
import {ModelResources} from '../world/models/procedural.ts';
import {fishGeometry,fishMaterial,finGeometry,finMaterial,tailGeometry,fishEyes} from '../world/models/marine.ts';

/** Shares the world's authored fish anatomy and PBR detail. These are species-
 * inspired models, not species-specific scans. Mouth at origin, tail at -X. */
export class CatchDisplay{
  readonly group=new THREE.Group();
  private readonly resources=new ModelResources();
  private readonly time={value:0};
  private readonly models:THREE.Group[]=[];
  constructor(){
    const eyes=fishEyes(this.resources),eyeMaterial=this.resources.material(new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.19,clearcoat:.6,clearcoatRoughness:.12}));
    for(const species of [1,2,2]){
      const model=new THREE.Group(),bodyMaterial=fishMaterial(this.resources,species),membrane=finMaterial(this.resources,this.time);
      if(species===1)bodyMaterial.color.setRGB(.90,.83,.70);
      const add=(geometry:THREE.BufferGeometry,material:THREE.Material)=>{const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;model.add(mesh);return mesh;};
      add(fishGeometry(this.resources,species),bodyMaterial);
      add(finGeometry(this.resources,species),membrane);
      add(tailGeometry(this.resources,species),membrane).position.x=-.445;
      add(eyes,eyeMaterial);
      model.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(model),length=bounds.max.x-bounds.min.x;
      model.scale.setScalar(1/length);model.position.x=-bounds.max.x/length;
      model.visible=false;this.models.push(model);this.group.add(model);
    }
  }
  set(species:string,lengthMetres:number,time:number){
    const selected=species==='メバル'?0:species==='サバ'?1:2;
    this.models.forEach((model,i)=>{model.visible=i===selected;});
    this.group.scale.setScalar(Math.max(.01,Math.min(2,lengthMetres)));
    this.time.value=time;
  }
  dispose(){this.resources.dispose();this.group.clear();this.models.length=0;}
}
