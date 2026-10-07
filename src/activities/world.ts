import * as THREE from 'three';
import type {AdventureState} from '../world/contracts.ts';
import {ActivitySession} from './session.ts';
import {CatchDisplay} from './catch-display.ts';
const Y=new THREE.Vector3(0,1,0);
/** Physical equipment stays in the same rendered world, including when carried. */
export class ActivityWorld{
 readonly group=new THREE.Group();private rod=new THREE.Group();private spareRod=new THREE.Group();private board=new THREE.Group();
 private fish=new THREE.Group();private catchDisplay=new CatchDisplay();
 private bobber:THREE.Mesh;private line:THREE.Line;private poleTip=new THREE.Vector3();private resources:(THREE.BufferGeometry|THREE.Material)[]=[];
 constructor(private session:ActivitySession){
  this.group.name='Fishing and surfing equipment';
  const material=(color:number,metalness=0,roughness=.4)=>{const m=new THREE.MeshStandardMaterial({color,metalness,roughness});this.resources.push(m);return m;};
  const carbon=material(0x202d30,.3,.32),cork=material(0x967753,0,.85),steel=material(0xc7d2d1,.85,.19),white=material(0xebeee6,0,.28),teal=material(0x237c88,.15,.3);
  const mesh=(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D)=>{this.resources.push(g);const v=new THREE.Mesh(g,m);v.castShadow=true;v.receiveShadow=true;parent.add(v);return v;};
  const makeRod=(root:THREE.Group)=>{const shaft=mesh(new THREE.CylinderGeometry(.003,.010,2.05,12),carbon,root);shaft.position.y=1.1;const grip=mesh(new THREE.CylinderGeometry(.018,.020,.32,16),cork,root);grip.position.y=.16;const reel=mesh(new THREE.CylinderGeometry(.048,.048,.056,20),steel,root);reel.rotation.z=Math.PI/2;reel.position.set(-.06,.26,0);for(let i=0;i<5;i++){const guide=mesh(new THREE.TorusGeometry(.015-i*.0018,.0018,6,12),steel,root);guide.position.set(.013,.5+i*.34,0);guide.rotation.x=Math.PI/2;}};
  makeRod(this.rod);makeRod(this.spareRod);this.group.add(this.rod,this.spareRod,this.board);
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];const rings=36,sides=20;
  for(let r=0;r<=rings;r++){const t=r/rings,z=(t-.5)*2.35,shape=Math.pow(Math.max(.003,Math.sin(t*Math.PI)),.58),rocker=.07*Math.pow(Math.abs(2*t-1),3);for(let k=0;k<=sides;k++){const a=k/sides*Math.PI*2;positions.push(Math.cos(a)*.315*shape,Math.sin(a)*.038*shape+rocker,z);uv.push(k/sides,t);if(r<rings&&k<sides){const n=r*(sides+1)+k;indices.push(n,n+sides+1,n+1,n+1,n+sides+1,n+sides+2);}}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();mesh(g,white,this.board);
  const stripe=mesh(new THREE.BoxGeometry(.06,.004,1.65),teal,this.board);stripe.position.y=.041;
  for(const x of [-.16,0,.16]){const fin=mesh(new THREE.BoxGeometry(.014,.13,.23),teal,this.board);fin.position.set(x,-.083,.72);fin.rotation.x=-.25;}
  const leash=mesh(new THREE.TorusGeometry(.14,.009,8,32),carbon,this.board);leash.rotation.x=Math.PI/2;leash.position.set(.38,0,.8);
  this.bobber=mesh(new THREE.SphereGeometry(.018,14,10),material(0xed573d),this.group);this.bobber.scale.y=1.8;
  const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(33*3),3));this.resources.push(lineGeometry);
  const lineMaterial=new THREE.LineBasicMaterial({color:0xd9e9dc,transparent:true,opacity:.65});this.resources.push(lineMaterial);this.line=new THREE.Line(lineGeometry,lineMaterial);this.line.frustumCulled=false;this.group.add(this.line);
  this.fish.add(this.catchDisplay.group);
  this.group.add(this.fish);
 }
 update(s:AdventureState,camera:THREE.Camera,water:(x:number,z:number)=>number,time=0):void{
  const model=this.session,f=model.fishing.snapshot();this.spareRod.position.set(model.pole.x,model.pole.y+.02,model.pole.z);this.spareRod.rotation.set(.18,0,-.16);this.spareRod.visible=model.tool!=='rod'||s.mode==='boat';
  this.rod.visible=model.tool==='rod'||s.mode==='boat';
  if(model.tool==='rod'){
    this.rod.position.set(.22,-.51,-.47).applyMatrix4(camera.matrixWorld);
    const forward=new THREE.Vector3(.05,.31,-1).normalize().applyQuaternion(camera.quaternion);this.rod.quaternion.setFromUnitVectors(Y,forward);
  }else{this.rod.position.set(.92,.6,1.95).applyEuler(new THREE.Euler(s.boatPitch??0,-s.boatYaw,s.boatRoll??0,'YXZ')).add(s.boatPosition);this.rod.quaternion.setFromEuler(new THREE.Euler(.2,-s.boatYaw,.12));}
  this.rod.updateMatrixWorld(true);this.poleTip.set(0,2.125,0).applyMatrix4(this.rod.matrixWorld);
  this.bobber.visible=this.line.visible=model.tool==='rod'&&f.floatPosition!==null;
  if(f.floatPosition){const p=f.floatPosition;this.bobber.position.set(p.x,f.phase==='casting'?p.y:water(p.x,p.z)+(f.phase==='bite'?-.10:.025),p.z);
    if(f.phase==='reeling'){const close=new THREE.Vector3(.13,-.55,-1.4).applyMatrix4(camera.matrixWorld);this.bobber.position.lerp(close,f.progress*.88);}
    // Keep the whole catch visible below the line at normal FPS pitch. The
    // former 14cm float covered the fish, which also hung below the screen.
    if(f.phase==='caught'){
      // Bring a boat catch inside the helm's sight line; the shore distance
      // puts the fish behind the dashboard when viewed from the seated eye.
      this.bobber.position.set(s.mode==='boat'?.32:.05,s.mode==='boat'?-.07:-.18,s.mode==='boat'?-.68:-1.25).applyMatrix4(camera.matrixWorld);
    }
    const attr=this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for(let i=0;i<=32;i++){const t=i/32,point=this.poleTip.clone().lerp(this.bobber.position,t);point.y-=Math.sin(t*Math.PI)*(f.phase==='reeling'?.08:.35);attr.setXYZ(i,point.x,point.y,point.z);}attr.needsUpdate=true;
  }
  this.fish.visible=model.tool==='rod'&&f.phase==='caught'&&!!f.catch;
  if(this.fish.visible&&f.catch){
    this.catchDisplay.set(f.catch.species,f.catch.lengthCm/100,time);
    this.fish.position.copy(this.bobber.position).add(new THREE.Vector3(0,-.025,0).applyQuaternion(camera.quaternion));
    this.fish.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.10,.25,Math.PI/2,'YXZ')));
  }
  if(model.tool==='board'){
    if(model.surf.phase==='carried'){this.board.position.set(.63,-.60,.05).applyMatrix4(camera.matrixWorld);this.board.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI/2)));}
    else {this.board.position.set(s.position.x,water(s.position.x,s.position.z)+.035,s.position.z);this.board.rotation.set(model.surfOutput?.boardPitch??0,-model.surf.yaw,model.surfOutput?.boardRoll??0,'YXZ');}
  }else{this.board.position.set(model.board.x,model.board.y+.12,model.board.z);this.board.rotation.set(0,.45,0);}
 }
 dispose(){this.resources.forEach(r=>r.dispose());this.catchDisplay.dispose();this.group.clear();}
}
