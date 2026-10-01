import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { NiijimaDEM, noise, ease } from './niijima-detail.ts';
import { niijimaGeologicalSurface } from './niijima-geological-surface.ts';
import { NIIJIMA_VOLUME_FRONTAGE } from './niijima-scarp.ts';

export interface ScarpVolumeSource { heightAt(x:number,z:number):number; shoreAt(x:number,z:number):number; }
/** Easternmost bracketed shore station; a flat distance field cannot derail a
 * Newton iteration into a different terrain region. No fabricated fallback. */
export function niijimaShoreStation(source:ScarpVolumeSource,z:number,distance:number):number {
  let east=6030,previous=source.shoreAt(east,z)-distance;
  for(let west=east-2;west>=5620;west-=2){
    const value=source.shoreAt(west,z)-distance;
    if(value>=0&&previous<=0){
      for(let i=0;i<20;i++){const middle=(west+east)/2;if(source.shoreAt(middle,z)>=distance)west=middle;else east=middle;}
      return (west+east)/2;
    }
    east=west;previous=value;
  }
  throw new Error('No bracketed shore station within Niijima candidate bounds');
}
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
    if(material){this.material.onBeforeCompile=material.onBeforeCompile;this.material.customProgramCacheKey=material.customProgramCacheKey;}
    this.material.vertexColors=true;
    this.material.side=THREE.FrontSide;
    const positions:number[]=[], colors:number[]=[], indices:number[]=[];
    const faceSteps=96, roofSteps=12, ring=faceSteps+roofSteps+3;
    const frontage=NIIJIMA_VOLUME_FRONTAGE,span=frontage.maxZ-frontage.minZ;
    const gullies=Array.from({length:67},(_,g)=>({centre:frontage.minZ+8+noise(g*13.713,27)*(span-16),width:1.3+noise(g*4.3,6)*2.2}));
    const samples=Array.from({length:401},(_,i)=>frontage.minZ+i*span/400);
    for(const g of gullies)samples.push(g.centre-g.width,g.centre,g.centre+g.width);
    samples.sort((a,b)=>a-b);
    const stations=samples.filter((z,i)=>!i||z-samples[i-1]>.02),sections=stations.length;
    let minimumToeShore=Infinity, maximumHeight=-Infinity;
    const put=(x:number,y:number,z:number,shade:number)=> {
      positions.push(x,y,z); colors.push(shade,shade*.985,shade*.95);
      maximumHeight=Math.max(maximumHeight,y);
    };
    for(let i=0;i<sections;i++) {
      const z=stations[i];
      // Smooth shore-following centreline. Parallel transport a fixed inland
      // horizontal frame, then shear sections along the centreline: every ring
      // stays in its own z plane, so neighbouring or distant stations cannot fold.
      let coastX=0, weight=0;
      for(let k=-4;k<=4;k++){const w=5-Math.abs(k);coastX+=niijimaShoreStation(source,z+k*6,34)*w;weight+=w;}
      coastX=coastX/weight-3;
      const point=(d:number)=>({x:coastX-d,z});
      const toe=point(0), crest=point(59), back=point(110);
      minimumToeShore=Math.min(minimumToeShore,source.shoreAt(toe.x,toe.z));
      const toeY=ground.heightAt(toe.x,toe.z)-1.5;
      const top=source.heightAt(crest.x,crest.z)+2;
      const fade=ease(0,frontage.feather,z-frontage.minZ)*ease(0,frontage.feather,frontage.maxZ-z);
      put(toe.x,toeY,toe.z,.83);
      let previousD=0;
      for(let j=1;j<=faceSteps;j++) {
        const t=j/faceSteps, h=toeY+(top-toeY)*t;
        // Angular talus and near-vertical wall. Long, asymmetric fissures
        // share a world-space path through height, with staggered birth/termination.
        const apronWidth=10+noise(z*.012,41)*13;
        const apronHeight=.09+noise(z*.018,37)*.15;
        const talus=apronWidth*Math.min(1,t/apronHeight);
        const slope=7*t;
        let incision=0;
        for(let g=0;g<67;g++) {
          const centre=gullies[g].centre;
          const bend=(noise(g*1.7,3)-.5)*3*t+(noise(g*2.3,9)-.5)*1.2*t*t;
          const width=gullies[g].width;
          const q=Math.abs(z-centre-bend)/width;
          const active=ease(.08+noise(g,2)*.16,.3,t)*(1-.45*ease(.72,.98,t));
          incision+=Math.max(0,1-q)*(2+noise(g,7)*5.2)*active;
        }
        const broad=(noise(z*.025,3)-.5)*3;
        // Broad shelves and recessed weak beds are physical geometry, not
        // drawn stripes. Lower horizontal/wavy bedding has no blanket 35deg tilt.
        const geology=niijimaGeologicalSurface(z,h);
        const strata=geology.retreat*ease(apronHeight,apronHeight+.05,t);
        const fine=(noise(z*.42,h*.38)-.5)*.65;
        const rawD=talus+slope+(broad+incision+fine+strata)*fade*ease(apronHeight*.7,apronHeight+.04,t);
        const d=t>.8?Math.max(previousD+.025,rawD):rawD;previousD=d;
        const p=point(d);
        // Ends sink into the existing slope, hiding finite-volume caps.
        const buried=source.heightAt(p.x,p.z)-3;
        const y=buried+(h-buried)*fade;
        const talusTone=.87+(noise(z*.24,h*.31)-.5)*.12;
        put(p.x,y,p.z,t<apronHeight?talusTone:geology.tone-incision*.008);
      }
      // Roof starts at the exact final face vertex; no mismatched bridge triangles.
      const front={x:positions[positions.length-3],z:positions[positions.length-1]};
      const frontY=positions[positions.length-2];
      for(let j=1;j<=roofSteps;j++) {
        const t=j/roofSteps, p={x:front.x+(back.x-front.x)*t,z:front.z+(back.z-front.z)*t};
        const g=ground.heightAt(p.x,p.z);
        const y=frontY+(g-3-frontY)*t+4*fade*Math.min(t/.2,(1-t)/.2,1);
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

