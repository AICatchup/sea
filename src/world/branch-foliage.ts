import * as THREE from 'three';
import type {FoliageVariant} from './foliage.ts';
import type {ModelResources} from './models/procedural.ts';
import {randomSeed} from './models/procedural.ts';

interface Cluster {position:THREE.Vector3;size:number;yaw:number;tilt:number;tile:number;shade:number;}

/** Small bent branch patches occupy the source crown volume; they never turn towards the camera. */
export function branchClusters(source:FoliageVariant,kind:'pine'|'shrub',seed:number):Cluster[]{
 const step=kind==='pine'?.58:.24,cells=new Map<string,{sum:THREE.Vector3;area:number}>();
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3();
 for(const part of source.parts){
  if(part.material.userData.foliageRole!=='leaves')continue;
  const p=part.geometry.getAttribute('position'),index=part.geometry.index;
  for(let i=0;i<(index?.count??p.count);i+=3){
   a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
   const area=cross.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length()*.5;
   if(area<1e-10)continue;
   const center=a.clone().add(b).add(c).multiplyScalar(1/3),key=`${Math.floor(center.x/step)}:${Math.floor(center.y/step)}:${Math.floor(center.z/step)}`;
   const cell=cells.get(key)??{sum:new THREE.Vector3(),area:0};cell.sum.addScaledVector(center,area);cell.area+=area;cells.set(key,cell);
  }
 }
 const random=randomSeed(seed),limit=kind==='pine'?42:12;
 const candidates=[...cells.values()].map(cell=>({position:cell.sum.multiplyScalar(1/cell.area),priority:random()*Math.pow(cell.area,.15)})).sort((a,b)=>b.priority-a.priority).slice(0,limit);
 return candidates.map(({position})=>({position,size:(kind==='pine'?.92:.36)*(.82+random()*.38),yaw:random()*Math.PI*2,tilt:.5+random()*.6,tile:Math.floor(random()*2)+(kind==='pine'?0:2),shade:.86+random()*.20}));
}

export function branchGeometry(clusters:readonly Cluster[],segments:number):THREE.BufferGeometry{
 if(!Number.isInteger(segments)||segments<1||segments>3)throw new Error('Branch patch segments must be 1..3');
 const positions:number[]=[],uvs:number[]=[],colours:number[]=[],indices:number[]=[];
 const u=new THREE.Vector3(),v=new THREE.Vector3(),normal=new THREE.Vector3(),p=new THREE.Vector3();
 for(const cluster of clusters)for(let face=0;face<2;face++){
  const angle=cluster.yaw+face*Math.PI*.5,tilt=face?cluster.tilt:Math.PI*.5-cluster.tilt*.65;
  u.set(Math.cos(angle),0,Math.sin(angle));v.set(-Math.sin(angle)*Math.sin(tilt),Math.cos(tilt),Math.cos(angle)*Math.sin(tilt));normal.crossVectors(u,v);
  const start=positions.length/3,column=cluster.tile%2,row=Math.floor(cluster.tile/2);
  for(let y=0;y<=segments;y++)for(let x=0;x<=segments;x++){
   const fx=x/segments,fy=y/segments,cu=(fx-.5)*cluster.size,cv=(fy-.5)*cluster.size;
   const bend=(1-(fx*2-1)**2)*(1-(fy*2-1)**2)*cluster.size*.12*(face?-1:1);
   p.copy(cluster.position).addScaledVector(u,cu).addScaledVector(v,cv).addScaledVector(normal,bend);positions.push(p.x,p.y,p.z);
   uvs.push(column*.5+.008+fx*.484,(1-row)*.5+.008+fy*.484);
   colours.push(cluster.shade*.96,cluster.shade,cluster.shade*.94);
  }
  for(let y=0;y<segments;y++)for(let x=0;x<segments;x++){
   const a=start+y*(segments+1)+x,b=a+1,c=a+segments+1,d=c+1;indices.push(a,b,c,b,d,c);
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 geometry.userData={clusterCount:clusters.length,segments,source:'Authored branch atlas arranged in CC0 source crown cells',cameraFacing:false};return geometry;
}

export function branchCanopyLevels(source:FoliageVariant,wood:{near:FoliageVariant;mid:FoliageVariant;far:FoliageVariant},material:THREE.MeshStandardMaterial,resources:ModelResources,kind:'pine'|'shrub',seed:number){
 const clusters=branchClusters(source,kind,seed);
 return (['near','mid','far'] as const).map((level,index)=>{
  if(level==='near')return wood.near;
  const geometry=resources.geometry(branchGeometry(clusters,3-index));
  const retained=wood[level].parts;
  const parts=[...retained,{geometry,material}];
  return {parts,triangles:parts.reduce((n,p)=>n+(p.geometry.index?.count??p.geometry.getAttribute('position').count)/3,0)};
 });
}
