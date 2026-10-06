import * as THREE from 'three';
import {ModelResources,standard,surfaceTexture} from '../world/models/procedural.ts';
import type {AdventureState} from '../world/contracts.ts';
import type {Expedition} from './expedition.ts';

/** Authored game props occupy the same metre-based world as the traveller. */
export class ExpeditionWorld {
 readonly group=new THREE.Group();
 readonly solids=new THREE.Group();
 private readonly resources=new ModelResources();
 private readonly finds=new Map<string,THREE.Group>();
 private readonly buoys: {group:THREE.Group;material:THREE.MeshStandardMaterial;x:number;z:number;gate:number}[]=[];
 private readonly marker:THREE.Mesh;
 private disposed=false;
 private readonly game:Expedition;
 constructor(game:Expedition){
  this.game=game;
  this.group.name='Sea expedition field equipment';this.solids.name='Expedition camp support';this.group.add(this.solids);
  const r=this.resources,paint=standard(r,0xdbb96b,.78),white=standard(r,0xe4e2d0,.84),dark=standard(r,0x253f46,.8),metal=standard(r,0x9ba6a2,.38,.55),glass=standard(r,0x6ba99a,.34);
  paint.map=surfaceTexture(r,'#d1b77b','paint',802);
  const mesh=(parent:THREE.Object3D,geometry:THREE.BufferGeometry,material:THREE.Material,x=0,y=0,z=0)=>{
   const object=new THREE.Mesh(r.geometry(geometry),material);object.position.set(x,y,z);object.castShadow=object.receiveShadow=true;parent.add(object);return object;
  };
  const camp=new THREE.Group();camp.name='Expedition supplies';camp.position.set(game.map.camp.x,game.map.camp.y-.72+.325,game.map.camp.z);this.solids.add(camp);
  mesh(camp,new THREE.BoxGeometry(1.05,.65,.72),dark);
  mesh(camp,new THREE.BoxGeometry(1.1,.08,.77),paint,0,.365,0);
  for(const x of [-.36,.36])mesh(camp,new THREE.BoxGeometry(.055,.65,.738),metal,x,0,0);
  mesh(camp,new THREE.BoxGeometry(.25,.075,.045),white,0,.16,.38);
  for(const f of game.map.finds){
   const g=new THREE.Group();g.name=`Expedition record ${f.id}`;g.userData.worldSolid=false;g.position.set(f.x,f.groundY,f.z);g.rotation.y=f.x*.13;this.group.add(g);this.finds.set(f.id,g);
   if(f.kind==='note'){
    mesh(g,new THREE.BoxGeometry(.36,.08,.27),dark);
    mesh(g,new THREE.BoxGeometry(.33,.016,.245),white,0,.05,0);
    for(let i=0;i<3;i++)mesh(g,new THREE.BoxGeometry(.19,.006,.009),paint,0,.061,-.06+i*.035);
   }else if(f.kind==='glass'){
    const piece=mesh(g,new THREE.IcosahedronGeometry(.19,1),glass);piece.scale.set(1,.45,.8);piece.rotation.z=.2;
   }else if(f.kind==='case'){
    mesh(g,new THREE.BoxGeometry(.43,.25,.30),paint);mesh(g,new THREE.BoxGeometry(.45,.035,.32),dark,0,.135,0);
    mesh(g,new THREE.CylinderGeometry(.065,.065,.034,12),metal,0,.168,0);
    for(const x of [-.15,.15])mesh(g,new THREE.BoxGeometry(.045,.27,.32),dark,x,0,0);
   }else{
    mesh(g,new THREE.CylinderGeometry(.11,.11,.5,12),white);
    mesh(g,new THREE.CylinderGeometry(.125,.125,.08,12),paint,0,.23,0);
    mesh(g,new THREE.CylinderGeometry(.12,.12,.05,12),dark,0,-.23,0);
   }
   // Rest the actual rotated shape on the sampled floor, rather than floating at the interaction anchor.
   g.updateMatrixWorld(true);g.position.y+=f.groundY-new THREE.Box3().setFromObject(g).min.y;
  }
  game.map.course.slice(0,-1).forEach((p,gate)=>{
   const next=game.map.course[gate+1],dx=next.x-p.x,dz=next.z-p.z,len=Math.hypot(dx,dz);
   for(const side of [-1,1]){
    const g=new THREE.Group(),m=standard(r,gate===0?0xe3bb62:0xd8dfd9,.64);
    const x=p.x+side*dz/len*4.8,z=p.z-side*dx/len*4.8;g.position.set(x,.25,z);g.name=`Course marker ${gate+1}`;g.userData.worldSolid=false;this.group.add(g);
    mesh(g,new THREE.SphereGeometry(.29,12,8),m).scale.set(1,1.25,1);
    mesh(g,new THREE.CylinderGeometry(.027,.037,1.15,6),dark,0,.72,0);
    mesh(g,new THREE.BoxGeometry(.38,.23,.014),paint,.17,1.20,0);
    this.buoys.push({group:g,material:m,x,z,gate});
   }
  });
  this.marker=mesh(this.group,new THREE.TorusGeometry(.28,.025,6,24),standard(r,0xe9d19b,.5));this.marker.name='Active discovery indicator';this.marker.userData.worldSolid=false;this.marker.castShadow=false;
  this.group.updateMatrixWorld(true);
 }
 update(time:number,state:AdventureState,water:(x:number,z:number)=>number):void {
  for(const [id,group] of this.finds)group.visible=!this.game.found(id);
  for(const buoy of this.buoys){buoy.group.visible=this.game.notebook;buoy.group.position.y=water(buoy.x,buoy.z)+.15;buoy.group.rotation.z=Math.sin(time*1.3+buoy.x)*.05;
   const active=this.game.race&&(this.game.race.next%5)===buoy.gate;buoy.material.color.setHex(active?0xeaba4d:0xd8dfd9);}
  const target=this.game.target(state);this.marker.visible=!!target&&(target.kind==='find'||target.kind==='camp')&&Math.hypot(target.x-state.position.x,target.z-state.position.z)<45;
  if(target){this.marker.position.set(target.x,target.y+.6,target.z);this.marker.rotation.set(Math.PI/2,0,time*.35);}
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.group.clear();this.resources.dispose();}
}
