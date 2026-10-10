import * as THREE from 'three';
import type {Reflector} from 'three/addons/objects/Reflector.js';

// Only a known position-preserving hook may acquire this certificate. Changing
// the hook afterwards invalidates it; seaPrepared alone is not such a promise.
const earthOnlyHooks=new WeakMap<THREE.Material,THREE.Material['onBeforeCompile']>();
export function certifyEarthOnlyMaterial(material:THREE.Material):void{
  earthOnlyHooks.set(material,material.onBeforeCompile);
}
const EARTH_DIAMETER=2*6371000;
const CLIP_MARGIN=.05;

/** Expand downward to include the exact world-materials vertex curvature. */
export function includeEarthCurvature(box:THREE.Box3,camera:THREE.Vector3):void{
  const dx=Math.max(Math.abs(box.min.x-camera.x),Math.abs(box.max.x-camera.x));
  const dz=Math.max(Math.abs(box.min.z-camera.z),Math.abs(box.max.z-camera.z));
  box.min.y-=(dx*dx+dz*dz)/EARTH_DIAMETER;
}

/** Maximum signed box distance to the REAL biased clip plane, not y=0. */
export function beyondReflectionClip(box:THREE.Box3,plane:THREE.Plane):boolean{
  const n=plane.normal;
  const max=n.x*(n.x>=0?box.max.x:box.min.x)+n.y*(n.y>=0?box.max.y:box.min.y)
    +n.z*(n.z>=0?box.max.z:box.min.z)+plane.constant;
  return Number.isFinite(max)&&max < -CLIP_MARGIN;
}

type GeometryStamp={position:THREE.BufferAttribute|THREE.InterleavedBufferAttribute;version:number};
type InstanceStamp={geometry:THREE.BufferGeometry;position:GeometryStamp['position'];positionVersion:number;matrix:THREE.InstancedBufferAttribute;version:number;count:number};

/** Skip only proven invisible geometry inside one Reflector render. No LOD,
 * material, update cadence, resolution, shadow or main-pass changes. */
export class ReflectionCull {
  enabled=true;
  hiddenCount=0;
  private readonly hidden:THREE.Mesh[]=[];
  private readonly box=new THREE.Box3();
  private readonly projectionView=new THREE.Matrix4();
  private readonly plane=new THREE.Plane();
  private readonly cameraPosition=new THREE.Vector3();
  private readonly geometryStamps=new WeakMap<THREE.BufferGeometry,GeometryStamp>();
  private readonly instanceStamps=new WeakMap<THREE.InstancedMesh,InstanceStamp>();
  private active=false;
  private expectedCamera:THREE.Camera|null=null;
  private previousHook:THREE.Scene['onBeforeRender']|null=null;

  private readonly before:THREE.Scene['onBeforeRender']=(renderer,scene,camera,...remaining)=>{
    this.previousHook?.call(scene,renderer,scene,camera,...remaining);
    // Reflector disables autoUpdate, but needsUpdate would still render shadows
    // from hidden casters. Preserve that entire legacy shadow-update frame.
    if(!this.enabled||camera!==this.expectedCamera||renderer.shadowMap.needsUpdate)return;
    this.projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const e=this.projectionView.elements;
    this.plane.setComponents(e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14]).normalize();
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    // WebGLRenderer has updated world matrices before this callback, and the
    // Reflector has finalized its oblique projection including clipBias.
    scene.traverseVisible(this.inspect);
    for(const mesh of this.hidden)mesh.visible=false;
    this.hiddenCount=this.hidden.length;
  };

  private readonly inspect=(object:THREE.Object3D):void=>{
    const mesh=object as THREE.Mesh;
    if(!mesh.isMesh||mesh.children.length||(mesh as THREE.SkinnedMesh).isSkinnedMesh
      ||(mesh as THREE.BatchedMesh).isBatchedMesh||mesh.onBeforeRender!==THREE.Mesh.prototype.onBeforeRender)return;
    const geometry=mesh.geometry,position=geometry.getAttribute('position');
    if(!position)return;
    for(const attribute in geometry.morphAttributes)if(geometry.morphAttributes[attribute as keyof typeof geometry.morphAttributes]?.length)return;
    const material=mesh.material;
    let earth=false;
    if(Array.isArray(material)){
      for(const part of material){const mode=this.materialMode(part);if(mode<0)return;earth ||= mode===1;}
    }else{const mode=this.materialMode(material);if(mode<0)return;earth=mode===1;}
    const version=position instanceof THREE.InterleavedBufferAttribute?position.data.version:position.version;
    let stamp=this.geometryStamps.get(geometry);
    if(!stamp||stamp.position!==position||stamp.version!==version||!geometry.boundingBox){
      geometry.computeBoundingBox();
      if(stamp){stamp.position=position;stamp.version=version;}
      else{stamp={position,version};this.geometryStamps.set(geometry,stamp);}
    }
    const instanced=mesh as THREE.InstancedMesh;
    if(instanced.isInstancedMesh){
      if(instanced.count===0)return;
      const matrix=instanced.instanceMatrix;let cached=this.instanceStamps.get(instanced);
      if(!cached||cached.geometry!==geometry||cached.position!==position||cached.positionVersion!==version
        ||cached.matrix!==matrix||cached.version!==matrix.version||cached.count!==instanced.count||!instanced.boundingBox){
        instanced.computeBoundingBox();
        if(cached){cached.geometry=geometry;cached.position=position;cached.positionVersion=version;cached.matrix=matrix;cached.version=matrix.version;cached.count=instanced.count;}
        else{cached={geometry,position,positionVersion:version,matrix,version:matrix.version,count:instanced.count};this.instanceStamps.set(instanced,cached);}
      }
    }
    const bounds=instanced.isInstancedMesh?instanced.boundingBox:geometry.boundingBox;
    if(!bounds||bounds.isEmpty())return;
    this.box.copy(bounds).applyMatrix4(mesh.matrixWorld);
    if(earth)includeEarthCurvature(this.box,this.cameraPosition);
    if(beyondReflectionClip(this.box,this.plane))this.hidden.push(mesh);
  };

  private materialMode(material:THREE.Material):number{
    if((material as THREE.ShaderMaterial).isShaderMaterial||(material as THREE.MeshStandardMaterial).displacementMap
      ||material.onBeforeRender!==THREE.Material.prototype.onBeforeRender)return -1;
    if(earthOnlyHooks.get(material)===material.onBeforeCompile)return 1;
    return material.onBeforeCompile===THREE.Material.prototype.onBeforeCompile?0:-1;
  }

  render(reflector:Reflector,renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera,context:THREE.Group):void{
    if(this.active)throw new Error('ReflectionCull cannot nest renders');
    this.active=true;this.hiddenCount=0;this.expectedCamera=reflector.getReflectionCamera(camera);
    this.previousHook=scene.onBeforeRender;scene.onBeforeRender=this.before;
    try{reflector.onBeforeRender(renderer,scene,camera,reflector.geometry,reflector.material as THREE.Material,context);}
    finally{
      // Only initially visible meshes entered the list. Do not touch meshes
      // that were hidden before the pass, and release references every pass.
      for(const mesh of this.hidden)mesh.visible=true;
      this.hidden.length=0;scene.onBeforeRender=this.previousHook;
      this.previousHook=null;this.expectedCamera=null;this.active=false;
    }
  }
}
