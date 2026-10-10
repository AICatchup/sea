import * as THREE from 'three';
import {MeshoptSimplifier} from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

/** A reduced index over the source's own vertices; attributes are shared, never copied. */
export interface ScanLevel {geometry:THREE.BufferGeometry;triangles:number;error:number}

function positions(geometry:THREE.BufferGeometry):Float32Array{
  const p=geometry.getAttribute('position');
  if(p instanceof THREE.BufferAttribute&&p.array instanceof Float32Array&&p.itemSize===3)return p.array;
  const out=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){out[i*3]=p.getX(i);out[i*3+1]=p.getY(i);out[i*3+2]=p.getZ(i);}return out;
}

/** meshoptimizer reductions to the given triangle ratios. Vertices that share a position but
 * differ in UV/normal are seams the simplifier keeps, so photo charts do not tear. */
export async function simplifiedScanLevels(source:THREE.BufferGeometry,ratios:readonly number[]):Promise<ScanLevel[]>{
  await MeshoptSimplifier.ready;
  const index=source.index;if(!index)throw new Error('Indexed scan geometry required');
  const indices=Uint32Array.from(index.array as ArrayLike<number>),points=positions(source),levels:ScanLevel[]=[];
  for(const ratio of ratios){
    const target=Math.max(3,Math.floor(indices.length*ratio/3)*3);
    // Unbounded error: the ratio alone sets the budget; the error is reported for selection.
    let [reduced,error]=MeshoptSimplifier.simplify(indices.slice(),points,3,target,1),method='simplify';
    // Scans with split per-triangle vertices cannot collapse edges at all; cluster instead.
    if(reduced.length>target*2){[reduced,error]=MeshoptSimplifier.simplifySloppy(indices.slice(),points,3,null,target,1);method='sloppy';}
    const geometry=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
    geometry.setIndex(new THREE.BufferAttribute(reduced,1));
    geometry.boundingBox=source.boundingBox?.clone()??null;geometry.boundingSphere=source.boundingSphere?.clone()??null;
    geometry.userData={derivation:`meshoptimizer ${method} (three bundled), shared source attributes`,ratio,relativeError:error};
    levels.push({geometry,triangles:reduced.length/3,error});
  }
  return levels;
}

/** Per-instance distance LOD for static scanned outcrops. The source InstancedMesh stays the
 * physical collider (hidden, unchanged); only these render-only batches change per view. */
export class InstancedScanLod {
  readonly group=new THREE.Group();
  private readonly batches:THREE.InstancedMesh[];
  private readonly matrices:THREE.Matrix4[]=[];
  private readonly centres:THREE.Vector3[]=[];
  private readonly radii:number[]=[];
  private readonly levelOf:Int8Array;
  private readonly last=new THREE.Vector3(Infinity,Infinity,Infinity);
  private lastScale=0;
  private readonly pixels:readonly number[];
  diagnostics={instances:[0],triangles:0,updates:0};

  /** `pixels[i]`: an instance at least this many drawing-buffer pixels across uses level i. */
  constructor(source:THREE.InstancedMesh,levels:readonly ScanLevel[],pixels:readonly number[]){
    this.pixels=pixels;
    const all=[{geometry:source.geometry,triangles:(source.geometry.index?.count??0)/3},...levels];
    if(pixels.length!==levels.length)throw new Error('One pixel threshold per reduced level');
    if(!source.geometry.boundingSphere)source.geometry.computeBoundingSphere();
    const local=source.geometry.boundingSphere!,matrix=new THREE.Matrix4();
    for(let i=0;i<source.count;i++){
      source.getMatrixAt(i,matrix);const world=matrix.clone().premultiply(source.matrixWorld);
      this.matrices.push(world);this.centres.push(local.center.clone().applyMatrix4(world));this.radii.push(local.radius*world.getMaxScaleOnAxis());
    }
    this.levelOf=new Int8Array(source.count).fill(-1);
    this.batches=all.map((level,i)=>{
      const mesh=new THREE.InstancedMesh(level.geometry,source.material,source.count);
      mesh.name=`${source.name} LOD${i}`;mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
      // Render only: the hidden source keeps collisions and probes on native geometry.
      mesh.userData.worldSolid=false;mesh.userData.scanLod=i;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;
      this.group.add(mesh);return mesh;
    });
    this.diagnostics.instances=all.map(()=>0);
    this.group.name=`${source.name} distance LOD`;
  }

  /** `pixelsPerMetre`: drawing-buffer pixels per metre at 1m (height / (2 tan(fov/2))). */
  update(eye:THREE.Vector3,pixelsPerMetre:number):void{
    if(this.last.distanceToSquared(eye)<4&&Math.abs(pixelsPerMetre-this.lastScale)<1)return;
    this.last.copy(eye);this.lastScale=pixelsPerMetre;
    let changed=false;
    for(let i=0;i<this.matrices.length;i++){
      const size=2*this.radii[i]*pixelsPerMetre/Math.max(.1,this.centres[i].distanceTo(eye)-this.radii[i]),current=this.levelOf[i];
      let level=this.pixels.length;
      for(let l=0;l<this.pixels.length;l++){
        // 15% hysteresis: a finer level must be clearly needed before switching back.
        const threshold=this.pixels[l]*(current>=0&&current<=l?.85:1);
        if(size>=threshold){level=l;break;}
      }
      if(level!==current){this.levelOf[i]=level;changed=true;}
    }
    if(!changed)return;
    const counts=this.batches.map(()=>0);
    for(let i=0;i<this.matrices.length;i++){const level=this.levelOf[i];this.batches[level].setMatrixAt(counts[level]++,this.matrices[i]);}
    let triangles=0;
    this.batches.forEach((mesh,level)=>{mesh.count=counts[level];mesh.visible=counts[level]>0;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();triangles+=counts[level]*((mesh.geometry.index?.count??0)/3);});
    this.diagnostics={instances:counts,triangles,updates:this.diagnostics.updates+1};
  }

  /** Reduced geometries share the source attributes, so only their indices are released. */
  dispose():void{
    this.batches.forEach((mesh,level)=>{if(level>0){mesh.geometry.attributes={};mesh.geometry.dispose();}mesh.dispose();});
    this.group.clear();
  }
}
