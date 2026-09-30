import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { sandAt } from './geodata.ts';
import { jointRandom } from './coast-structure.ts';

/** Conservative bounds for rock volumes, including their embedded backs. Coordinates are world metres. */
export interface CliffCollisionProxy { minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number; }
export interface BodyPoint { x:number;y:number;z:number; }

/** Sweep the feet position of a vertical body through all exposed ledges, including underwater approach. */
export function cliffBodySegmentBlocked(
  proxies:readonly CliffCollisionProxy[], from:BodyPoint, to:BodyPoint, radius=.38, bodyHeight=1.72,
): boolean {
  for(const p of proxies) {
    let enter=0,exit=1;
    for(const [a,b,low,high] of [[from.x,to.x,p.minX-radius,p.maxX+radius],
      [from.y,to.y,p.minY-bodyHeight,p.maxY],[from.z,to.z,p.minZ-radius,p.maxZ+radius]]) {
      const delta=b-a;
      if(Math.abs(delta)<1e-9){if(a<low || a>high){enter=2;break;}continue;}
      let t0=(low-a)/delta,t1=(high-a)/delta;if(t0>t1)[t0,t1]=[t1,t0];
      enter=Math.max(enter,t0);exit=Math.min(exit,t1);if(enter>exit)break;
    }
    if(enter<=exit && exit>=0 && enter<=1)return true;
  }
  return false;
}

