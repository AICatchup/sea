import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { NiijimaDEM, noise, ease } from './niijima-detail.ts';

export interface ScarpVolumeSource { heightAt(x:number,z:number):number; shoreAt(x:number,z:number):number; }
/** Authored closed rock volume; elevations remain unmodified. Dimensions are hypotheses. */
export class NiijimaScarpVolume {
  readonly group = new THREE.Group();
  readonly geometry = new THREE.BufferGeometry();
  readonly bounds: THREE.Box3;
  readonly diagnostics: { triangles:number; vertices:number; sections:number; minimumToeShore:number; maximumHeight:number };
  private readonly material:THREE.MeshStandardMaterial;
  constructor(ground:GroundSampler, source:ScarpVolumeSource = new NiijimaDEM(), material?:THREE.MeshStandardMaterial) {
    this.group.name='Niijima connected pumice scarp volume';
    this.group.userData.worldSolid=true;
    this.material=material?.clone() ?? new THREE.MeshStandardMaterial({color:0xe1ddce,roughness:.98});
    this.material.vertexColors=true;
    this.material.side=THREE.FrontSide;
    const positions:number[]=[], colors:number[]=[], indices:number[]=[];
    const sections=181, faceSteps=64, roofSteps=12, ring=faceSteps+roofSteps+3;
    let minimumToeShore=Infinity, maximumHeight=-Infinity;
    const put=(x:number,y:number,z:number,shade:number)=> {
      positions.push(x,y,z); colors.push(shade,shade*.985,shade*.95);
      maximumHeight=Math.max(maximumHeight,y);
    };
    for(let i=0;i<sections;i++) {
      const z=-1150+i*260/(sections-1);
      let coastX=5890;
      // Alongshore stations follow the real distance field, never camera orientation.
      for(let k=0;k<12;k++) {
        const gradient=(source.shoreAt(coastX+1,z)-source.shoreAt(coastX-1,z))/2;
        if(Math.abs(gradient)<.1) throw new Error('Scarp volume needs a resolvable shoreline gradient');
        coastX+=(28-source.shoreAt(coastX,z))/gradient;
      }
      const gx=source.shoreAt(coastX+2,z)-source.shoreAt(coastX-2,z);
      const gz=source.shoreAt(coastX,z+2)-source.shoreAt(coastX,z-2);
      const norm=Math.hypot(gx,gz), nx=gx/norm,nz=gz/norm;
      const point=(d:number)=>({x:coastX+nx*d,z:z+nz*d});
      const toe=point(0), crest=point(59), back=point(110);
      minimumToeShore=Math.min(minimumToeShore,source.shoreAt(toe.x,toe.z));
      const toeY=ground.heightAt(toe.x,toe.z)-1.5;
      const top=source.heightAt(crest.x,crest.z)+2;
      const fade=ease(0,24,i*260/(sections-1))*ease(0,24,(sections-1-i)*260/(sections-1));
      put(toe.x,toeY,toe.z,.83);
      for(let j=1;j<=faceSteps;j++) {
        const t=j/faceSteps, h=toeY+(top-toeY)*t;
        // Talus transitions into steep face; shelves can overhang lower sections.
        const talus=12*ease(0,.19,t);
        const slope=8*t;
        const broad=(noise(z*.037,t*2.8)-.5)*7;
        const incision=Math.pow(noise(z*.17+noise(z*.013,1)*4,t*.7),5)*9;
        const fine=(noise(z*.61,t*23)-.5)*1.4;
        const strata=(noise(Math.floor(h/3.7),z*.012)-.5)*3.5;
        const shelf=(ease(.25,.30,t)-ease(.33,.37,t))*3.1
          +(ease(.57,.61,t)-ease(.65,.68,t))*2.2;
        const d=talus+slope+(broad+incision+fine+strata-shelf)*fade;
        const p=point(d);
        // Ends sink into the existing slope, hiding finite-volume caps.
        const y=ground.heightAt(p.x,p.z)-1.5+(h-ground.heightAt(p.x,p.z)+1.5)*fade;
        put(p.x,y,p.z,.83+noise(z*.19,h*.23)*.13-incision*.006);
      }
      const front=point(20+(noise(z*.037,2.8)-.5)*7*fade
        +Math.pow(noise(z*.17+noise(z*.013,1)*4,.7),5)*9*fade
        +(noise(z*.61,23)-.5)*1.4*fade+(noise(Math.floor(top/3.7),z*.012)-.5)*3.5*fade);
      const frontY=ground.heightAt(front.x,front.z)-1.5+(top-ground.heightAt(front.x,front.z)+1.5)*fade;
      for(let j=1;j<=roofSteps;j++) {
        const t=j/roofSteps, p={x:front.x+(back.x-front.x)*t,z:front.z+(back.z-front.z)*t};
        const g=ground.heightAt(p.x,p.z);
        const y=Math.max(frontY+(g-frontY)*ease(0,.78,t),g+1.2*fade)*(1-ease(.88,1,t))+(g-2)*ease(.88,1,t);
        put(p.x,y,p.z,.82+noise(z*.06,t*5)*.1);
      }
      put(back.x,Math.min(toeY,ground.heightAt(back.x,back.z))-5,back.z,.8);
      put(toe.x,toeY-5,toe.z,.8);
    }
    for(let i=0;i<sections-1;i++) for(let j=0;j<ring;j++) {
      const a=i*ring+j,b=i*ring+(j+1)%ring,c=(i+1)*ring+j,d=(i+1)*ring+(j+1)%ring;
      indices.push(a,c,b,b,c,d);
    }
    // End polygons are closed with a shared center, preserving manifold indices.
    for(const end of [0,sections-1]) {
      const center=positions.length/3;
      let x=0,y=0,z=0;
      for(let j=0;j<ring;j++){const k=(end*ring+j)*3;x+=positions[k];y+=positions[k+1];z+=positions[k+2];}
      put(x/ring,y/ring,z/ring,.8);
      for(let j=0;j<ring;j++) {
        const a=end*ring+j,b=end*ring+(j+1)%ring;
        if(end===0)indices.push(center,a,b);else indices.push(center,b,a);
      }
    }
    for(let i=0;i<indices.length;i+=3){const b=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=b;}
    this.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    this.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.geometry.setIndex(indices);this.geometry.computeVertexNormals();this.geometry.computeBoundingBox();
    this.bounds=this.geometry.boundingBox!.clone();
    const mesh=new THREE.Mesh(this.geometry,this.material);
    mesh.name='Niijima closed layered pumice solid';mesh.userData.worldSolid=true;mesh.castShadow=true;mesh.receiveShadow=true;
    this.group.add(mesh);
    this.diagnostics={triangles:indices.length/3,vertices:positions.length/3,sections,minimumToeShore,maximumHeight};
  }
  dispose():void {this.geometry.dispose();this.material.dispose();this.group.clear();}
}

