import * as THREE from 'three';
import type { AssetWorld } from './assets.ts';
import { WorldCollision } from './world-collision.ts';

const CLIFF_NAME = 'Tomari jointed rhyolite ledges and fissures';
const FIXTURE_NAME = 'authored beach adventure fixtures';
const excludedName = /\b(?:buoy|boat|motorboat|water|waves?|dem|bathymetry|grass|leaves|leaf|needles|pine|foliage|shrubs?|sprays|fish|marine)\b/i;
interface Binding { signature: string; id: number; triangles: number; kind: 'mesh' | 'instance' | 'trunk'; }
export interface WorldSolidBindingStats {
  colliders: number; meshes: number; instances: number; trunks: number; triangles: number;
  added: number; replaced: number; removed: number; unchanged: number; syncMs: number;
}
const emptyStats = (): WorldSolidBindingStats => ({ colliders:0, meshes:0, instances:0, trunks:0, triangles:0,
  added:0, replaced:0, removed:0, unchanged:0, syncMs:0 });
function geometrySignature(geometry: THREE.BufferGeometry): string {
  const positions=geometry.getAttribute('position'),index=geometry.index;
  // Render geometry revisions must set needsUpdate, as required by Three itself.
  const version=positions && 'version' in positions ? positions.version : positions && 'data' in positions ? positions.data.version : 0;
  return `${geometry.uuid}:${positions?.count}:${version}:${index?.count}:${index?.version}:${geometry.drawRange.start}:${geometry.drawRange.count}`;
}
function excluded(object: THREE.Object3D, root: THREE.Group): boolean {
  for(let current:THREE.Object3D|null=object;current && current!==root.parent;current=current.parent) {
    if(current.userData.worldSolid===false || current.userData.foliageLod || excludedName.test(current.name)) return true;
  }
  return false;
}
function beneath(object: THREE.Object3D, root: THREE.Group, name: string): boolean {
  for(let current:THREE.Object3D|null=object;current && current!==root.parent;current=current.parent) if(current.name===name) return true;
  return false;
}

/**
 * Binds only authored static solid surfaces to the collision registry. Render
 * geometry/material and instance buffers remain borrowed. Call after ready and
 * place/undo (or after another known geometry/instance revision), not each frame.
 * The DEM remains the height sampler, pines use stable trunk proxies, and the
 * controller keeps exclusive ownership of the boat's collision and movement.
 */
export class WorldSolidBinding {
  private readonly collision: WorldCollision;
  private readonly bindings=new Map<string,Binding>();
  private statistics=emptyStats();
  private disposed=false;
  constructor(collision:WorldCollision) { this.collision=collision; }
  get stats(): WorldSolidBindingStats { return {...this.statistics}; }

  sync(world:THREE.Group,assets:AssetWorld,scanned:THREE.Group,extras:THREE.Group[]=[]):WorldSolidBindingStats {
    if(this.disposed) return this.stats;
    const started=performance.now(),statistics=emptyStats(),seen=new Set<string>();
    const register=(key:string,signature:string,kind:Binding['kind'],create:()=>number):void=> {
      seen.add(key);const previous=this.bindings.get(key);
      if(previous?.signature===signature) {statistics.unchanged++;return;}
      // Create before releasing the old collider so failed mesh validation leaves
      // the last known physical surface intact. IDs are private to this binding.
      const before=this.collision.stats.triangles,id=create(),triangles=this.collision.stats.triangles-before;
      if(previous) {this.collision.remove(previous.id);statistics.replaced++;} else statistics.added++;
      this.bindings.set(key,{signature,id,triangles,kind});
    };
    const mesh=(source:THREE.Mesh):void=> {
      const geometry=geometrySignature(source.geometry);
      if(source instanceof THREE.InstancedMesh) {
        const local=new THREE.Matrix4(),matrix=new THREE.Matrix4();
        const capacity=source.instanceMatrix.count,count=Math.max(0,Math.min(capacity,Math.floor(source.count)));
        for(let i=0;i<count;i++) {
          source.getMatrixAt(i,local);matrix.multiplyMatrices(source.matrixWorld,local);
          const signature=`${geometry}:${matrix.elements.join(',')}`;
          register(`mesh:${source.uuid}:${i}`,signature,'instance',()=>this.collision.addMesh(source,matrix));
        }
      } else register(`mesh:${source.uuid}`,`${geometry}:${source.matrixWorld.elements.join(',')}`,'mesh',()=>this.collision.addMesh(source,source.matrixWorld));
    };
    const visit=(root:THREE.Group,accept:(source:THREE.Mesh)=>boolean):void=> {
      root.updateWorldMatrix(true,true);
      root.traverse(object=> {if(object instanceof THREE.Mesh && !excluded(object,root) && accept(object)) mesh(object);});
    };
    visit(world,source=>beneath(source,world,CLIFF_NAME));
    visit(scanned,()=>true);
    visit(assets.group,source=>beneath(source,assets.group,FIXTURE_NAME)
      || /^placed (?:chair|tank|umbrella|rock|scanned )/.test(source.name));
    for(const root of extras) visit(root,()=>true);

    // LOD replacements and camera selection do not change physical tree roots.
    assets.group.updateWorldMatrix(true,false);
    const matrix=assets.group.matrixWorld,e=matrix.elements;
    const radialScale=Math.max(Math.hypot(e[0],e[1],e[2]),Math.hypot(e[8],e[9],e[10]));
    const verticalScale=Math.hypot(e[4],e[5],e[6]);
    for(const trunk of assets.getTrunkProxies()) {
      const centre=new THREE.Vector3(trunk.x,trunk.y,trunk.z).applyMatrix4(matrix);
      const radius=trunk.radius*radialScale,height=trunk.height*verticalScale;
      const key=`trunk:${trunk.x},${trunk.y},${trunk.z},${trunk.radius},${trunk.height}`;
      const signature=`${centre.x},${centre.y},${centre.z},${radius},${height}`;
      register(key,signature,'trunk',()=>this.collision.addCylinder(centre,radius,height));
    }
    for(const [key,binding] of this.bindings) if(!seen.has(key)) {
      this.collision.remove(binding.id);this.bindings.delete(key);statistics.removed++;
    }
    for(const binding of this.bindings.values()) {
      statistics.colliders++;statistics.triangles+=binding.triangles;
      if(binding.kind==='mesh') statistics.meshes++;
      else if(binding.kind==='instance') statistics.instances++;else statistics.trunks++;
    }
    statistics.syncMs=performance.now()-started;this.statistics=statistics;return this.stats;
  }
  dispose():void {
    if(this.disposed) return;
    this.disposed=true;
    for(const binding of this.bindings.values()) this.collision.remove(binding.id);
    this.bindings.clear();this.statistics=emptyStats();
  }
}