/** Structural joint groups replace the dense decorative all-over rock scatter. */
export function cliffOutcrops(ground:GroundSampler,bounds:{minX:number;minZ:number;maxX:number;maxZ:number}):THREE.BufferGeometry {
  const positions:number[]=[],colors:number[]=[],uvs:number[]=[],proxies:CliffCollisionProxy[]=[];
  const familyCounts={plates:0,columns:0,buttresses:0},regions={west:0,centre:0,east:0};
  const stride=6.4,triangleLimit=85000;
  let eligible=0,count=0,pieces=0,rejectedStrand=0,maxProtrusion=0,maxFaceWidth=0,minVisibleY=Infinity;
  let sampledCliffArea=0,authoredFaceArea=0;
  const triangle=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,shade:number)=>{
    for(const p of[a,b,c]){positions.push(p.x,p.y,p.z);colors.push(shade,shade*.995,shade*1.018);uvs.push(p.x*.2,p.y*.2);}
  };
  const slopeAt=(x:number,z:number,r=4)=>{
    const gx=(ground.heightAt(x+r,z)-ground.heightAt(x-r,z))/(2*r);
    const gz=(ground.heightAt(x,z+r)-ground.heightAt(x,z-r))/(2*r);
    return {gx,gz,magnitude:Math.hypot(gx,gz)};
  };
  const normal=new THREE.Vector3(),tangent=new THREE.Vector3(),vertical=new THREE.Vector3();
  for(let iz=0,z=bounds.minZ+14;z<bounds.maxZ-14;z+=stride,iz++)for(let ix=0,x=bounds.minX+14;x<bounds.maxX-14;x+=stride,ix++){
    if(positions.length/9+120>triangleLimit)break;
    const random=(seed:number)=>jointRandom(ix,iz,seed);
    const px=x+(random(13)-.5)*3.2,pz=z+(random(17)-.5)*3.2,y=ground.heightAt(px,pz);
    if(y<5 || y>56 || sandAt(px,pz)>.48)continue;
    const gradient=slopeAt(px,pz);
    if(gradient.magnitude<1.22)continue;
    eligible++;sampledCliffArea+=stride*stride*Math.hypot(1,gradient.magnitude);
    // Select only coast-facing scarps, leaving most of the larger coherent field visible.
    if(random(31)<.29)continue;
    normal.set(-gradient.gx,0,-gradient.gz).normalize();
    tangent.set(-gradient.gz,0,gradient.gx).normalize();vertical.set(0,1,0);
    const dip=(jointRandom(Math.floor(px/28),Math.floor(pz/22),11)-.5)*.24;
    tangent.applyAxisAngle(normal,dip);vertical.applyAxisAngle(normal,dip);
    const family=jointRandom(Math.floor(px/19),Math.floor(pz/23),37);
    const familyName=family<.44?'plates':family<.72?'columns':'buttresses';
    // Full widths 5-12m, heights 3-11m: these alter form at beach-view distances.
    const width=familyName==='plates'?3.4+random(41)*2.3:familyName==='columns'?1.4+random(41)*1.3:2.8+random(41)*1.8;
    const height=familyName==='plates'?1.1+random(43)*1.1:familyName==='columns'?3+random(43)*2.3:2.1+random(43)*2;
    const depth=.8+random(47)*1.6;
    const split=familyName==='plates'?2+(random(51)>.7?1:0):random(51)>.61?2:1;
    const gap=.22+random(53)*.38,shade=.58+random(81)*.16;
    const centre=new THREE.Vector3(px,y,pz);
    let emitted=0;
    for(let part=0;part<split;part++){
      const halfWidth=(width*2-gap*(split-1))/(2*split);
      const partOffset=-width+halfWidth+part*(halfWidth*2+gap);
      const partCentre=centre.clone().addScaledVector(tangent,partOffset).addScaledVector(normal,(part%2?-.18:.12)*depth);
      // Unequal oblique fracture planes; no radially inflated rounded centre.
      const outline=familyName==='columns'
        ?[[-1,-.78],[-.68,-1],[.68,-.94],[1,-.54],[.92,.74],[.58,1],[-.72,.90],[-1,.49]]
        :familyName==='buttresses'
          ?[[-1,-.85],[-.43,-1],[.75,-.83],[1,-.34],[.64,.82],[.17,1],[-.81,.53],[-1,.04]]
          :[[-1,-.69],[-.69,-1],[.74,-.81],[1,-.44],[.85,.61],[.52,1],[-.77,.79],[-1,.30]];
      const back:THREE.Vector3[]=[],front:THREE.Vector3[]=[],bevel:THREE.Vector3[]=[];
      const tiltU=(random(61)-.5)*.22,tiltV=(random(67)-.5)*.16;
      for(let i=0;i<outline.length;i++){
        const [uu,vv]=outline[i],u=uu*halfWidth,v=vv*height;
        const planeDepth=depth+u*tiltU+v*tiltV;
        const a=partCentre.clone().addScaledVector(tangent,u).addScaledVector(vertical,v).addScaledVector(normal,-Math.max(4,depth*2.4));
        a.y=Math.min(a.y,ground.heightAt(a.x,a.z)-.5);back.push(a);
        front.push(partCentre.clone().addScaledVector(tangent,u*.94).addScaledVector(vertical,v*.96).addScaledVector(normal,planeDepth*.73));
        bevel.push(partCentre.clone().addScaledVector(tangent,u*.81).addScaledVector(vertical,v*.87).addScaledVector(normal,planeDepth));
      }
      // No new body-height walls across the strand or the navigable sea.
      if([...front,...bevel].some(p=>p.y<2.2 || (sandAt(p.x,p.z)>.6 && ground.heightAt(p.x,p.z)<5))){rejectedStrand++;continue;}
      const exposed=[...front,...bevel];
      const proxy:CliffCollisionProxy={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
      // Include the backs so that slanted side faces cannot fall outside their proxy. They are embedded in land.
      for(const p of [...exposed,...back]){
        proxy.minX=Math.min(proxy.minX,p.x);proxy.maxX=Math.max(proxy.maxX,p.x);
        proxy.minY=Math.min(proxy.minY,p.y);proxy.maxY=Math.max(proxy.maxY,p.y);
        proxy.minZ=Math.min(proxy.minZ,p.z);proxy.maxZ=Math.max(proxy.maxZ,p.z);
      }
      for(const p of exposed){minVisibleY=Math.min(minVisibleY,p.y);maxProtrusion=Math.max(maxProtrusion,p.clone().sub(centre).dot(normal));}
      proxies.push(proxy);
      // A single planar central face plus shallow chamfers. Every winding faces outward.
      for(let i=1;i+1<bevel.length;i++)triangle(bevel[0],bevel[i],bevel[i+1],shade+.025);
      for(let i=0;i<outline.length;i++){
        const j=(i+1)%outline.length;
        triangle(back[i],back[j],front[j],shade-.085);triangle(back[i],front[j],front[i],shade-.085);
        triangle(front[i],front[j],bevel[j],shade-.015);triangle(front[i],bevel[j],bevel[i],shade-.015);
      }
      authoredFaceArea+=halfWidth*height*4*.82;pieces++;emitted++;
    }
    if(emitted){count++;familyCounts[familyName]++;regions[px<-90?'west':px>90?'east':'centre']++;maxFaceWidth=Math.max(maxFaceWidth,width*2);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.userData={outcropCount:count,rockPieces:pieces,triangleCount:positions.length/9,triangleLimit,familyCounts,regions,
    eligibleSteepFaceSamples:eligible,rejectedStrandPieces:rejectedStrand,sampledCliffAreaM2:sampledCliffArea,authoredFaceAreaM2:authoredFaceArea,
    maxNormalProtrusionM:maxProtrusion,maxFaceWidthM:maxFaceWidth,minExposedVertexHeightM:Number.isFinite(minVisibleY)?minVisibleY:null,
    collisionProxies:proxies,collision:'Complete rock-volume AABBs; swept upright-body helper uses foot height in world metres',
    provenance:'Authored structural scarp panels, open joints and embedded overhangs; not surveyed geometry'};
  return geometry;
}

